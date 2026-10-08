/**
 * Deleting a module's worth: what goes, what stays, and who can reach it
 * (f-forget-session t-155).
 *
 * ## The assertions that fail when the behaviour is wrong (`fp6`)
 *
 * Every claim is partly an absence, so each is made over a population where
 * something survives: my turns in the module being deleted, in another module,
 * and stamped with none (from before the stamp), across three sessions; and the
 * other person's turn stamped with the same module, with the same note heading.
 * Each case asserts the survivors' words, versions and accounts are untouched.
 *
 * ## What is faked
 *
 * The Prisma client (`notes-fake.ts`) and the context cache. The recap
 * look-back, Daybreak's value engine and the turn window are real.
 *
 * @see lib/app/memory/delete-module.ts
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

const { deleteModuleExchanges, countModuleExchanges } =
  await import('@/lib/app/memory/delete-module');
const { SESSION_DELETION_TIMEOUT_MS } = await import('@/lib/app/memory/delete-session');
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

/**
 * Three sessions of mine in one conversation, and one of theirs.
 *
 * - before the stamp: turn-old (m0 · m0r), no session, no module.
 * - ses_one (began 1s): turn-a (m1 · m2) in `values`, wrote `life_work` v1;
 *   turn-b (m3 · m4) in `inner-authority`, wrote `life_rhythm` v1.
 * - ses_two (began 100s): recap-two looking back on ses_one (r1, repeating
 *   m1), stamped with no module; turn-c (m5 · m6) in `values`, wrote
 *   `life_work` v2.
 * - ses_three (began 200s): turn-d (m7 · m8) in `inner-authority`.
 * - theirs, their_one (began 1s): turn-x (t1 · t2) in `values`, wrote their
 *   `life_work` v1.
 */
function threeSessions(): void {
  world.sessions.push(
    { id: 'ses_one', userId: ME, occurredAt: new Date(1_000), ordinal: 1 },
    { id: 'ses_two', userId: ME, occurredAt: new Date(100_000), ordinal: 2 },
    { id: 'ses_three', userId: ME, occurredAt: new Date(200_000), ordinal: 3 },
    { id: 'their_one', userId: THEM, occurredAt: new Date(1_000), ordinal: 1 }
  );
  world.messages.push(
    message('m0', 'user', 500),
    message('m0r', 'assistant', 600),
    message('m1', 'user', 10_000),
    message('m2', 'assistant', 11_000),
    message('m3', 'user', 20_000),
    message('m4', 'assistant', 21_000),
    { ...message('r1', 'assistant', 101_000), content: 'Last time you said "words of m1".' },
    message('m5', 'user', 110_000),
    message('m6', 'assistant', 111_000),
    message('m7', 'user', 210_000),
    message('m8', 'assistant', 211_000),
    message('t1', 'user', 10_000, THEIRS, THEM),
    message('t2', 'assistant', 11_000, THEIRS, THEM)
  );
  turn('turn-old', 'm0', { sessionId: null, moduleSlug: null, startedAt: new Date(500) });
  turn('turn-a', 'm1', { sessionId: 'ses_one', moduleSlug: 'values', startedAt: new Date(10_000) });
  turn('turn-b', 'm3', {
    sessionId: 'ses_one',
    moduleSlug: 'inner-authority',
    startedAt: new Date(20_000),
  });
  world.turns.push({
    id: 'recap-two',
    userId: ME,
    turnId: recapTurnId('ses_two'),
    status: 'completed',
    startedAt: new Date(100_500),
    conversationId: MINE,
    userMessageId: null,
    sessionId: 'ses_two',
    moduleSlug: null,
    recap: { since: at(1_000), source: 'words', words: 2, notes: [], journey: 0 },
  });
  turn('turn-c', 'm5', {
    sessionId: 'ses_two',
    moduleSlug: 'values',
    startedAt: new Date(110_000),
  });
  turn('turn-d', 'm7', {
    sessionId: 'ses_three',
    moduleSlug: 'inner-authority',
    startedAt: new Date(210_000),
  });
  turn('turn-x', 't1', {
    userId: THEM,
    conversationId: THEIRS,
    sessionId: 'their_one',
    moduleSlug: 'values',
    startedAt: new Date(10_000),
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

describe('deleting a module’s worth', () => {
  it('takes only my turns stamped with the module, and the recap that looked back on them', async () => {
    threeSessions();
    expect(world.turns).toHaveLength(7);

    const result = await deleteModuleExchanges({ userId: ME, moduleSlug: 'values' });

    expect(result).toEqual({ exchanges: 2, messages: 5, versions: 2, recaps: 1 });
    // Another module's turns, the unstamped turn, and theirs in the same module all stay.
    expect(ids(world.turns)).toEqual(['turn-b', 'turn-d', 'turn-old', 'turn-x']);
    expect(ids(world.messages)).toEqual(['m0', 'm0r', 'm3', 'm4', 'm7', 'm8', 't1', 't2']);
    expect(world.messages.some((row) => row.content.includes('words of m1'))).toBe(false);
    // Both versions the module's turns wrote are placeholders; another module's reading keeps its words.
    expect(rowsOf(ME, 'life_work').every((row) => row.sourceType === REMOVED_SOURCE_TYPE)).toBe(
      true
    );
    expect(rowsOf(ME, 'life_rhythm')[0]).toMatchObject({ value: 'early riser' });
    expect(rowsOf(ME, 'life_rhythm')[0].sourceType).not.toBe(REMOVED_SOURCE_TYPE);
    // Theirs, in the same module under the same heading, word for word.
    expect(rowsOf(THEM, 'life_work')[0].value).toBe('their own words');
    // Session rows stay.
    expect(world.sessions).toHaveLength(4);
    expect(invalidateContext).toHaveBeenCalledWith('module', 'values', { userId: ME });
  });

  it('settles the sessions it touched as one deleted exchange does, and no other', async () => {
    threeSessions();
    const keptOne = synopsisEntry({
      sessionId: 'ses_one',
      state: 'kept',
      keptAt: new Date(50_000),
      body: 'In my own words.',
    });
    const draftTwo = synopsisEntry({ sessionId: 'ses_two' });
    const draftThree = synopsisEntry({ sessionId: 'ses_three' });
    const theirs = synopsisEntry({
      userId: THEM,
      sessionId: 'their_one',
      state: 'kept',
      keptAt: new Date(50_000),
    });
    world.entries.push(keptOne, draftTwo, draftThree, theirs);

    await deleteModuleExchanges({ userId: ME, moduleSlug: 'values' });

    // No tick here: a kept account touched by the module stays, flagged.
    expect(entry(keptOne.id)).toMatchObject({
      state: 'kept',
      body: 'In my own words.',
      sourceRemovedAt: DELETED_AT,
    });
    expect(entry(draftTwo.id)).toBeUndefined();
    // A session the module never touched keeps its draft, and theirs is untouched.
    expect(entry(draftThree.id)).toMatchObject({ state: 'draft' });
    expect(entry(theirs.id)).toMatchObject({ state: 'kept', sourceRemovedAt: null });
  });

  it('runs in one transaction, with the session’s longer timeout', async () => {
    threeSessions();

    await deleteModuleExchanges({ userId: ME, moduleSlug: 'values' });

    expect(executeTransaction).toHaveBeenCalledTimes(1);
    expect(executeTransaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: SESSION_DELETION_TIMEOUT_MS,
    });
  });
});

describe('when there is nothing to delete', () => {
  it.each`
    case                                   | moduleSlug
    ${'a module nobody has a turn in'}     | ${'courage'}
    ${'a module only they have a turn in'} | ${'belonging'}
    ${'a slug that is no module at all'}   | ${'not-a-module'}
  `('refuses $case with a 404 that says so, and changes nothing', async ({ moduleSlug }) => {
    threeSessions();
    turn('their-belonging', 't1', {
      userId: THEM,
      conversationId: THEIRS,
      moduleSlug: 'belonging',
      startedAt: new Date(12_000),
    });
    const before = JSON.stringify(world);

    const refused = deleteModuleExchanges({ userId: ME, moduleSlug: moduleSlug as string });

    await expect(refused).rejects.toBeInstanceOf(NotFoundError);
    await expect(refused).rejects.toThrow(/nothing you said in this module/);
    expect(JSON.stringify(world)).toBe(before);
    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it('refuses while one of its turns is still being answered, naming the remedy, and changes nothing', async () => {
    threeSessions();
    const running = world.turns.find((row) => row.id === 'turn-c')!;
    running.status = 'running';
    running.startedAt = new Date();
    const before = JSON.stringify(world);

    const refused = deleteModuleExchanges({ userId: ME, moduleSlug: 'values' });

    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toThrow(/Try again/);
    expect(JSON.stringify(world)).toBe(before);
  });
});

describe('whether there is anything to offer', () => {
  it('counts only my turns stamped with the module', async () => {
    threeSessions();

    expect(await countModuleExchanges(ME, 'values')).toBe(2);
    expect(await countModuleExchanges(ME, 'inner-authority')).toBe(2);
    expect(await countModuleExchanges(THEM, 'values')).toBe(1);
    expect(await countModuleExchanges(ME, 'courage')).toBe(0);
  });
});
