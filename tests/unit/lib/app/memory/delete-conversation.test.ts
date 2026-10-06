/**
 * Deleting a conversation: what our turns left behind goes, and nothing else
 * (f-memory t-128).
 *
 * ## The assertions that fail when the behaviour is wrong (`fp6`)
 *
 * Every claim is partly an absence, so each is made over a population where
 * something survives: two conversations of mine, one deleted and one kept, and
 * the other person's conversation, also deleted. A note has versions written
 * from both of my conversations. Each case asserts the kept conversation's
 * turns, ledger rows and versions survive, word for word.
 *
 * ## What is faked
 *
 * The Prisma client (`notes-fake.ts`, shared with the exchange deletion), the
 * context cache (its invalidation asserted as calls) and the org scope. A
 * conversation is "deleted" by removing its row from the fake world, which is
 * what Sunrise's delete leaves behind for us: our turns still pointing at it.
 * The sweep's raw anti-join is answered by the fake from the world; the smoke
 * (`smoke:app-delete-conversation`) runs the SQL.
 *
 * @see lib/app/memory/delete-conversation.ts
 */

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

import {
  definition,
  ME,
  prismaFake,
  resetWorld,
  synopsisEntry,
  THEM,
  value,
  world,
} from '@/tests/unit/lib/app/slots/notes-fake';

const { invalidateContext, logError, logWarn } = vi.hoisted(() => ({
  invalidateContext: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

const { forgetWipedNotes, queueNoteIndex } = vi.hoisted(() => ({
  forgetWipedNotes: vi.fn(async () => 0),
  queueNoteIndex: vi.fn(),
}));
// The index itself is `memory-index.test.ts`'s; here, only that a wipe drops
// its notes' vectors inside its own transaction, and a write queues one (t-107).
const { clearStoredSearchResults } = vi.hoisted(() => ({
  clearStoredSearchResults: vi.fn(async () => 0),
}));
vi.mock('@/lib/app/memory/stored-results', () => ({ clearStoredSearchResults }));
vi.mock('@/lib/app/memory/memory-index', () => ({ forgetWipedNotes, queueNoteIndex }));

vi.mock('@/lib/db/client', async () => ({
  prisma: (await import('@/tests/unit/lib/app/slots/notes-fake')).prismaFake,
}));
vi.mock('@/lib/db/utils', async () => {
  const { prismaFake } = await import('@/tests/unit/lib/app/slots/notes-fake');
  return {
    executeTransaction: (work: (tx: typeof prismaFake) => Promise<unknown>) => work(prismaFake),
  };
});
vi.mock('@/lib/orchestration/chat/context-builder', () => ({ invalidateContext }));
vi.mock('@/lib/app/agent/settings', () => ({
  getAgentDeadlines: async () => ({ firstWordsDeadlineMs: 30_000, turnDeadlineMs: 120_000 }),
}));
vi.mock('@/lib/framework/modules/registry', () => ({
  getRegisteredModules: () => [{ slug: 'values' }],
}));
const { runAsSystem } = vi.hoisted(() => ({
  runAsSystem: vi.fn((_reason: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/tenancy/context', () => ({ requireOrgId: () => 'org-1', runAsSystem }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: logWarn, error: logError, debug: vi.fn() },
}));

const {
  __resetSweepFailuresForTests,
  MAX_SWEEP_ATTEMPTS,
  findDeletedConversations,
  forgetDeletedConversations,
  sweepDeletedConversations,
  onConversationsDeleted,
} = await import('@/lib/app/memory/delete-conversation');
const { REMOVED_SLUG_PREFIX, REMOVED_SOURCE_TYPE } = await import('@/lib/app/slots/removed');

const DELETED = 'conv-deleted';
const KEPT = 'conv-kept';
const THEIRS = 'conv-theirs';

function turn(
  id: string,
  conversationId: string,
  overrides: Partial<(typeof world.turns)[number]> = {}
): void {
  world.turns.push({
    id,
    userId: ME,
    turnId: `client-${id}`,
    status: 'completed',
    startedAt: new Date(0),
    conversationId,
    userMessageId: null,
    ...overrides,
  });
}

function ledger(turnId: string, slotSlug: string, version: number, userId = ME): void {
  world.ledger.push({ turnId, userId, slotSlug, version });
}

function conversation(id: string, userId = ME): void {
  world.conversations.push({ id, userId, title: null, summary: null, summaryUpToMessageId: null });
}

function rowsOf(userId: string, slotSlug: string) {
  return world.values
    .filter((row) => row.userId === userId && row.slotSlug === slotSlug)
    .sort((a, b) => a.version - b.version);
}

/**
 * - DELETED (gone): turn-a wrote `life_work` v2, turn-c wrote `my_garden` v1
 *   (a heading the AI coined, nothing else under it).
 * - KEPT (still there): turn-b wrote `life_work` v3.
 * - THEIRS (gone): turn-x, the other person's, wrote their `life_work` v1.
 */
function population(): void {
  conversation(KEPT);
  turn('turn-a', DELETED);
  turn('turn-c', DELETED);
  turn('turn-b', KEPT);
  turn('turn-x', THEIRS, { userId: THEM });
  world.projections.push(definition('life_work'));
  world.values.push(
    value(ME, 'life_work', { version: 1, value: 'teaches', supersededAt: new Date(5_000) }),
    value(ME, 'life_work', {
      version: 2,
      value: 'stopped teaching',
      supersededAt: new Date(6_000),
    }),
    value(ME, 'life_work', { version: 3, value: 'retraining as a nurse' }),
    value(ME, 'my_garden', { version: 1, value: 'grows roses for her mother' }),
    value(THEM, 'life_work', { version: 1, value: 'their own words' })
  );
  ledger('turn-a', 'life_work', 2);
  ledger('turn-c', 'my_garden', 1);
  ledger('turn-b', 'life_work', 3);
  ledger('turn-x', 'life_work', 1, THEM);
}

beforeEach(() => {
  resetWorld();
  vi.clearAllMocks();
  __resetSweepFailuresForTests();
  population();
});

describe('forgetDeletedConversations', () => {
  it('deletes the turns and ledger rows of a deleted conversation, and keeps the kept one’s', async () => {
    expect(world.turns.filter((row) => row.conversationId === DELETED)).toHaveLength(2);

    const result = await forgetDeletedConversations([DELETED], { userId: ME });

    expect(result).toEqual({ turns: 2, versions: 2, deferred: 0, failed: 0 });
    expect(world.turns.map((row) => row.id).sort()).toEqual(['turn-b', 'turn-x']);
    expect(world.ledger.map((row) => row.turnId).sort()).toEqual(['turn-b', 'turn-x']);
    // A memory search in another conversation may hold a copy of its words (t-130).
    expect(clearStoredSearchResults).toHaveBeenCalledWith(expect.anything(), { userId: ME });
  });

  it('makes placeholders of only the versions its turns wrote', async () => {
    await forgetDeletedConversations([DELETED], { userId: ME });

    const lifeWork = rowsOf(ME, 'life_work');
    expect(lifeWork.map((row) => row.sourceType)).toEqual([
      'inferred',
      REMOVED_SOURCE_TYPE,
      'inferred',
    ]);
    expect(lifeWork[0].value).toBe('teaches');
    expect(lifeWork[2].value).toBe('retraining as a nurse');
    expect(JSON.stringify(world.values)).not.toContain('stopped teaching');
  });

  it('moves a heading the AI coined once nothing under it is left, and keeps a taxonomy one', async () => {
    await forgetDeletedConversations([DELETED], { userId: ME });

    expect(rowsOf(ME, 'my_garden')).toHaveLength(0);
    const moved = world.values.filter((row) => row.slotSlug.startsWith(REMOVED_SLUG_PREFIX));
    expect(moved).toHaveLength(1);
    expect(moved[0].sourceType).toBe(REMOVED_SOURCE_TYPE);
    expect(JSON.stringify(world.values)).not.toContain('roses');
    expect(rowsOf(ME, 'life_work')).toHaveLength(3);
  });

  it('never touches another person’s turns or notes, even when their conversation is gone too', async () => {
    await forgetDeletedConversations([DELETED, THEIRS], { userId: ME });

    expect(world.turns.some((row) => row.id === 'turn-x')).toBe(true);
    expect(world.ledger.some((row) => row.turnId === 'turn-x')).toBe(true);
    expect(rowsOf(THEM, 'life_work')[0].value).toBe('their own words');
  });

  it('asks whether a conversation is gone past row-level security, so a hidden one is not taken', async () => {
    await forgetDeletedConversations([DELETED], { userId: ME });

    expect(runAsSystem).toHaveBeenCalledTimes(1);
    expect(prismaFake.aiConversation.findMany).toHaveBeenCalledTimes(1);
    // The read ran inside the system scope, not beside it.
    expect(runAsSystem.mock.invocationCallOrder[0]).toBeLessThan(
      prismaFake.aiConversation.findMany.mock.invocationCallOrder[0]
    );
  });

  it('touches nothing for a conversation that still exists', async () => {
    const before = JSON.stringify(world);

    const result = await forgetDeletedConversations([KEPT], { userId: ME });

    expect(result).toEqual({ turns: 0, versions: 0, deferred: 0, failed: 0 });
    expect(JSON.stringify(world)).toBe(before);
    expect(clearStoredSearchResults).not.toHaveBeenCalled();
  });

  it('clears the person’s stored search results for a deleted conversation with no turns (t-130)', async () => {
    world.turns = world.turns.filter((row) => row.conversationId !== DELETED);

    const result = await forgetDeletedConversations([DELETED], { userId: ME });

    expect(result).toEqual({ turns: 0, versions: 0, deferred: 0, failed: 0 });
    expect(clearStoredSearchResults).toHaveBeenCalledWith(expect.anything(), { userId: ME });
  });

  it('leaves the clear to the per-person transactions on the sweep, which knows no person', async () => {
    world.turns = world.turns.filter((row) => row.conversationId !== DELETED);

    await forgetDeletedConversations([DELETED]);

    expect(clearStoredSearchResults).not.toHaveBeenCalled();
  });

  it('leaves a turn still being answered for the sweep, and takes an abandoned one', async () => {
    const now = Date.now();
    world.turns.find((row) => row.id === 'turn-a')!.status = 'running';
    world.turns.find((row) => row.id === 'turn-a')!.startedAt = new Date(now - 1_000);
    world.turns.find((row) => row.id === 'turn-c')!.status = 'running';
    world.turns.find((row) => row.id === 'turn-c')!.startedAt = new Date(now - 60 * 60_000);

    const result = await forgetDeletedConversations([DELETED], { userId: ME });

    expect(result).toEqual({ turns: 1, versions: 1, deferred: 1, failed: 0 });
    expect(world.turns.some((row) => row.id === 'turn-a')).toBe(true);
    expect(world.turns.some((row) => row.id === 'turn-c')).toBe(false);
    expect(rowsOf(ME, 'life_work')[1].value).toBe('stopped teaching');
  });

  it('keeps a turn retried since it was read, so the new attempt’s ledger row survives', async () => {
    // claimTurn takes a failed turn back between the read and the delete: it
    // is running again, its conversation reset.
    prismaFake.slotValue.updateMany.mockImplementationOnce(async () => {
      const retried = world.turns.find((row) => row.id === 'turn-a')!;
      retried.status = 'running';
      retried.conversationId = null;
      world.ledger.push({ turnId: 'turn-a', userId: ME, slotSlug: 'life_rhythm', version: 9 });
      return { count: 1 };
    });

    const result = await forgetDeletedConversations([DELETED], { userId: ME });

    expect(result.turns).toBe(1);
    expect(world.turns.some((row) => row.id === 'turn-a')).toBe(true);
    expect(world.ledger).toContainEqual({
      turnId: 'turn-a',
      userId: ME,
      slotSlug: 'life_rhythm',
      version: 9,
    });
    expect(world.turns.some((row) => row.id === 'turn-c')).toBe(false);
  });

  it('carries on for everyone else when one person’s forgetting fails', async () => {
    world.conversations = world.conversations.filter((row) => row.id !== THEIRS);
    const deleteMany = prismaFake.appTurn.deleteMany.getMockImplementation()!;
    prismaFake.appTurn.deleteMany.mockImplementation(async (args) => {
      if (args.where.userId === ME) throw new Error('lock timeout');
      return deleteMany(args);
    });
    try {
      const result = await forgetDeletedConversations([DELETED, THEIRS]);

      expect(result).toEqual({ turns: 1, versions: 1, deferred: 0, failed: 2 });
      expect(world.turns.some((row) => row.id === 'turn-x')).toBe(false);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('Could not forget'), {
        conversationId: DELETED,
        turns: 2,
        attempts: 1,
        error: 'lock timeout',
      });
    } finally {
      prismaFake.appTurn.deleteMany.mockImplementation(deleteMany);
    }
  });

  it('changes nothing on a second run', async () => {
    await forgetDeletedConversations([DELETED], { userId: ME });
    const after = JSON.stringify(world.values);

    const again = await forgetDeletedConversations([DELETED], { userId: ME });

    expect(again).toEqual({ turns: 0, versions: 0, deferred: 0, failed: 0 });
    expect(JSON.stringify(world.values)).toBe(after);
  });

  it('drops the person’s cached context blocks', async () => {
    await forgetDeletedConversations([DELETED], { userId: ME });

    expect(invalidateContext).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      userId: ME,
    });
    expect(invalidateContext).not.toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      userId: THEM,
    });
  });
});

describe('the synopses of the sessions its turns were in (t-147)', () => {
  const DELETED_AT = new Date('2026-10-06T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DELETED_AT);
    // turn-a and turn-c (deleted) in two sessions; turn-b (kept) in a third;
    // theirs under session one's id too.
    const sessionOf: Record<string, string> = {
      'turn-a': 'ses_one',
      'turn-c': 'ses_two',
      'turn-b': 'ses_three',
      'turn-x': 'ses_one',
    };
    for (const row of world.turns) row.sessionId = sessionOf[row.id];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const entry = (id: string) => world.entries.find((row) => row.id === id);

  function synopses() {
    const draft = synopsisEntry({ sessionId: 'ses_one' });
    const kept = synopsisEntry({ sessionId: 'ses_two', state: 'kept', keptAt: new Date(1) });
    const untouched = synopsisEntry({ sessionId: 'ses_three' });
    const theirs = synopsisEntry({ userId: THEM, sessionId: 'ses_one' });
    world.entries.push(draft, kept, untouched, theirs);
    expect(world.entries).toHaveLength(4);
    return { draft, kept, untouched, theirs };
  }

  it('removes a draft, flags a kept one, and leaves the kept conversation’s and theirs alone', async () => {
    const { draft, kept, untouched, theirs } = synopses();

    await forgetDeletedConversations([DELETED], { userId: ME });

    expect(entry(draft.id)).toBeUndefined();
    expect(entry(kept.id)).toMatchObject({ state: 'kept', sourceRemovedAt: DELETED_AT });
    expect(entry(untouched.id)).toMatchObject({ state: 'draft', sourceRemovedAt: null });
    expect(entry(theirs.id)).toMatchObject({ state: 'draft', sourceRemovedAt: null });
  });

  it('settles each person’s own on the sweep, and only theirs', async () => {
    const { draft, kept, untouched, theirs } = synopses();

    await sweepDeletedConversations();

    expect(entry(draft.id)).toBeUndefined();
    expect(entry(kept.id)?.sourceRemovedAt).toEqual(DELETED_AT);
    expect(entry(untouched.id)).toMatchObject({ state: 'draft', sourceRemovedAt: null });
    // Their conversation is gone too, so their session's draft goes with it.
    expect(entry(theirs.id)).toBeUndefined();
  });

  it('touches no synopsis for turns taken before sessions', async () => {
    for (const row of world.turns) row.sessionId = null;
    const { draft, kept } = synopses();

    await forgetDeletedConversations([DELETED], { userId: ME });

    expect(entry(draft.id)).toBeDefined();
    expect(entry(kept.id)?.sourceRemovedAt).toBeNull();
  });
});

describe('sweepDeletedConversations', () => {
  it('forgets what every deleted conversation in the org left, whoever’s, and keeps the kept one', async () => {
    const result = await sweepDeletedConversations();

    expect(result).toEqual({ turns: 3, versions: 3, deferred: 0, failed: 0 });
    expect(world.turns.map((row) => row.id)).toEqual(['turn-b']);
    expect(rowsOf(THEM, 'life_work')[0].sourceType).toBe(REMOVED_SOURCE_TYPE);
    expect(rowsOf(ME, 'life_work')[2].value).toBe('retraining as a nurse');
  });

  it('binds the org and the batch size', async () => {
    expect(await findDeletedConversations(7)).toEqual([DELETED, THEIRS]);

    const [, ...bound] = prismaFake.$queryRaw.mock.calls[0];
    expect(bound).toEqual(['org-1', [], 7]);
  });

  it('stops offering a conversation that keeps failing, so the rest are reached', async () => {
    world.conversations.push({
      id: THEIRS,
      userId: THEM,
      title: null,
      summary: null,
      summaryUpToMessageId: null,
    });
    const deleteMany = prismaFake.appTurn.deleteMany.getMockImplementation()!;
    prismaFake.appTurn.deleteMany.mockImplementation(async () => {
      throw new Error('lock timeout');
    });
    try {
      for (let run = 1; run < MAX_SWEEP_ATTEMPTS; run += 1) {
        await sweepDeletedConversations();
        expect(await findDeletedConversations()).toEqual([DELETED]);
      }
      await sweepDeletedConversations();
      expect(await findDeletedConversations()).toEqual([]);
      expect(logWarn).toHaveBeenCalledTimes(1);
      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('Gave up'), {
        conversationId: DELETED,
        attempts: MAX_SWEEP_ATTEMPTS,
      });
    } finally {
      prismaFake.appTurn.deleteMany.mockImplementation(deleteMany);
    }
  });

  it('counts a failure against the conversation that failed, not its owner’s others', async () => {
    const OTHER = 'conv-deleted-too';
    turn('turn-d', OTHER);
    ledger('turn-d', 'life_work', 1);
    const deleteMany = prismaFake.appTurn.deleteMany.getMockImplementation()!;
    prismaFake.appTurn.deleteMany.mockImplementation(async (args) => {
      if (args.where.conversationId?.in.includes(DELETED)) throw new Error('lock timeout');
      return deleteMany(args);
    });
    try {
      const result = await forgetDeletedConversations([DELETED, OTHER], { userId: ME });

      expect(result).toEqual({ turns: 1, versions: 1, deferred: 0, failed: 2 });
      expect(world.turns.some((row) => row.id === 'turn-d')).toBe(false);
      expect(world.turns.filter((row) => row.conversationId === DELETED)).toHaveLength(2);
    } finally {
      prismaFake.appTurn.deleteMany.mockImplementation(deleteMany);
    }
  });

  it('takes a conversation that failed once on the next run', async () => {
    const deleteMany = prismaFake.appTurn.deleteMany.getMockImplementation()!;
    prismaFake.appTurn.deleteMany.mockImplementationOnce(async () => {
      throw new Error('lock timeout');
    });
    await sweepDeletedConversations();
    prismaFake.appTurn.deleteMany.mockImplementation(deleteMany);

    const result = await sweepDeletedConversations();

    // The first run took the other person's turn already.
    expect(result.turns).toBe(2);
    expect(world.turns.map((row) => row.id)).toEqual(['turn-b']);
  });

  it('does nothing when no conversation is gone', async () => {
    world.turns = world.turns.filter((row) => row.conversationId === KEPT);
    const before = JSON.stringify(world);

    expect(await sweepDeletedConversations()).toEqual({
      turns: 0,
      versions: 0,
      deferred: 0,
      failed: 0,
    });
    expect(JSON.stringify(world)).toBe(before);
  });
});

describe('onConversationsDeleted', () => {
  it('forgets the person’s deleted conversation at once', async () => {
    await onConversationsDeleted({ conversationIds: [DELETED], userId: ME });

    expect(world.turns.some((row) => row.conversationId === DELETED)).toBe(false);
    expect(world.turns.some((row) => row.id === 'turn-x')).toBe(true);
  });

  it('logs a failure rather than throwing, since the conversation is already gone', async () => {
    prismaFake.aiConversation.findMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      onConversationsDeleted({ conversationIds: [DELETED], userId: ME })
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('the sweep will'), {
      conversations: 1,
      error: 'connection reset',
    });
    expect(world.turns.filter((row) => row.conversationId === DELETED)).toHaveLength(2);
  });
});
