/**
 * Deleting a whole session: what goes, what stays, and who can reach it
 * (f-forget-session t-153).
 *
 * ## The assertions that fail when the behaviour is wrong (`fp6`)
 *
 * Every claim is partly an absence, so each is made over a population where
 * something survives: two sessions of mine, each with exchanges, notes and a
 * recap, and the other person's session begun at the same moment, with the
 * same note heading and a recap of their own. Each case asserts the sibling
 * session's words, versions and recaps survive.
 *
 * ## What is faked
 *
 * The Prisma client (`notes-fake.ts`) and the context cache. The session read
 * (`readSessionsById`), Daybreak's value engine and the turn window are real.
 *
 * @see lib/app/memory/delete-session.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  definition,
  ME,
  resetWorld,
  synopsisEntry,
  THEM,
  value,
  world,
  type MessageRow,
} from '@/tests/unit/lib/app/slots/notes-fake';

const { invalidateContext } = vi.hoisted(() => ({ invalidateContext: vi.fn() }));
const { forgetWipedNotes, queueNoteIndex, forgetSourceRemovedJourneyEntries } = vi.hoisted(() => ({
  forgetWipedNotes: vi.fn(async () => 0),
  queueNoteIndex: vi.fn(),
  forgetSourceRemovedJourneyEntries: vi.fn(async () => 0),
}));
const { clearStoredSearchResults } = vi.hoisted(() => ({
  clearStoredSearchResults: vi.fn(async () => 0),
}));
const { executeTransaction } = vi.hoisted(() => ({ executeTransaction: vi.fn() }));
vi.mock('@/lib/app/memory/stored-results', () => ({ clearStoredSearchResults }));
vi.mock('@/lib/app/memory/memory-index', () => ({
  forgetWipedNotes,
  queueNoteIndex,
  forgetSourceRemovedJourneyEntries,
}));
vi.mock('@/lib/db/client', async () => ({
  prisma: (await import('@/tests/unit/lib/app/slots/notes-fake')).prismaFake,
}));
vi.mock('@/lib/db/utils', () => ({ executeTransaction }));
vi.mock('@/lib/orchestration/chat/context-builder', () => ({ invalidateContext }));
vi.mock('@/lib/app/agent/settings', () => ({
  getAgentDeadlines: async () => ({ firstWordsDeadlineMs: 30_000, turnDeadlineMs: 120_000 }),
}));
vi.mock('@/lib/framework/modules/registry', () => ({
  getRegisteredModules: () => [{ slug: 'values' }],
}));

const { deleteSession, SESSION_DELETION_TIMEOUT_MS } =
  await import('@/lib/app/memory/delete-session');
const { prismaFake } = await import('@/tests/unit/lib/app/slots/notes-fake');
const { NotFoundError, ConflictError } = await import('@/lib/api/errors');
const { REMOVED_SOURCE_TYPE } = await import('@/lib/app/slots/removed');
const { recapTurnId } = await import('@/lib/app/conversation/opening-id');

const MINE = 'conv-mine';
const THEIRS = 'conv-theirs';
const DELETED_AT = new Date('2026-10-08T12:00:00.000Z');
const at = (ms: number) => new Date(ms).toISOString();
const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id).sort();

function message(
  id: string,
  role: MessageRow['role'],
  ms: number,
  conversationId = MINE,
  ownerId = ME
): MessageRow {
  return { id, conversationId, ownerId, role, content: `words of ${id}`, createdAt: new Date(ms) };
}

function turn(
  id: string,
  userMessageId: string | null,
  overrides: Partial<(typeof world.turns)[number]> = {}
): void {
  world.turns.push({
    id,
    userId: ME,
    turnId: `client-${id}`,
    status: 'completed',
    startedAt: new Date(0),
    conversationId: MINE,
    userMessageId,
    ...overrides,
  });
}

function recap(
  id: string,
  session: string,
  since: number,
  overrides: Partial<(typeof world.turns)[number]> & { source?: 'synopsis' | 'words' } = {}
): void {
  const { source = 'words', ...row } = overrides;
  world.turns.push({
    id,
    userId: ME,
    turnId: recapTurnId(session),
    status: 'completed',
    startedAt: new Date(0),
    conversationId: MINE,
    userMessageId: null,
    sessionId: session,
    recap: { since: at(since), source, words: 2, notes: [], journey: 0 },
    ...row,
  });
}

/**
 * Two sessions of mine, and one of theirs begun at the same moment as my first.
 *
 * - ses_one (began 1s): turn-a (m1 · m2) wrote `life_work` v1; turn-b (m3 · m4)
 *   wrote `life_rhythm` v1.
 * - ses_two (began 100s): recap-two looking back on ses_one (r1, repeating m1);
 *   then turn-c (m5 · m6), writing `life_work` v2.
 * - theirs, their_one (began 1s): turn-x (t1 · t2) wrote their `life_work` v1;
 *   their_two's recap looked back on it (tr1).
 */
function twoSessions(): void {
  world.sessions.push(
    { id: 'ses_one', userId: ME, occurredAt: new Date(1_000), ordinal: 1 },
    { id: 'ses_two', userId: ME, occurredAt: new Date(100_000), ordinal: 2 },
    { id: 'their_one', userId: THEM, occurredAt: new Date(1_000), ordinal: 1 },
    { id: 'their_two', userId: THEM, occurredAt: new Date(100_000), ordinal: 2 }
  );
  world.messages.push(
    message('m1', 'user', 10_000),
    message('m2', 'assistant', 11_000),
    message('m3', 'user', 20_000),
    message('m4', 'assistant', 21_000),
    { ...message('r1', 'assistant', 101_000), content: 'Last time you said "words of m1".' },
    message('m5', 'user', 110_000),
    message('m6', 'assistant', 111_000),
    message('t1', 'user', 10_000, THEIRS, THEM),
    message('t2', 'assistant', 11_000, THEIRS, THEM),
    { ...message('tr1', 'assistant', 101_000, THEIRS, THEM), content: 'You said "words of t1".' }
  );
  turn('turn-a', 'm1', { sessionId: 'ses_one', startedAt: new Date(10_000) });
  turn('turn-b', 'm3', { sessionId: 'ses_one', startedAt: new Date(20_000) });
  recap('recap-two', 'ses_two', 1_000, { startedAt: new Date(100_500) });
  turn('turn-c', 'm5', { sessionId: 'ses_two', startedAt: new Date(110_000) });
  turn('turn-x', 't1', {
    userId: THEM,
    conversationId: THEIRS,
    sessionId: 'their_one',
    startedAt: new Date(10_000),
  });
  recap('their-recap', 'their_two', 1_000, {
    userId: THEM,
    conversationId: THEIRS,
    startedAt: new Date(100_500),
  });
  world.values.push(
    value(ME, 'life_work', { version: 1, value: 'teaches', supersededAt: new Date(100_000) }),
    value(ME, 'life_work', { version: 2, value: 'retraining as a nurse' }),
    value(ME, 'life_rhythm', { version: 1, value: 'early riser' }),
    value(THEM, 'life_work', { version: 1, value: 'their own words' })
  );
  world.ledger.push(
    { turnId: 'turn-a', userId: ME, slotSlug: 'life_work', version: 1 },
    { turnId: 'turn-b', userId: ME, slotSlug: 'life_rhythm', version: 1 },
    { turnId: 'turn-c', userId: ME, slotSlug: 'life_work', version: 2 },
    { turnId: 'turn-x', userId: THEM, slotSlug: 'life_work', version: 1 }
  );
}

const rowsOf = (userId: string, slotSlug: string) =>
  world.values
    .filter((row) => row.userId === userId && row.slotSlug === slotSlug)
    .sort((a, b) => a.version - b.version);
const entry = (id: string) => world.entries.find((row) => row.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(DELETED_AT);
  resetWorld();
  world.projections = [definition('life_work'), definition('life_rhythm')];
  world.ours = world.projections.map((row) => ({ slug: row.slug, visibility: row.visibility }));
  executeTransaction.mockImplementation((work: (tx: typeof prismaFake) => Promise<unknown>) =>
    work(prismaFake)
  );
});
afterEach(() => {
  vi.useRealTimers();
});

describe('deleting a session', () => {
  it('takes its turns, their messages and versions, and the recap that looked back on it, and nothing else', async () => {
    twoSessions();
    expect(world.turns).toHaveLength(6);

    const result = await deleteSession({
      userId: ME,
      sessionId: 'ses_one',
      removeAccount: true,
    });

    expect(result).toEqual({
      exchanges: 2,
      messages: 5,
      versions: 2,
      recaps: 1,
      account: 'none',
    });
    expect(ids(world.turns)).toEqual(['their-recap', 'turn-c', 'turn-x']);
    expect(ids(world.messages)).toEqual(['m5', 'm6', 't1', 't2', 'tr1']);
    expect(world.messages.some((row) => row.content.includes('words of m1'))).toBe(false);
    // The session's versions are placeholders; the later session's reading keeps its words.
    expect(rowsOf(ME, 'life_work').map((row) => row.sourceType === REMOVED_SOURCE_TYPE)).toEqual([
      true,
      false,
    ]);
    expect(rowsOf(ME, 'life_work')[1].value).toBe('retraining as a nurse');
    expect(rowsOf(ME, 'life_rhythm')[0].sourceType).toBe(REMOVED_SOURCE_TYPE);
    // Theirs, begun at the same moment, word for word.
    expect(rowsOf(THEM, 'life_work')[0].value).toBe('their own words');
    expect(world.messages.find((row) => row.id === 'tr1')?.content).toBe('You said "words of t1".');
    // The session rows stay: a sitting that happened still happened.
    expect(world.sessions.map((row) => row.id)).toContain('ses_one');
    expect(invalidateContext).toHaveBeenCalledWith('module', 'values', { userId: ME });
  });

  it('takes the session’s own recap with its turns, and leaves the session it looked back on', async () => {
    twoSessions();

    const result = await deleteSession({
      userId: ME,
      sessionId: 'ses_two',
      removeAccount: true,
    });

    // recap-two is one of ses_two's turns, so it counts as one of its exchanges.
    expect(result).toMatchObject({ exchanges: 2, recaps: 0 });
    expect(ids(world.turns)).toEqual(['their-recap', 'turn-a', 'turn-b', 'turn-x']);
    expect(ids(world.messages)).toEqual(['m1', 'm2', 'm3', 'm4', 't1', 't2', 'tr1']);
  });

  it('runs in one transaction, with the longer timeout', async () => {
    twoSessions();

    await deleteSession({ userId: ME, sessionId: 'ses_one', removeAccount: false });

    expect(executeTransaction).toHaveBeenCalledTimes(1);
    expect(executeTransaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: SESSION_DELETION_TIMEOUT_MS,
    });
  });

  it('deletes a session with no turns, and its draft', async () => {
    twoSessions();
    world.sessions.push({ id: 'ses_empty', userId: ME, occurredAt: new Date(50_000), ordinal: 3 });
    const draft = synopsisEntry({ sessionId: 'ses_empty' });
    world.entries.push(draft);

    const result = await deleteSession({
      userId: ME,
      sessionId: 'ses_empty',
      removeAccount: false,
    });

    expect(result).toEqual({ exchanges: 0, messages: 0, versions: 0, recaps: 0, account: 'none' });
    expect(entry(draft.id)).toBeUndefined();
    expect(world.turns).toHaveLength(6);
  });
});

describe('who can reach a session', () => {
  it('answers another person’s session exactly as one that does not exist, and changes nothing', async () => {
    twoSessions();
    const before = JSON.stringify(world);

    const theirs = deleteSession({ userId: ME, sessionId: 'their_one', removeAccount: true });
    await expect(theirs).rejects.toBeInstanceOf(NotFoundError);
    const absent = deleteSession({ userId: ME, sessionId: 'ses_nope', removeAccount: true });
    await expect(absent).rejects.toBeInstanceOf(NotFoundError);
    const [a, b] = await Promise.allSettled([theirs, absent]);
    expect((a as PromiseRejectedResult).reason.message).toBe(
      (b as PromiseRejectedResult).reason.message
    );
    expect(JSON.stringify(world)).toBe(before);
  });

  it('refuses while one of its turns is still being answered, naming the remedy, and changes nothing', async () => {
    twoSessions();
    const running = world.turns.find((row) => row.id === 'turn-b')!;
    running.status = 'running';
    running.startedAt = new Date();
    const before = JSON.stringify(world);

    const refused = deleteSession({ userId: ME, sessionId: 'ses_one', removeAccount: true });

    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toThrow(/Try again/);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('refuses while a later recap that looked back on it is still being answered', async () => {
    twoSessions();
    const running = world.turns.find((row) => row.id === 'recap-two')!;
    running.status = 'running';
    running.startedAt = new Date();

    await expect(
      deleteSession({ userId: ME, sessionId: 'ses_one', removeAccount: true })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(world.turns.some((row) => row.id === 'turn-a')).toBe(true);
  });
});

describe('its account (owner ruling 1)', () => {
  type Shape = 'kept' | 'flagged' | 'draft' | 'none';

  /** The session's account in one shape, beside the other person's kept one of a session at the same moment. */
  function withAccount(shape: Shape) {
    twoSessions();
    const theirs = synopsisEntry({
      userId: THEM,
      sessionId: 'their_one',
      state: 'kept',
      keptAt: new Date(50_000),
    });
    const later = synopsisEntry({ sessionId: 'ses_two', state: 'kept', keptAt: new Date(150_000) });
    world.entries.push(theirs, later);
    if (shape === 'none') return { mine: null, theirs, later };
    const mine = synopsisEntry({
      sessionId: 'ses_one',
      body: 'In my own words.',
      ...(shape === 'draft' ? {} : { state: 'kept', keptAt: new Date(50_000) }),
      ...(shape === 'flagged' ? { sourceRemovedAt: new Date(60_000) } : {}),
    });
    world.entries.push(mine);
    return { mine, theirs, later };
  }

  it.each`
    shape        | removeAccount | account      | mineAfter
    ${'kept'}    | ${true}       | ${'removed'} | ${'gone'}
    ${'kept'}    | ${false}      | ${'flagged'} | ${'flagged now'}
    ${'flagged'} | ${true}       | ${'removed'} | ${'gone'}
    ${'flagged'} | ${false}      | ${'flagged'} | ${'flagged before'}
    ${'draft'}   | ${true}       | ${'none'}    | ${'gone'}
    ${'draft'}   | ${false}      | ${'none'}    | ${'gone'}
    ${'none'}    | ${true}       | ${'none'}    | ${'none'}
    ${'none'}    | ${false}      | ${'none'}    | ${'none'}
  `(
    'a $shape account with removeAccount $removeAccount: $account',
    async ({
      shape,
      removeAccount,
      account,
      mineAfter,
    }: {
      shape: Shape;
      removeAccount: boolean;
      account: string;
      mineAfter: string;
    }) => {
      const { mine, theirs, later } = withAccount(shape);

      const result = await deleteSession({ userId: ME, sessionId: 'ses_one', removeAccount });

      expect(result.account).toBe(account);
      if (mineAfter === 'gone') expect(entry(mine!.id)).toBeUndefined();
      if (mineAfter === 'flagged now') {
        expect(entry(mine!.id)).toMatchObject({
          state: 'kept',
          body: 'In my own words.',
          sourceRemovedAt: DELETED_AT,
        });
      }
      if (mineAfter === 'flagged before') {
        expect(entry(mine!.id)?.sourceRemovedAt).toEqual(new Date(60_000));
      }
      // Never another session's account, nor another person's.
      expect(entry(later.id)).toMatchObject({ state: 'kept', sourceRemovedAt: null });
      expect(entry(theirs.id)).toMatchObject({ state: 'kept', sourceRemovedAt: null });
    }
  );

  it('takes a recap drawn from the kept account, whether or not the account goes', async () => {
    withAccount('kept');
    world.turns.find((row) => row.id === 'recap-two')!.recap = {
      since: at(1_000),
      source: 'synopsis',
      words: 0,
      notes: [],
      journey: 0,
    };

    const result = await deleteSession({ userId: ME, sessionId: 'ses_one', removeAccount: false });

    expect(result.recaps).toBe(1);
    expect(world.turns.some((row) => row.id === 'recap-two')).toBe(false);
  });
});
