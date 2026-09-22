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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  role: 'user' | 'assistant' | 'tool';
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
  /** The singleton settings row, as the admin last saved it. */
  settings: { firstWordsDeadlineMs: 8_000, turnDeadlineMs: 60_000 },
  /** Feature flags by name. */
  flags: new Map<string, boolean>(),
  /** The default monthly ceiling, and each person's own override. */
  defaultCeilingUsd: 5,
  budgets: new Map<string, number>(),
  seq: 0,
}));

const { warn, error } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

// One film in the library, so a replay can carry a suggestion on its call's
// frame (t-77). The shipped file holds none until her list lands.
// The library is rows since t-87: the seed's, plus one film a replay's chip
// resolves to.
vi.mock('@/lib/app/content/resource-store', async () => {
  const { fakeResourceStore, filmRow } = await import('@/tests/helpers/app/content-stores');
  const store = fakeResourceStore();
  store.addResource(
    filmRow('on-stalling', {
      title: 'On stalling',
      subtitle: 'why the words you avoid are the work',
      duration: '5:04',
      href: 'https://example.com/on-stalling',
    })
  );
  return store;
});

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
      appAgentSettings: {
        findUnique: vi.fn(async () => ({
          ...db.settings,
          defaultMonthlyCeilingUsd: db.defaultCeilingUsd,
          updatedAt: new Date(),
        })),
      },
      appUserBudget: {
        findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
          db.budgets.has(where.userId) ? { monthlyCeilingUsd: db.budgets.get(where.userId) } : null
        ),
      },
      // The month-to-date read: every cost row the fake model wrote is this
      // month's, so it sums the person's rows. Its only value that is a user id
      // is the first interpolation.
      $queryRaw: vi.fn(async (_sql: TemplateStringsArray, userId: string) => {
        const rows = db.costs.filter((c) => c.userId === userId);
        return [
          {
            cost_usd: rows.reduce((sum, c) => sum + c.costUsd, 0),
            input_tokens: 0,
            output_tokens: 0,
            cost_rows: rows.length,
            unpriced_rows: 0,
          },
        ];
      }),
      featureFlag: {
        findUnique: vi.fn(async ({ where }: { where: { name: string } }) =>
          db.flags.has(where.name) ? { enabled: db.flags.get(where.name) } : null
        ),
      },
    },
  };
});

import { runRecordedTurn } from '@/lib/app/agent/turns';
import { claimTurn, staleClaimMs } from '@/lib/app/agent/turn-record';
import { GENERATION_PAUSED_FLAG } from '@/lib/app/agent/availability';
import { ENDING_MESSAGES } from '@/lib/app/agent/endings';
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
  /** `silent`: the stream ends after `start` with no outcome at all. */
  outcome: 'answer' | 'error' | 'silent';
  costUsd: number;
  /** The provider error's own text, when `outcome` is `error`. */
  errorMessage?: string;
  /**
   * Held before the first words until released — a model that is thinking.
   * Aborting the call's signal ends the wait the way the platform does: an
   * `error` frame with `aborted`, after its error-marker row.
   */
  gate?: Promise<void>;
}
let behaviour: ModelBehaviour;
let modelCalls = 0;
/** The signal each model call was made under, in order. */
let callSignals: (AbortSignal | undefined)[] = [];

/** A gate the test opens by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Resolves when the gate opens (`true`) or the signal aborts (`false`). */
function held(until: Promise<void>, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    signal?.addEventListener('abort', () => resolve(false), { once: true });
    void until.then(() => resolve(true));
  });
}

/**
 * The platform's chat handler, as far as these tables are concerned.
 *
 * Writes what the real one writes, where it writes it: the user row carries
 * `messageMetadata` under `metadata.app`, the cost row carries
 * `costLogMetadata`, and a new conversation id appears on a first turn. Honours
 * `extras.signal` as the real one does: an aborted call persists the error
 * marker and ends on `aborted`.
 */
function fakeRun(
  turn: FacilitationTurn
): (extras: FacilitationTurnExtras) => AsyncIterable<ChatEvent> {
  return (extras) =>
    (async function* () {
      modelCalls += 1;
      callSignals.push(extras.signal);
      // Read at the call, as a model's latency is fixed when it is asked.
      const hold = behaviour.gate;
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

      if (hold && !(await held(hold, extras.signal))) {
        db.messages.push({
          id: `msg-${++db.seq}`,
          conversationId,
          role: 'assistant',
          content: '[An error occurred and the response could not be completed.]',
          metadata: { error: true, errorCode: 'aborted' },
          createdAt: new Date(),
        });
        yield { type: 'error', code: 'aborted', message: 'The request was cancelled.' };
        return;
      }

      if (behaviour.outcome === 'silent') return;
      if (behaviour.outcome === 'error') {
        yield {
          type: 'error',
          code: 'provider_unavailable',
          message: behaviour.errorMessage ?? 'Down.',
        };
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

/**
 * Start a turn that must not be refused. Hands back its stream, and the run the
 * turn gave the host to keep alive — which settles once the turn is recorded,
 * whether or not anyone read it.
 */
async function begin(
  turn: FacilitationTurn
): Promise<{ stream: AsyncIterator<ChatEvent>; finished: Promise<unknown> | undefined }> {
  let finished: Promise<unknown> | undefined;
  const result = await runRecordedTurn(
    {
      ...turn,
      keepAlive: (work) => {
        finished = work;
      },
    },
    fakeRun(turn)
  );
  if ('refused' in result) throw new Error(`unexpected refusal: ${result.reason}`);
  return { stream: result[Symbol.asyncIterator](), finished };
}

async function streamOf(turn: FacilitationTurn): Promise<AsyncIterator<ChatEvent>> {
  return (await begin(turn)).stream;
}

/** Read a stream to its end. */
async function drain(stream: AsyncIterator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for (let next = await stream.next(); !next.done; next = await stream.next()) {
    events.push(next.value);
  }
  return events;
}

/** Take a turn and read its stream to the end. */
async function take(turn: FacilitationTurn): Promise<ChatEvent[]> {
  return drain(await streamOf(turn));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRegistry();
  db.turns = [];
  db.messages = [];
  db.costs = [];
  db.providers = [{ slug: 'openai', isLocal: false }];
  db.conversationOwners = new Map();
  db.settings = { firstWordsDeadlineMs: 8_000, turnDeadlineMs: 60_000 };
  db.flags = new Map([[GENERATION_PAUSED_FLAG, false]]);
  db.defaultCeilingUsd = 5;
  db.budgets = new Map();
  db.seq = 0;
  modelCalls = 0;
  callSignals = [];
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
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const turn = turnFor();
    const firstStream = await streamOf(turn);
    // Claimed, not yet finished: the model is still thinking.
    expect(db.turns[0].status).toBe('running');

    // A refusal VALUE, not a stream and not a thrown error — the framework turns
    // it into a 409 in the route's own module graph.
    await expect(runRecordedTurn(turn, fakeRun(turn))).resolves.toEqual({
      refused: true,
      message: expect.any(String),
      reason: 'TURN_IN_FLIGHT',
    });

    // The first request is untouched by the refusal and still finishes.
    thinking.open();
    await drain(firstStream);
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
    behaviour.outcome = 'silent';
    await take(turn);

    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'incomplete' });
    behaviour.outcome = 'answer';
    await take(turn);
    expect(db.turns[0].status).toBe('completed');
  });

  it('an abandoned claim is taken back once it outlives the deadline and its grace', async () => {
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const turn = turnFor();
    const dead = await begin(turn); // claimed, still running: the process "died" here
    behaviour.gate = undefined;

    // Inside the window it is still somebody's turn.
    db.turns[0].startedAt = new Date(Date.now() - staleClaimMs(60_000) + 1000);
    await expect(runRecordedTurn(turn, fakeRun(turn))).resolves.toMatchObject({
      reason: 'TURN_IN_FLIGHT',
    });

    db.turns[0].startedAt = new Date(Date.now() - staleClaimMs(60_000) - 1000);
    await take(turn);
    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 2 });

    thinking.open();
    await dead.finished;
  });

  it("follows the admin's deadline: a shorter one frees a crashed claim sooner", async () => {
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const turn = turnFor();
    const dead = await begin(turn);
    behaviour.gate = undefined;
    // Old enough to be abandoned under a 5-second deadline, not under 60.
    db.turns[0].startedAt = new Date(Date.now() - staleClaimMs(5_000) - 1000);

    await expect(runRecordedTurn(turn, fakeRun(turn))).resolves.toMatchObject({
      reason: 'TURN_IN_FLIGHT',
    });
    db.settings.turnDeadlineMs = 5_000;
    db.settings.firstWordsDeadlineMs = 1_000;
    await take(turn);

    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 2 });
    thinking.open();
    await dead.finished;
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

    // In the plain vocabulary, like every other ending — not the seam's own code.
    expect(replayed).toEqual([
      { type: 'error', code: 'unavailable', message: ENDING_MESSAGES.unavailable },
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
  it('retries a lost settle write once, so a hiccup does not hold the id', async () => {
    // The `start` write succeeds; the completing write fails once, then lands.
    vi.mocked(prisma.appTurn.updateMany)
      .mockImplementationOnce(vi.mocked(prisma.appTurn.updateMany).getMockImplementation()!)
      .mockRejectedValueOnce(new Error('db hiccup'));

    await take(turnFor());

    expect(db.turns[0].status).toBe('completed');
    expect(error).not.toHaveBeenCalled();
    // And the retry is free to run as a replay rather than being refused.
    await take(turnFor());
    expect(modelCalls).toBe(1);
  });

  it('still gives the person their answer, and says the meter missed it', async () => {
    // Every write fails: `start`, the completing write, and its one retry.
    // One-shot, so the fake's real implementation is back for the next case.
    vi.mocked(prisma.appTurn.updateMany)
      .mockRejectedValueOnce(new Error('db hiccup'))
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
    // Left `running` after both tries — STALE_CLAIM_MS is the remedy left.
    expect(db.turns[0].status).toBe('running');
  });

  it('logs a failed failure-write rather than throwing it at the client', async () => {
    behaviour.outcome = 'error';
    // `start`, the failing write, and its one retry. One-shot, so the fake's
    // real implementation is back for the next case.
    vi.mocked(prisma.appTurn.updateMany)
      .mockRejectedValueOnce(new Error('db hiccup'))
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

describe('a client that disconnects mid-answer (§08 t-55)', () => {
  it('does not stop her answer: the turn completes, and the retry is a replay', async () => {
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const turn = turnFor();
    const { stream, finished } = await begin(turn);
    await stream.next(); // `start` — then the connection drops
    await stream.return?.();

    thinking.open();
    await finished;

    // Recorded as the answer it was, not as a failure.
    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 1 });
    expect(modelCalls).toBe(1);
    expect(db.costs).toHaveLength(1);

    const retry = await take(turn);

    // One model call, one cost row, one message from the person — and the whole answer.
    expect(modelCalls).toBe(1);
    expect(db.costs).toHaveLength(1);
    expect(db.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(retry.find((e) => e.type === 'content')).toEqual({
      type: 'content',
      delta: 'Her answer to: Where do I start?',
    });
    expect(retry.at(-1)?.type).toBe('done');
  });

  it('runs even when the stream is never read at all', async () => {
    const turn = turnFor();
    const { finished } = await begin(turn); // the request ended before the response began

    await finished;

    expect(db.turns[0].status).toBe('completed');
  });

  it("calls the model under the seam's own signal, which the request going away never fires", async () => {
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const request = new AbortController();
    const turn = { ...turnFor(), signal: request.signal };
    const { finished } = await begin(turn);

    request.abort();
    thinking.open();
    await finished;

    expect(callSignals).toHaveLength(1);
    expect(callSignals[0]).toBeInstanceOf(AbortSignal);
    expect(callSignals[0]).not.toBe(request.signal);
    expect(callSignals[0]?.aborted).toBe(false);
    expect(db.turns[0].status).toBe('completed');
  });

  it('hands the host its run to keep alive, and survives a host that refuses', async () => {
    const turn = {
      ...turnFor(),
      keepAlive: (): void => {
        throw new Error('`after` was called outside a request scope');
      },
    };
    const result = await runRecordedTurn(turn, fakeRun(turn));
    if ('refused' in result) throw new Error('refused');
    const events: ChatEvent[] = [];
    for await (const event of result) events.push(event);

    expect(events.at(-1)?.type).toBe('done');
    expect(warn).toHaveBeenCalledWith(
      'Agent turn could not be kept alive past its response',
      expect.objectContaining({ error: '`after` was called outside a request scope' })
    );
  });
});

describe('a replay of a turn that used a tool', () => {
  it('tells every pass of the reply again, the sources it cited, and what it called that answered', async () => {
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
        // The platform writes a tool row for every call — its content the
        // whole result — and traces each on the terminal row's provenance:
        // one the model invented and was refused, then the search that answered.
        db.messages.push({
          id: 't1',
          conversationId: 'conv-user-1',
          role: 'tool',
          content: JSON.stringify({ success: true, data: { results: [] } }),
          metadata: null,
          createdAt: new Date(at + 2),
        });
        yield { type: 'content', delta: 'She writes of more [1].' };
        db.messages.push({
          id: 'a2',
          conversationId: 'conv-user-1',
          role: 'assistant',
          content: 'She writes of more [1].',
          metadata: null,
          provenance: {
            citations: [citation],
            capabilityCalls: [
              { slug: 'delete_everything', arguments: {}, latencyMs: 0, success: false },
              { slug: 'search_knowledge_base', arguments: {}, latencyMs: 40, success: true },
            ],
          },
          createdAt: new Date(at + 3),
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
    // What it called, before the words — only the call that answered, so the
    // account under a replayed reply says what a reload's does (t-66).
    const called = replayed.findIndex((e) => e.type === 'capability_results');
    expect(called).toBeGreaterThan(-1);
    expect(called).toBeLessThan(replayed.findIndex((e) => e.type === 'content'));
    expect(replayed[called]).toEqual({
      type: 'capability_results',
      results: [{ capabilitySlug: 'search_knowledge_base', result: { success: true } }],
    });
    expect(JSON.stringify(replayed)).not.toContain('delete_everything');
  });

  it('puts what the turn offered on its own call’s frame, aligned, so a replay’s chip matches a reload’s', async () => {
    const turn = turnFor();
    const offered = (): AsyncIterable<ChatEvent> =>
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
        yield { type: 'content', delta: 'There is a piece on this.' };
        db.messages.push({
          id: 'a1',
          conversationId: 'conv-user-1',
          role: 'assistant',
          content: 'There is a piece on this.',
          metadata: null,
          provenance: {
            citations: [],
            // A search, a suggestion the library still has, and one it has lost
            // — the data must land on the RIGHT frame, not the first suggest.
            capabilityCalls: [
              { slug: 'search_knowledge_base', arguments: {}, latencyMs: 1, success: true },
              {
                slug: 'suggest_resource',
                arguments: { id: 'gone-since' },
                latencyMs: 1,
                success: true,
              },
              {
                slug: 'suggest_resource',
                arguments: { id: 'on-stalling' },
                latencyMs: 1,
                success: true,
              },
            ],
          },
          createdAt: new Date(at + 1),
        });
        yield {
          type: 'done',
          tokenUsage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          costUsd: 0.0001,
          model: PINNED_MODEL,
          provider: 'openai',
        };
      })();
    const live = await runRecordedTurn(turn, offered);
    if ('refused' in live) throw new Error('refused');
    for await (const _event of live);

    const replayed = await take(turn);

    expect(replayed.find((e) => e.type === 'capability_results')).toEqual({
      type: 'capability_results',
      results: [
        { capabilitySlug: 'search_knowledge_base', result: { success: true } },
        { capabilitySlug: 'suggest_resource', result: { success: true } },
        {
          capabilitySlug: 'suggest_resource',
          result: {
            success: true,
            data: {
              id: 'on-stalling',
              kind: 'film',
              title: 'On stalling',
              subtitle: 'why the words you avoid are the work',
              length: '5:04',
            },
          },
        },
      ],
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

    const claim = await claimTurn(request, '1.0', staleClaimMs(60_000));

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
        null,
        staleClaimMs(60_000)
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
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const turn = turnFor();
    const stream = await streamOf(turn);
    // The claim's own timestamp is well AFTER the rows the platform is about to
    // write — the skew a `startedAt` bound would miss the reply under.
    db.turns[0].startedAt = new Date(Date.now() + 60_000);
    thinking.open();
    await drain(stream);

    expect(db.turns[0].status).toBe('completed');
    expect(db.turns[0].assistantMessageId).toBe(
      db.messages.find((m) => m.role === 'assistant')?.id
    );
  });

  it('an attempt that outlived its claim writes nothing over the attempt that replaced it', async () => {
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const turn = turnFor();
    const slow = await streamOf(turn); // attempt 1: claimed, still running
    await slow.next(); // `start`
    // The claim goes stale; a retry takes it over and finishes.
    db.turns[0].startedAt = new Date(Date.now() - staleClaimMs(60_000) - 1000);
    behaviour.gate = undefined;
    behaviour.costUsd = 0.002;
    await take(turn);
    const replacement = { ...db.turns[0] };
    expect(replacement).toMatchObject({ status: 'completed', attempts: 2, costUsd: 0.002 });

    // Attempt 1 finally ends. Its settle names attempt 1, so it changes nothing.
    behaviour.costUsd = 0.00063;
    thinking.open();
    await drain(slow);

    expect(db.turns[0]).toEqual(replacement);
    expect(warn).toHaveBeenCalledWith(
      'Agent turn outlived its claim; a later attempt owns the record',
      expect.objectContaining({ attempts: 1 })
    );
  });
});

/**
 * Read a stream in the background, so the test can move the clock while it is
 * open. `statusAtEnding` is the turn row's status at the moment the ending frame
 * arrived — what a retry sent on seeing it would find.
 */
function readInBackground(stream: AsyncIterator<ChatEvent>): {
  events: ChatEvent[];
  done: Promise<void>;
  statusAtEnding: () => string | undefined;
} {
  const events: ChatEvent[] = [];
  let statusAtEnding: string | undefined;
  const done = (async () => {
    for (let next = await stream.next(); !next.done; next = await stream.next()) {
      if (next.value.type === 'error') statusAtEnding = db.turns[0]?.status;
      events.push(next.value);
    }
  })();
  return { events, done, statusAtEnding: () => statusAtEnding };
}

describe('the two deadlines (§08 t-55)', () => {
  beforeEach(() => {
    // Only the timers: `Date` stays real, so claim ages mean what they say.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no first words by the first-words deadline: says so once, and the turn carries on', async () => {
    const thinking = gate();
    behaviour.gate = thinking.promise;
    const { stream, finished } = await begin(turnFor());
    const reader = readInBackground(stream);

    await vi.advanceTimersByTimeAsync(7_999);
    expect(reader.events.map((e) => e.type)).toEqual(['start']);

    await vi.advanceTimersByTimeAsync(1);
    expect(reader.events.at(-1)).toEqual({
      type: 'warning',
      code: 'still_thinking',
      message: expect.any(String),
    });
    // Not aborted, not settled: a slow answer is still her answer.
    expect(db.turns[0].status).toBe('running');
    expect(callSignals[0]?.aborted).toBe(false);

    thinking.open();
    await reader.done;
    await finished;
    expect(reader.events.map((e) => e.type)).toEqual(['start', 'warning', 'content', 'done']);
    expect(db.turns[0].status).toBe('completed');
  });

  it('words before the first-words deadline: nothing is said about thinking', async () => {
    const { stream, finished } = await begin(turnFor());
    const reader = readInBackground(stream);
    await reader.done;
    await vi.advanceTimersByTimeAsync(60_000);
    await finished;

    expect(reader.events.map((e) => e.type)).toEqual(['start', 'content', 'done']);
  });

  it('the whole-turn deadline ends the turn: timed out, failed, and the same id runs again', async () => {
    behaviour.gate = gate().promise; // never opens: the model never answers
    const { stream, finished } = await begin(turnFor());
    const reader = readInBackground(stream);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(db.turns[0].status).toBe('running');

    await vi.advanceTimersByTimeAsync(1);
    await reader.done;
    await finished;

    expect(reader.events.map((e) => e.type)).toEqual(['start', 'warning', 'error']);
    expect(reader.events.at(-1)).toEqual({
      type: 'error',
      code: 'timed_out',
      message: ENDING_MESSAGES.timed_out,
    });
    // Settled before the reader heard, so a retry sent on seeing it is not a 409.
    expect(reader.statusAtEnding()).toBe('failed');
    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'timed_out' });
    // The model call itself was ended.
    expect(callSignals[0]?.aborted).toBe(true);
    // Hypothesis (a): what it leaves in the transcript — the person's message and
    // the platform's error-marker row, nothing else.
    expect(db.messages.map((m) => [m.role, m.metadata?.errorCode ?? null])).toEqual([
      ['user', null],
      ['assistant', 'aborted'],
    ]);

    behaviour.gate = undefined;
    const retry = await take(turnFor());
    expect(retry.at(-1)?.type).toBe('done');
    expect(modelCalls).toBe(2);
    expect(db.turns[0]).toMatchObject({ status: 'completed', attempts: 2, errorCode: null });
  });

  it('reads the deadlines per request: a change to the stored settings applies to the next turn', async () => {
    behaviour.gate = gate().promise;
    db.settings = { firstWordsDeadlineMs: 1_000, turnDeadlineMs: 5_000 };
    const { stream, finished } = await begin(turnFor());
    const reader = readInBackground(stream);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reader.events.at(-1)).toMatchObject({ code: 'still_thinking' });
    await vi.advanceTimersByTimeAsync(4_000);
    await reader.done;
    await finished;

    expect(reader.events.at(-1)).toMatchObject({ type: 'error', code: 'timed_out' });
    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'timed_out' });
  });

  it('a deadline passing while a finished turn is being recorded does not end it (found by /code-review)', async () => {
    // The model answers just inside the deadline; writing that answer takes past it.
    const writing = gate();
    const realUpdateMany = vi.mocked(prisma.appTurn.updateMany).getMockImplementation()!;
    const slowCompletingWrite = async (
      args: Parameters<typeof realUpdateMany>[0]
    ): Promise<{ count: number }> => {
      if (args.data.status === 'completed') await writing.promise;
      return realUpdateMany(args);
    };
    // The fake returns a plain promise, as the fake it wraps already does.
    vi.mocked(prisma.appTurn.updateMany).mockImplementation(slowCompletingWrite as never);
    const { stream, finished } = await begin(turnFor());
    const reader = readInBackground(stream);

    await vi.advanceTimersByTimeAsync(0);
    // The population: the completing write is in flight, and the deadline passes.
    expect(db.turns[0].status).toBe('running');
    await vi.advanceTimersByTimeAsync(60_000);
    writing.open();
    await reader.done;
    await finished;

    expect(reader.events.map((e) => e.type)).toEqual(['start', 'content', 'done']);
    expect(db.turns[0]).toMatchObject({ status: 'completed', errorCode: null });
    // So the retry is a replay, not a second bill.
    vi.mocked(prisma.appTurn.updateMany).mockImplementation(realUpdateMany);
    await take(turnFor());
    expect(modelCalls).toBe(1);
  });

  it('a reader that left does not stop the deadline', async () => {
    behaviour.gate = gate().promise;
    const { stream, finished } = await begin(turnFor());
    await stream.next();
    await stream.return?.();

    await vi.advanceTimersByTimeAsync(60_000);
    await finished;

    expect(db.turns[0]).toMatchObject({ status: 'failed', errorCode: 'timed_out' });
  });
});

describe('what reaches the browser when she cannot answer (§08 t-55)', () => {
  it('a provider error naming a slug, a model and an env var reaches no frame', async () => {
    behaviour.outcome = 'error';
    behaviour.errorMessage =
      'OPENAI_API_KEY is not set for provider openai (model gpt-4o-mini-2024-07-18)';

    const events = await take(turnFor());
    const wire = JSON.stringify(events);

    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'unavailable',
      message: ENDING_MESSAGES.unavailable,
    });
    for (const secret of ['OPENAI_API_KEY', 'openai', 'gpt-4o-mini', 'provider_unavailable']) {
      expect(behaviour.errorMessage + ' provider_unavailable').toContain(secret); // it was there to leak
      expect(wire).not.toContain(secret);
    }
    // The record keeps the diagnosis the browser does not get.
    expect(db.turns[0].errorCode).toBe('provider_unavailable');
  });

  it('what the person typed is kept, and the id may run again', async () => {
    behaviour.outcome = 'error';
    await take(turnFor());

    expect(db.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'Where do I start?',
    ]);
    expect(db.turns[0].status).toBe('failed');
  });
});

describe('the pause switch (§08 t-55)', () => {
  it('refuses a turn before any model call — shown against the same request running without it', async () => {
    // The population: switch off, the request reaches the model and is billed.
    await take(turnFor({ clientTurnId: 'turn-before' }));
    expect(modelCalls).toBe(1);
    expect(db.costs).toHaveLength(1);

    db.flags.set(GENERATION_PAUSED_FLAG, true);
    const paused = await take(turnFor({ clientTurnId: 'turn-during' }));

    expect(paused).toEqual([{ type: 'error', code: 'paused', message: ENDING_MESSAGES.paused }]);
    expect(modelCalls).toBe(1);
    expect(db.costs).toHaveLength(1);
    // Nothing claimed, so the id is untouched when generation resumes.
    expect(db.turns.map((t) => t.turnId)).toEqual(['turn-before']);

    db.flags.set(GENERATION_PAUSED_FLAG, false);
    const resumed = await take(turnFor({ clientTurnId: 'turn-during' }));
    expect(resumed.at(-1)?.type).toBe('done');
    expect(modelCalls).toBe(2);
  });

  it('still serves a replay: an answer already given calls no model', async () => {
    const answered = await take(turnFor());
    db.flags.set(GENERATION_PAUSED_FLAG, true);

    expect(await take(turnFor())).toEqual(answered);
    expect(modelCalls).toBe(1);
    // …but not a different message under that id, which would be a new turn.
    expect(await take(turnFor({ message: 'Something new.' }))).toEqual([
      { type: 'error', code: 'paused', message: ENDING_MESSAGES.paused },
    ]);
  });
});

describe('the monthly ceiling (f-safety t-59)', () => {
  /** An answer that costs this much — enough that a few turns reach the ceiling. */
  const costing = (costUsd: number): void => {
    behaviour = { ...behaviour, costUsd };
  };

  it('under the ceiling, a turn runs as it always did', async () => {
    costing(1);
    const events = await take(turnFor());
    expect(events.at(-1)?.type).toBe('done');
    expect(modelCalls).toBe(1);
  });

  it('at the ceiling, ends with the figures and reset date — nothing claimed, no model call', async () => {
    // The population: a turn under the ceiling reaches the model and is billed.
    costing(5);
    await take(turnFor({ clientTurnId: 'turn-under' }));
    expect(modelCalls).toBe(1);
    expect(db.turns).toHaveLength(1);

    const over = await take(turnFor({ clientTurnId: 'turn-over' }));

    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({
      type: 'error',
      code: 'ceiling_reached',
      ceiling: { spentUsd: 5, ceilingUsd: 5 },
    });
    const { resetsAt } = (over[0] as unknown as { ceiling: { resetsAt: string } }).ceiling;
    const now = new Date();
    expect(resetsAt).toBe(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
    );
    // No claim — the check stands before it — and no `streamChat` call.
    expect(db.turns.map((t) => t.turnId)).toEqual(['turn-under']);
    expect(modelCalls).toBe(1);
    expect(db.costs).toHaveLength(1);
  });

  it('the turn that crosses the line completes: the check is before the turn, not during it', async () => {
    costing(3);
    await take(turnFor({ clientTurnId: 'turn-a' }));
    const crossing = await take(turnFor({ clientTurnId: 'turn-b' }));
    expect(crossing.at(-1)?.type).toBe('done');
    expect(await take(turnFor({ clientTurnId: 'turn-c' }))).toMatchObject([
      { code: 'ceiling_reached', ceiling: { spentUsd: 6, ceilingUsd: 5 } },
    ]);
  });

  it("honours a person's own limit over the default", async () => {
    costing(1);
    await take(turnFor({ clientTurnId: 'turn-a' }));

    db.budgets.set('user-1', 1);
    expect(await take(turnFor({ clientTurnId: 'turn-b' }))).toMatchObject([
      { code: 'ceiling_reached', ceiling: { ceilingUsd: 1 } },
    ]);
    // Another person, on the default, spends on.
    expect((await take(turnFor({ userId: 'user-2', clientTurnId: 'turn-b' }))).at(-1)?.type).toBe(
      'done'
    );

    db.budgets.set('user-1', 10);
    expect((await take(turnFor({ clientTurnId: 'turn-b' }))).at(-1)?.type).toBe('done');
  });

  it('still serves a replay of a completed turn: it costs nothing', async () => {
    costing(5);
    const answered = await take(turnFor());

    expect(await take(turnFor())).toEqual(answered);
    expect(modelCalls).toBe(1);
    // …but not a different message under that id, which would be a new turn.
    expect(await take(turnFor({ message: 'Something new.' }))).toMatchObject([
      { code: 'ceiling_reached' },
    ]);
  });

  it('a meter that cannot be read lets the turn run, and says so', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('pool exhausted'));
    const events = await take(turnFor());
    expect(events.at(-1)?.type).toBe('done');
    expect(warn).toHaveBeenCalledWith(
      'Monthly ceiling could not be read; the turn is allowed',
      expect.objectContaining({ error: 'pool exhausted' })
    );
  });
});
