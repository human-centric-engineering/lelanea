/**
 * The transcript read: the join, and the two corrections the platform cannot
 * make (§10 t-64).
 *
 * Each correction is asserted against a fixture where the thing corrected is
 * first shown to be there — a doubled row is only worth collapsing if the
 * fixture had two, and a marker row only worth hiding if it was present.
 *
 * @see lib/app/conversation/transcript.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ME = 'cmjbv4i3x00003wsloputgwul';
const CONVERSATION = 'cmconv0000000000000000001';

const { findMessages, findTurns, resolveSurface } = vi.hoisted(() => ({
  findMessages: vi.fn(),
  findTurns: vi.fn(),
  resolveSurface: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiMessage: { findMany: findMessages },
    appTurn: { findMany: findTurns },
  },
}));
vi.mock('@/lib/framework/facilitation/agents/surface', () => ({
  resolveFacilitationSurface: resolveSurface,
  FACILITATION_SURFACE_CONTEXT_TYPE: 'facilitation',
}));

import {
  assembleTranscript,
  CONVERSATION_SEAT,
  readTranscript,
} from '@/lib/app/conversation/transcript';
import type { AuthenticatedSession } from '@/lib/auth/guards';

/**
 * Enough of an `AuthenticatedSession` for the read: a member, whose policy
 * answer for ownerless conversations is no — the visibility helper's owner
 * arm alone. (Precedent: `conversation-access.test.ts`.)
 */
const SESSION = {
  user: { id: ME, role: 'USER' },
  principal: { userId: ME, role: 'USER', credential: 'session' },
  unattributedReads: { conversation: false, dataset: false, execution: false, experiment: false },
} as unknown as AuthenticatedSession;

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 19, 12, 0, seconds));

function user(id: string, text: string, seconds: number, turnId?: string) {
  return {
    id,
    role: 'user',
    content: text,
    createdAt: at(seconds),
    metadata: turnId ? { app: { turnId, seat: 'facilitator' } } : null,
    provenance: null,
  };
}

function assistant(id: string, text: string, seconds: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    role: 'assistant',
    content: text,
    createdAt: at(seconds),
    metadata: extra.metadata ?? null,
    provenance: extra.provenance ?? null,
  };
}

function turn(
  turnId: string,
  fields: Partial<{
    status: 'running' | 'completed' | 'failed';
    attempts: number;
    userMessageId: string | null;
    assistantMessageId: string | null;
    costUsd: number | null;
    pricing: 'priced' | 'unpriced' | 'local' | null;
    errorCode: string | null;
    modelId: string | null;
    fingerprintVersion: string | null;
  }> = {}
) {
  return {
    turnId,
    seat: 'facilitator',
    status: 'completed' as const,
    attempts: 1,
    modelId: 'gpt-4o-mini-2024-07-18',
    providerSlug: 'openai',
    fingerprintVersion: 'v1',
    inputTokens: 100,
    outputTokens: 40,
    costUsd: 0.00063,
    pricing: 'priced' as const,
    errorCode: null,
    startedAt: at(0),
    completedAt: at(5),
    userMessageId: null,
    assistantMessageId: null,
    ...fields,
  };
}

describe('assembleTranscript', () => {
  it('pairs a reply with the turn row that names it, carrying the account', () => {
    const entries = assembleTranscript(
      [user('u1', 'Hello', 1, 't1'), assistant('a1', 'Welcome.', 3)],
      [turn('t1', { userMessageId: 'u1', assistantMessageId: 'a1' })]
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'user', id: 'u1', text: 'Hello', turnId: 't1' });
    expect(entries[1]).toMatchObject({
      kind: 'reply',
      id: 'a1',
      text: 'Welcome.',
      turnId: 't1',
      turn: {
        turnId: 't1',
        modelId: 'gpt-4o-mini-2024-07-18',
        fingerprintVersion: 'v1',
        costUsd: 0.00063,
        pricing: 'priced',
        status: 'completed',
      },
    });
  });

  it('collapses the doubled message a retried failed turn writes', () => {
    // §08 t-54's known limit: the platform writes the person's message before
    // every model call. A turn that failed and ran again under the same id has
    // the row twice; the turn row names the attempt that ran.
    const messages = [
      user('u1', 'Tell me about values', 1, 't1'),
      assistant('marker', '[An error occurred and the response could not be completed.]', 2, {
        metadata: { error: true, errorCode: 'aborted' },
      }),
      user('u2', 'Tell me about values', 10, 't1'),
      assistant('a2', 'Values are…', 12),
    ];
    // The population: two user rows for the one turn, present in the fixture.
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(2);

    const entries = assembleTranscript(messages, [
      turn('t1', { attempts: 2, userMessageId: 'u2', assistantMessageId: 'a2' }),
    ]);

    const users = entries.filter((e) => e.kind === 'user');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 'u2', turnId: 't1' });
    expect(entries.map((e) => e.kind)).toEqual(['user', 'reply']);
  });

  it('keeps two messages with the same words apart when they are different turns', () => {
    // Saying the same thing twice on purpose is two turns, and both stay.
    const entries = assembleTranscript(
      [
        user('u1', 'Hello?', 1, 't1'),
        assistant('a1', 'Hello.', 2),
        user('u2', 'Hello?', 3, 't2'),
        assistant('a2', 'Still here.', 4),
      ],
      [
        turn('t1', { userMessageId: 'u1', assistantMessageId: 'a1' }),
        turn('t2', { userMessageId: 'u2', assistantMessageId: 'a2' }),
      ]
    );
    expect(entries.filter((e) => e.kind === 'user')).toHaveLength(2);
  });

  it('hides the platform’s error-marker row and lets the turn row say what happened', () => {
    const messages = [
      user('u1', 'Are you there?', 1, 't1'),
      assistant('marker', '[An error occurred and the response could not be completed.]', 2, {
        metadata: { error: true, errorCode: 'aborted' },
      }),
    ];
    // The population: the marker is in the fixture.
    expect(messages.some((m) => m.content.startsWith('[An error'))).toBe(true);

    const entries = assembleTranscript(messages, [
      turn('t1', { status: 'failed', errorCode: 'timed_out', userMessageId: 'u1' }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('user');
    expect(JSON.stringify(entries)).not.toContain('An error occurred');
  });

  it('joins a tool-using turn’s passes into one reply, keyed on the terminal row', () => {
    const entries = assembleTranscript(
      [
        user('u1', 'What does she say about boundaries?', 1, 't1'),
        assistant('pass1', 'Let me look. ', 2),
        assistant('pass2', 'She says…', 4, { provenance: { citations: [] } }),
      ],
      [turn('t1', { userMessageId: 'u1', assistantMessageId: 'pass2' })]
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      kind: 'reply',
      id: 'pass2',
      text: 'Let me look. She says…',
    });
  });

  it('carries a reply written before the seam existed, with no account', () => {
    const entries = assembleTranscript([user('u0', 'old', 1), assistant('a0', 'older', 2)], []);
    expect(entries[0]).toMatchObject({ kind: 'user', turnId: null });
    expect(entries[1]).toMatchObject({ kind: 'reply', turnId: null, turn: null });
  });

  it('reads citations off the terminal row’s provenance', () => {
    const citation = {
      marker: 1,
      chunkId: 'ch',
      documentId: 'doc',
      documentName: 'Boundaries',
      contentHash: null,
      documentVersion: null,
      section: null,
      patternNumber: null,
      patternName: null,
      excerpt: 'A boundary is…',
      similarity: 0.8,
    };
    const entries = assembleTranscript(
      [
        user('u1', 'q', 1, 't1'),
        assistant('a1', 'r', 2, { provenance: { citations: [citation] } }),
      ],
      [turn('t1', { userMessageId: 'u1', assistantMessageId: 'a1' })]
    );
    expect(entries[1]).toMatchObject({ kind: 'reply', citations: [citation] });
  });
});

describe('readTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMessages.mockResolvedValue([]);
    findTurns.mockResolvedValue([]);
  });

  it('is empty, not an error, when there is no surface', async () => {
    resolveSurface.mockResolvedValue(null);
    await expect(readTranscript(SESSION, CONVERSATION_SEAT)).resolves.toEqual({
      seat: CONVERSATION_SEAT,
      conversationId: null,
      entries: [],
    });
    expect(findMessages).not.toHaveBeenCalled();
  });

  it('is empty when the surface has no conversation to resume yet', async () => {
    resolveSurface.mockResolvedValue({ agentId: 'a', agentSlug: 's', conversationId: undefined });
    const transcript = await readTranscript(SESSION, CONVERSATION_SEAT);
    expect(transcript.conversationId).toBeNull();
    expect(findMessages).not.toHaveBeenCalled();
  });

  it('reads the resumable conversation under the caller’s id, both tables', async () => {
    resolveSurface.mockResolvedValue({
      agentId: 'a',
      agentSlug: 's',
      conversationId: CONVERSATION,
    });
    findMessages.mockResolvedValue([user('u1', 'hi', 1, 't1'), assistant('a1', 'hello', 2)]);
    findTurns.mockResolvedValue([turn('t1', { userMessageId: 'u1', assistantMessageId: 'a1' })]);

    const transcript = await readTranscript(SESSION, CONVERSATION_SEAT);

    expect(resolveSurface).toHaveBeenCalledWith(ME, CONVERSATION_SEAT);
    const where = findMessages.mock.calls[0][0].where;
    expect(where.conversationId).toBe(CONVERSATION);
    // Through the platform's visibility helper, composed with AND and narrowed
    // to the owner: the shared and ownerless arms cannot widen a transcript.
    expect(where.conversation.AND).toEqual([{ OR: [{ userId: ME }] }, { userId: ME }]);
    expect(findTurns.mock.calls[0][0].where).toEqual({
      userId: ME,
      conversationId: CONVERSATION,
    });
    expect(transcript.conversationId).toBe(CONVERSATION);
    expect(transcript.entries).toHaveLength(2);
  });
});
