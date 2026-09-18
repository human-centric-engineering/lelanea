/**
 * A turn sent twice is one turn, and every turn records what produced it
 * (§08 t-54).
 *
 * Runs the real `runRecordedTurn` → `turn-record.ts` chain against a small
 * STATEFUL in-memory fake of the four tables it touches, and a fake model that
 * does what the platform's chat handler does to them: writes the person's
 * message (with `metadata.app`), a cost row (with `costLogMetadata`), her reply,
 * then yields `start` / `content` / `done`. The properties worth proving are
 * about state across requests — a replay finds the first request's row — and a
 * canned mock can only echo what it was told.
 *
 * The fake enforces `@@unique([userId, turnId])` the way Postgres does, by
 * throwing Prisma's own `P2002`, because that constraint IS the claim.
 *
 * ## Reverting the claim fails this file (`fp6`)
 *
 * Make `claimTurn` always answer `claimed` and "a completed turn replayed" sees
 * a second model call and a second cost row; "a turn still in flight" opens a
 * second stream instead of throwing. Both are asserted against a population
 * established first: the first request's model call and cost row are counted
 * before the replay asserts there is no second one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

interface TurnRow {
  id: string;
  userId: string;
  turnId: string;
  clientSupplied: boolean;
  requestHash: string;
  seat: string;
  agentSlug: string;
  status: 'running' | 'completed' | 'failed';
  attempts: number;
  fingerprintVersion: string | null;
  conversationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  modelId: string | null;
  providerSlug: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  pricing: 'priced' | 'unpriced' | 'local' | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}
interface MessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
  createdAt: Date;
}
interface CostRow {
  userId: string;
  model: string;
  costUsd: number;
  metadata: Record<string, unknown> | undefined;
}

const db = vi.hoisted(() => ({
  turns: [] as TurnRow[],
  messages: [] as MessageRow[],
  costs: [] as CostRow[],
  providers: [] as { slug: string; isLocal: boolean }[],
  /** conversation id → the person it belongs to, as the platform would record. */
  conversationOwners: new Map<string, string>(),
  seq: 0,
}));

const { warn, error } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/logging', () => ({
  logger: { warn, error, info: vi.fn(), debug: vi.fn() },
}));

/** Her agent as the seed leaves it: instructions on the agent, her core on the profile. */
const HER_PERSONA = 'Who she is.\n\nVoice fingerprint: lelanea_voice_fingerprint_core v1.0';

vi.mock('@/lib/db/client', () => {
  const next = (prefix: string): string => `${prefix}-${++db.seq}`;
  const match = (row: TurnRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => row[key as keyof TurnRow] === value);

  return {
    prisma: {
      appTurn: {
        create: vi.fn(async ({ data }: { data: Partial<TurnRow> }) => {
          if (db.turns.some((t) => t.userId === data.userId && t.turnId === data.turnId)) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const row: TurnRow = {
            id: next('row'),
            status: 'running',
            attempts: 1,
            conversationId: null,
            userMessageId: null,
            assistantMessageId: null,
            modelId: null,
            providerSlug: null,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            pricing: null,
            errorCode: null,
            completedAt: null,
            fingerprintVersion: null,
            startedAt: new Date(),
            ...data,
          } as TurnRow;
          db.turns.push(row);
          return { ...row };
        }),
        findUnique: vi.fn(
          async ({ where }: { where: { userId_turnId: { userId: string; turnId: string } } }) => {
            const { userId, turnId } = where.userId_turnId;
            const row = db.turns.find((t) => t.userId === userId && t.turnId === turnId);
            return row ? { ...row } : null;
          }
        ),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = db.turns.find((t) => t.id === where.id);
          if (!row) throw new Error('not found');
          return { ...row };
        }),
        updateMany: vi.fn(
          async ({ where, data }: { where: Record<string, unknown>; data: Partial<TurnRow> }) => {
            const rows = db.turns.filter((t) => match(t, where));
            rows.forEach((row) => Object.assign(row, data));
            return { count: rows.length };
          }
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Partial<TurnRow> }) => {
            const row = db.turns.find((t) => t.id === where.id);
            if (!row) throw new Error('not found');
            Object.assign(row, data);
            return { ...row };
          }
        ),
      },
      aiMessage: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: {
              id?: string;
              conversationId: string;
              conversation?: { userId: string };
              role?: string;
              createdAt?: { gte: Date };
            };
          }) => {
            // The owner scope is required, and honoured: a read that dropped it
            // could reach another person's thread.
            if (!where.conversation?.userId)
              throw new Error('aiMessage read without an owner scope');
            const rows = db.messages.filter(
              (m) =>
                m.conversationId === where.conversationId &&
                db.conversationOwners.get(m.conversationId) === where.conversation?.userId &&
                (where.id === undefined || m.id === where.id) &&
                (where.role === undefined || m.role === where.role) &&
                (where.createdAt === undefined || m.createdAt >= where.createdAt.gte)
            );
            const row = rows.at(-1);
            return row
              ? {
                  id: row.id,
                  content: row.content,
                  createdAt: row.createdAt,
                  provenance: row.provenance ?? null,
                }
              : null;
          }
        ),
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              conversationId: string;
              conversation?: { userId: string };
              role: string;
              createdAt: { gte: Date; lte: Date };
            };
          }) => {
            if (!where.conversation?.userId)
              throw new Error('aiMessage read without an owner scope');
            return db.messages
              .filter(
                (m) =>
                  m.conversationId === where.conversationId &&
                  db.conversationOwners.get(m.conversationId) === where.conversation?.userId &&
                  m.role === where.role &&
                  m.createdAt >= where.createdAt.gte &&
                  m.createdAt <= where.createdAt.lte
              )
              .map((m) => ({ content: m.content }));
          }
        ),
      },
      aiAgent: {
        findFirst: vi.fn(async () => ({
          id: 'agent-1',
          slug: 'lelanea-guide',
          isActive: true,
          provider: 'openai',
          model: 'gpt-4o-mini-2024-07-18',
          temperature: 0.7,
          systemInstructions: 'In a turn: answer.',
          persona: null,
          guardrails: null,
          brandVoiceInstructions: null,
          personaMode: null,
          voiceMode: null,
          guardrailsMode: null,
          profile: {
            id: 'profile-1',
            name: 'Her core',
            persona: HER_PERSONA,
            guardrails: null,
            brandVoiceInstructions: null,
          },
        })),
      },
      aiProviderConfig: {
        findUnique: vi.fn(
          async ({ where }: { where: { slug: string } }) =>
            db.providers.find((p) => p.slug === where.slug) ?? null
        ),
      },
    },
  };
});

import { runRecordedTurn, TURN_REPLY_UNAVAILABLE } from '@/lib/app/agent/turns';
import { STALE_CLAIM_MS, claimTurn } from '@/lib/app/agent/turn-record';
import { prisma } from '@/lib/db/client';
import type {
  FacilitationTurn,
  FacilitationTurnExtras,
} from '@/lib/framework/facilitation/agents/turn-hook';
import { PINNED_MODEL } from '@/lib/app/agent/pinned-model';
import { __resetForTests as resetRegistry } from '@/lib/orchestration/llm/model-registry';
import type { ChatEvent } from '@/types/orchestration';

/** What the fake model should do on its next call. */
interface ModelBehaviour {
  model: string;
  provider: string;
  outcome: 'answer' | 'error';
  costUsd: number;
}
let behaviour: ModelBehaviour;
let modelCalls = 0;

/**
 * The platform's chat handler, as far as these tables are concerned.
 *
 * Writes what the real one writes, where it writes it: the user row carries
 * `messageMetadata` under `metadata.app`, the cost row carries
 * `costLogMetadata`, and a new conversation id appears on a first turn.
 */
function fakeRun(
  turn: FacilitationTurn
): (extras: FacilitationTurnExtras) => AsyncIterable<ChatEvent> {
  return (extras) =>
    (async function* () {
      modelCalls += 1;
      const conversationId = turn.conversationId ?? `conv-${turn.userId}`;
      db.conversationOwners.set(conversationId, turn.userId);
      const userMessage: MessageRow = {
        id: `msg-${++db.seq}`,
        conversationId,
        role: 'user',
        content: turn.message,
        metadata: extras.messageMetadata ? { app: extras.messageMetadata } : null,
        createdAt: new Date(),
      };
      db.messages.push(userMessage);
      yield { type: 'start', conversationId, messageId: userMessage.id };

      if (behaviour.outcome === 'error') {
        yield { type: 'error', code: 'provider_unavailable', message: 'Down.' };
        return;
      }

      db.costs.push({
        userId: turn.userId,
        model: behaviour.model,
        costUsd: behaviour.costUsd,
        metadata: extras.costLogMetadata,
      });
      const reply = `Her answer to: ${turn.message}`;
      db.messages.push({
        id: `msg-${++db.seq}`,
        conversationId,
        role: 'assistant',
        content: reply,
        metadata: null,
        createdAt: new Date(),
      });
      yield { type: 'content', delta: reply };
      yield {
        type: 'done',
        tokenUsage: { inputTokens: 3000, outputTokens: 300, totalTokens: 3300 },
        costUsd: behaviour.costUsd,
        provider: behaviour.provider,
        model: behaviour.model,
      };
    })();
}

function turnFor(overrides: Partial<FacilitationTurn> = {}): FacilitationTurn {
  return {
    userId: 'user-1',
    role: 'onboarding',
    agentId: 'agent-1',
    agentSlug: 'lelanea-guide',
    conversationId: undefined,
    message: 'Where do I start?',
    clientTurnId: 'turn-1',
    ...overrides,
  };
}

/** Start a turn that must not be refused, and hand back its stream. */
async function streamOf(turn: FacilitationTurn): Promise<AsyncIterator<ChatEvent>> {
  const result = await runRecordedTurn(turn, fakeRun(turn));
  if ('refused' in result) throw new Error(`unexpected refusal: ${result.reason}`);
  return result[Symbol.asyncIterator]();
}

/** Take a turn and read its stream to the end. */
async function take(turn: FacilitationTurn): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const stream = await streamOf(turn);
  for (let next = await stream.next(); !next.done; next = await stream.next()) {
    events.push(next.value);
  }
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRegistry();
  db.turns = [];
  db.messages = [];
  db.costs = [];
  db.providers = [{ slug: 'openai', isLocal: false }];
  db.conversationOwners = new Map();
  db.seq = 0;
  modelCalls = 0;
  behaviour = { model: PINNED_MODEL, provider: 'openai', outcome: 'answer', costUsd: 0.00063 };
});

describe('a turn id', () => {
  it('a completed turn replayed returns its recorded outcome — no model call, no cost row', async () => {
    const first = await take(turnFor());
    // The population: one real call, one cost row, one completed turn.
    expect(modelCalls).toBe(1);
    expect(db.costs).toHaveLength(1);
    expect(db.turns[0].status).toBe('completed');

    const second = await take(turnFor());

    expect(modelCalls).toBe(1);
    expect(db.costs).toHaveLength(1);
    expect(db.turns).toHaveLength(1);
    // The same outcome, frame for frame: a client that retried after losing the
    // connection cannot tell the replay from the answer it missed.
    expect(second).toEqual(first);
  });

  it('a turn still in flight is refused, not raced', async () => {
    const turn = turnFor();
    const firstStream = await streamOf(turn);
    // Claimed, not yet finished: the model has not even been called.
    expect(db.turns[0].status).toBe('running');

    // A refusal VALUE, not a stream and not a thrown error — the framework turns
    // it into a 409 in the route's own module graph.
    await expect(runRecordedTurn(turn, fakeRun(turn))).resolves.toEqual({
      refused: true,
      message: expect.any(String),
      reason: 'TURN_IN_FLIGHT',
    });

    // The first request is untouched by the refusal and still finishes.
    while (!(await firstStream.next()).done);
    expect(modelCalls).toBe(1);
    expect(db.turns[0].status).toBe('completed');
  });

  it('a turn that failed may run again under the same id', async () => {
    behaviour.outcome = 'error';
    await take(turnFor());
    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'provider_unavailable' });

    behaviour.outcome = 'answer';
    const retry = await take(turnFor());

    expect(modelCalls).toBe(2);
    expect(retry.at(-1)?.type).toBe('done');
    expect(db.turns).toHaveLength(1);
    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 2, errorCode: null });
    // Hypothesis (c), confirmed: the platform wrote the person's message on BOTH
    // attempts. There is no way to avoid it from here — recorded for f-conversation.
    expect(db.messages.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('a stream that ends without an outcome leaves the turn failed, not running', async () => {
    const turn = turnFor();
    const stream = await streamOf(turn);
    await stream.next(); // `start` — then the client goes away
    await stream.return?.();

    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'incomplete' });
    await take(turn);
    expect(db.turns[0].status).toBe('completed');
  });

  it('an abandoned claim is taken back after STALE_CLAIM_MS', async () => {
    const turn = turnFor();
    await runRecordedTurn(turn, fakeRun(turn)); // claimed, never read: the process "died"
    db.turns[0].startedAt = new Date(Date.now() - STALE_CLAIM_MS - 1000);

    await take(turn);

    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it("is the caller's own: another person's id neither collides nor leaks", async () => {
    await take(turnFor({ userId: 'user-1', message: 'Mine.' }));

    // Same id, different person, different words: a new turn, not a replay of
    // user-1's and not a refusal that would tell user-2 the id exists.
    const theirs = await take(turnFor({ userId: 'user-2', message: 'Theirs.' }));

    expect(modelCalls).toBe(2);
    expect(db.turns.map((t) => t.userId)).toEqual(['user-1', 'user-2']);
    const content = theirs.find((e) => e.type === 'content');
    expect(content).toEqual({ type: 'content', delta: 'Her answer to: Theirs.' });
  });

  it('refuses an id reused for a different message', async () => {
    await take(turnFor({ message: 'First question.' }));

    await expect(
      runRecordedTurn(turnFor({ message: 'A different one.' }), fakeRun(turnFor()))
    ).resolves.toMatchObject({ refused: true, reason: 'TURN_ID_REUSED' });
    expect(modelCalls).toBe(1);
  });

  it('with no client id, behaves as before: every request runs', async () => {
    await take(turnFor({ clientTurnId: undefined }));
    await take(turnFor({ clientTurnId: undefined }));

    expect(modelCalls).toBe(2);
    expect(db.costs).toHaveLength(2);
    // Still recorded, under ids minted here, which no client can send again.
    expect(db.turns.map((t) => t.clientSupplied)).toEqual([false, false]);
    expect(db.turns[0].turnId).not.toBe(db.turns[1].turnId);
    expect(db.turns[0].turnId).toMatch(/^srv_/);
  });

  it('a replay whose reply was deleted says so rather than inventing one', async () => {
    await take(turnFor());
    db.messages = db.messages.filter((m) => m.role !== 'assistant');

    const replayed = await take(turnFor());

    expect(replayed).toEqual([
      { type: 'error', code: TURN_REPLY_UNAVAILABLE, message: expect.any(String) },
    ]);
    expect(modelCalls).toBe(1);
  });
});

describe('what a turn records', () => {
  it('tags the cost row with turn id and seat, and the message with the fingerprint version', async () => {
    await take(turnFor({ role: 'facilitator' }));

    expect(db.costs[0].metadata).toEqual({ turnId: 'turn-1', seat: 'facilitator' });
    const userMessage = db.messages.find((m) => m.role === 'user');
    expect(userMessage?.metadata).toEqual({
      app: { turnId: 'turn-1', seat: 'facilitator', fingerprintVersion: '1.0' },
    });
  });

  it('joins both messages to the model, provider, version and cost the platform reported', async () => {
    await take(turnFor());

    const [userMessage, assistantMessage] = db.messages;
    expect(db.turns[0]).toMatchObject({
      seat: 'onboarding',
      agentSlug: 'lelanea-guide',
      fingerprintVersion: '1.0',
      conversationId: 'conv-user-1',
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      modelId: PINNED_MODEL,
      providerSlug: 'openai',
      inputTokens: 3000,
      outputTokens: 300,
      costUsd: 0.00063,
      pricing: 'priced',
    });
  });
});

describe('a turn costed at nothing', () => {
  it('is marked unpriced with no cost — beside a priced turn as the population', async () => {
    // The population: her pinned model, which t-52 taught the registry, prices.
    await take(turnFor({ clientTurnId: 'priced-turn' }));
    // An id an admin could pin her to that no registry holds. The platform's
    // own cost row for it says $0.
    behaviour = {
      model: 'gpt-imaginary-2031-01-01',
      provider: 'openai',
      outcome: 'answer',
      costUsd: 0,
    };
    await take(turnFor({ clientTurnId: 'unpriced-turn' }));

    const [priced, unpriced] = db.turns;
    expect(priced).toMatchObject({ pricing: 'priced', costUsd: 0.00063 });
    // Not $0: nobody knows what it cost, and the record says so.
    expect(unpriced).toMatchObject({ pricing: 'unpriced', costUsd: null });
    expect(warn).toHaveBeenCalledWith(
      'Agent turn was costed at nothing: its model has no rate',
      expect.objectContaining({ turnId: 'unpriced-turn', model: 'gpt-imaginary-2031-01-01' })
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a provider that reports no usage is unpriced, not a free turn', async () => {
    behaviour = { model: PINNED_MODEL, provider: 'openai', outcome: 'answer', costUsd: 0 };
    const turn = turnFor();
    const noUsage = (): AsyncIterable<ChatEvent> =>
      (async function* () {
        for await (const event of fakeRun(turn)({})) {
          yield event.type === 'done'
            ? { ...event, tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
            : event;
        }
      })();
    const result = await runRecordedTurn(turn, noUsage);
    if ('refused' in result) throw new Error('refused');
    for await (const _event of result);

    expect(db.turns[0]).toMatchObject({ pricing: 'unpriced', costUsd: null });
  });

  it('is told apart from a genuinely free local model', async () => {
    db.providers.push({ slug: 'ollama', isLocal: true });
    behaviour = { model: 'llama-local-7b', provider: 'ollama', outcome: 'answer', costUsd: 0 };

    await take(turnFor());

    expect(db.turns[0]).toMatchObject({ pricing: 'local', costUsd: 0 });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('when the record itself fails', () => {
  it('still gives the person their answer, and says the meter missed it', async () => {
    // Every settle write fails: the database hiccups after the claim.
    // Two settle writes per turn (start, then completed or failed). One-shot, so
    // the fake's real implementation is back for the next case.
    vi.mocked(prisma.appTurn.updateMany)
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockRejectedValueOnce(new Error('db hiccup'));

    const events = await take(turnFor());

    // The population: the whole turn reached the person.
    expect(events.map((e) => e.type)).toEqual(['start', 'content', 'done']);
    expect(error).toHaveBeenCalledWith(
      'Agent turn record write failed',
      expect.objectContaining({ stage: 'start', turnId: 'turn-1', error: 'db hiccup' })
    );
    expect(error).toHaveBeenCalledWith(
      'Agent turn record write failed',
      expect.objectContaining({ stage: 'completed' })
    );
    // Left `running` — which STALE_CLAIM_MS is the remedy for.
    expect(db.turns[0].status).toBe('running');
  });

  it('logs a failed failure-write rather than throwing it at the client', async () => {
    behaviour.outcome = 'error';
    // Two settle writes per turn (start, then completed or failed). One-shot, so
    // the fake's real implementation is back for the next case.
    vi.mocked(prisma.appTurn.updateMany)
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockRejectedValueOnce(new Error('db hiccup'));

    const events = await take(turnFor());

    expect(events.at(-1)?.type).toBe('error');
    expect(error).toHaveBeenCalledWith(
      'Agent turn record write failed',
      expect.objectContaining({ stage: 'failed' })
    );
  });
});

describe('a request that ends before its stream is read', () => {
  it('leaves the turn failed, so the retry runs instead of meeting a 409', async () => {
    const controller = new AbortController();
    const turn = { ...turnFor(), signal: controller.signal };
    await runRecordedTurn(turn, fakeRun(turn)); // claimed; the stream is never read
    expect(db.turns[0].status).toBe('running');

    controller.abort();
    await vi.waitFor(() => expect(db.turns[0].status).toBe('failed'));
    expect(db.turns[0].errorCode).toBe('aborted');

    await take(turnFor());
    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 2 });
    expect(modelCalls).toBe(1);
  });

  it('settles at once when the request was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const turn = { ...turnFor(), signal: controller.signal };

    await runRecordedTurn(turn, fakeRun(turn));

    await vi.waitFor(() => expect(db.turns[0].errorCode).toBe('aborted'));
  });

  it('leaves a stream that has begun to settle itself', async () => {
    const controller = new AbortController();
    const turn = { ...turnFor(), signal: controller.signal };
    const stream = await streamOf(turn);
    await stream.next();

    controller.abort(); // mid-stream: the stream's own finally owns this
    for (let next = await stream.next(); !next.done; next = await stream.next());

    expect(db.turns[0].status).toBe('completed');
  });
});

describe('a replay of a turn that used a tool', () => {
  it('tells every pass of the reply again, and the sources it cited', async () => {
    const turn = turnFor();
    const citation = {
      marker: 1,
      chunkId: 'c1',
      documentId: 'd1',
      documentName: 'A Sunday letter',
      contentHash: null,
      documentVersion: null,
      section: null,
      patternNumber: null,
      patternName: null,
      excerpt: 'more to this life',
      similarity: 0.9,
    };
    // Two passes, as the platform streams and persists them: text before the
    // search, then the answer that cites what it found.
    const withTool = (): AsyncIterable<ChatEvent> =>
      (async function* () {
        db.conversationOwners.set('conv-user-1', 'user-1');
        const at = Date.now();
        db.messages.push({
          id: 'u1',
          conversationId: 'conv-user-1',
          role: 'user',
          content: turn.message,
          metadata: null,
          createdAt: new Date(at),
        });
        yield { type: 'start', conversationId: 'conv-user-1', messageId: 'u1' };
        yield { type: 'content', delta: 'Let me look. ' };
        db.messages.push({
          id: 'a1',
          conversationId: 'conv-user-1',
          role: 'assistant',
          content: 'Let me look. ',
          metadata: null,
          createdAt: new Date(at + 1),
        });
        yield { type: 'content', delta: 'She writes of more [1].' };
        db.messages.push({
          id: 'a2',
          conversationId: 'conv-user-1',
          role: 'assistant',
          content: 'She writes of more [1].',
          metadata: null,
          provenance: { citations: [citation] },
          createdAt: new Date(at + 2),
        });
        yield { type: 'citations', citations: [citation] };
        yield {
          type: 'done',
          tokenUsage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          costUsd: 0.0001,
          model: PINNED_MODEL,
          provider: 'openai',
        };
      })();
    const live = await runRecordedTurn(turn, withTool);
    if ('refused' in live) throw new Error('refused');
    for await (const _event of live);
    expect(db.turns[0].assistantMessageId).toBe('a2');

    const replayed = await take(turn);

    expect(replayed.find((e) => e.type === 'content')).toEqual({
      type: 'content',
      delta: 'Let me look. She writes of more [1].',
    });
    expect(replayed.find((e) => e.type === 'citations')).toEqual({
      type: 'citations',
      citations: [citation],
    });
  });
});

describe('the edges of a claim', () => {
  it('a turn that hits the per-turn cost cap is failed with that code, so it may run again', async () => {
    const turn = turnFor();
    const capped = (): AsyncIterable<ChatEvent> =>
      (async function* () {
        yield { type: 'start', conversationId: 'conv-user-1', messageId: 'm1' };
        yield {
          type: 'budget_exceeded_per_turn',
          code: 'budget_exceeded_per_turn',
          message: 'Capped.',
          usedUsd: 1,
          limitUsd: 0.5,
        };
      })();
    const result = await runRecordedTurn(turn, capped);
    if ('refused' in result) throw new Error('refused');
    for await (const _event of result);

    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'budget_exceeded_per_turn' });
  });

  it('a done with no model records no pricing rather than guessing one', async () => {
    const turn = turnFor();
    const bare = (): AsyncIterable<ChatEvent> =>
      (async function* () {
        yield { type: 'start', conversationId: 'conv-user-1' };
        // What the platform does before `done`: her reply is persisted.
        db.conversationOwners.set('conv-user-1', 'user-1');
        db.messages.push({
          id: 'reply-1',
          conversationId: 'conv-user-1',
          role: 'assistant',
          content: 'x',
          metadata: null,
          createdAt: new Date(),
        });
        yield {
          type: 'done',
          tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          costUsd: 0,
        };
      })();
    const result = await runRecordedTurn(turn, bare);
    if ('refused' in result) throw new Error('refused');
    for await (const _event of result);

    expect(db.turns[0]).toMatchObject({
      status: 'completed',
      pricing: null,
      modelId: null,
      userMessageId: null,
      assistantMessageId: 'reply-1',
    });
    // And a replay of it carries no invented model or provider.
    const replayed = await take(turn);
    expect(replayed[0]).toEqual({ type: 'start', conversationId: 'conv-user-1' });
    expect(replayed.at(-1)).not.toHaveProperty('model');
  });

  it('a database error other than the unique index is not read as a claim', async () => {
    vi.mocked(prisma.appTurn.create).mockRejectedValueOnce(new Error('connection lost'));

    await expect(take(turnFor())).rejects.toThrow('connection lost');
    expect(modelCalls).toBe(0);
  });

  it('of two re-runs of one failed turn, only one runs the model', async () => {
    behaviour.outcome = 'error';
    await take(turnFor());
    const request = {
      userId: 'user-1',
      turnId: 'turn-1',
      clientSupplied: true,
      seat: 'onboarding',
      agentSlug: 'lelanea-guide',
      requestHash: db.turns[0].requestHash,
    };
    // The other re-run takes it back between this one's read and its write.
    vi.mocked(prisma.appTurn.updateMany).mockResolvedValueOnce({ count: 0 });

    const claim = await claimTurn(request, '1.0');

    expect(claim.kind).toBe('in_flight');
  });

  it('refuses rather than guesses when the row vanishes between insert and read', async () => {
    await take(turnFor());
    vi.mocked(prisma.appTurn.findUnique).mockResolvedValueOnce(null);

    await expect(
      claimTurn(
        {
          userId: 'user-1',
          turnId: 'turn-1',
          clientSupplied: true,
          seat: 'onboarding',
          agentSlug: 'lelanea-guide',
          requestHash: 'x',
        },
        null
      )
    ).rejects.toThrow(/lost its row/);
  });

  it('a finished turn whose reply cannot be found is failed, so the id can run again', async () => {
    const turn = turnFor();
    // A stream that reaches `done` without the platform having written a reply.
    const replyless = (): AsyncIterable<ChatEvent> =>
      (async function* () {
        yield { type: 'start', conversationId: 'conv-user-1' };
        yield {
          type: 'done',
          tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          costUsd: 0.0001,
          model: PINNED_MODEL,
          provider: 'openai',
        };
      })();
    const result = await runRecordedTurn(turn, replyless);
    if ('refused' in result) throw new Error('refused');
    for await (const _event of result);

    // Not `completed` with nothing to replay — that would error every retry forever.
    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'reply_not_linked' });
    await take(turn);
    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it("finds the reply by the person's message time, even when this server's clock runs ahead", async () => {
    const turn = turnFor();
    const stream = await streamOf(turn);
    // The claim's own timestamp is well AFTER the rows the platform is about to
    // write — the skew a `startedAt` bound would miss the reply under.
    db.turns[0].startedAt = new Date(Date.now() + 60_000);
    for (let next = await stream.next(); !next.done; next = await stream.next());

    expect(db.turns[0].status).toBe('completed');
    expect(db.turns[0].assistantMessageId).toBe(
      db.messages.find((m) => m.role === 'assistant')?.id
    );
  });

  it('an attempt that outlived its claim writes nothing over the attempt that replaced it', async () => {
    const turn = turnFor();
    const slow = await streamOf(turn); // attempt 1: claimed, still running
    await slow.next(); // `start`
    // Ten minutes pass; a retry takes the abandoned claim over and finishes.
    db.turns[0].startedAt = new Date(Date.now() - STALE_CLAIM_MS - 1000);
    behaviour.costUsd = 0.002;
    await take(turn);
    const replacement = { ...db.turns[0] };
    expect(replacement).toMatchObject({ status: 'completed', attempts: 2, costUsd: 0.002 });

    // Attempt 1 finally ends. Its settle names attempt 1, so it changes nothing.
    behaviour.costUsd = 0.00063;
    for (let next = await slow.next(); !next.done; next = await slow.next());

    expect(db.turns[0]).toEqual(replacement);
    expect(warn).toHaveBeenCalledWith(
      'Agent turn outlived its claim; a later attempt owns the record',
      expect.objectContaining({ attempts: 1 })
    );
  });
});
