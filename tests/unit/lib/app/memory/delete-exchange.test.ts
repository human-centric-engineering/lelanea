/**
 * Deleting an exchange: what goes, what stays, and who can reach it
 * (f-memory t-127).
 *
 * ## The assertions that fail when the behaviour is wrong (`fp6`)
 *
 * Every claim here is partly an absence, so each is made over a population
 * where something else survives: two exchanges of mine in one conversation, the
 * other person's exchange at the same moments in theirs, and notes with
 * versions written by each. Each case asserts the sibling exchange, its
 * messages and its versions survive, word for word.
 *
 * ## What is faked
 *
 * The Prisma client (`notes-fake.ts`, shared with the notes store's tests) and
 * the context cache, whose invalidation is asserted as calls. Daybreak's value
 * engine and the turn window (`turnWindowStart`) are real.
 *
 * @see lib/app/memory/delete-exchange.ts
 */

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

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

const { forgetWipedNotes, queueNoteIndex } = vi.hoisted(() => ({
  forgetWipedNotes: vi.fn(async () => 0),
  queueNoteIndex: vi.fn(),
}));
const { forgetSourceRemovedJourneyEntries } = vi.hoisted(() => ({
  forgetSourceRemovedJourneyEntries: vi.fn(async () => 0),
}));
// The index itself is `memory-index.test.ts`'s; here, only that a wipe drops
// its notes' vectors inside its own transaction, and a write queues one (t-107).
const { clearStoredSearchResults } = vi.hoisted(() => ({
  clearStoredSearchResults: vi.fn(async () => 0),
}));
vi.mock('@/lib/app/memory/stored-results', () => ({ clearStoredSearchResults }));
vi.mock('@/lib/app/memory/memory-index', () => ({
  forgetWipedNotes,
  queueNoteIndex,
  forgetSourceRemovedJourneyEntries,
}));

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

const { deleteExchanges } = await import('@/lib/app/memory/delete-exchange');
const { prismaFake } = await import('@/tests/unit/lib/app/slots/notes-fake');
const { deleteNote } = await import('@/lib/app/slots/delete-note');
const { getNotes } = await import('@/lib/app/slots/notes');
const { appendSlotValue } = await import('@/lib/framework/data-slots');
const { NotFoundError, ConflictError } = await import('@/lib/api/errors');
const { REMOVED_SLUG_PREFIX, REMOVED_SOURCE_TYPE } = await import('@/lib/app/slots/removed');
const { recapTurnId } = await import('@/lib/app/conversation/opening-id');
const { removeJourneyEntry } = await import('@/lib/app/journey-record/record');

const MINE = 'conv-mine';
const THEIRS = 'conv-theirs';

function message(
  id: string,
  role: MessageRow['role'],
  at: number,
  conversationId = MINE,
  ownerId = ME
): MessageRow {
  return { id, conversationId, ownerId, role, content: `words of ${id}`, createdAt: new Date(at) };
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

function ledger(turnId: string, slotSlug: string, version: number, userId = ME): void {
  world.ledger.push({ turnId, userId, slotSlug, version });
}

function rowsOf(userId: string, slotSlug: string) {
  return world.values
    .filter((row) => row.userId === userId && row.slotSlug === slotSlug)
    .sort((a, b) => a.version - b.version);
}

/**
 * Two exchanges of mine, the first calling a tool, and the other person's
 * exchange at the same moments in their own conversation.
 *
 * - turn-a: m1 (me) · m2 (a pass) · m3 (the tool's result) · m4 (the reply). It
 *   wrote `life_work` v2.
 * - turn-b: m5 (me) · m6 (the reply). It wrote `life_work` v3 and `life_rhythm` v1.
 * - turn-x, theirs: t1 · t2, writing their own `life_work` v1.
 */
function twoExchanges(): void {
  world.messages.push(
    message('m1', 'user', 10_000),
    message('m2', 'assistant', 11_000),
    message('m3', 'tool', 11_500),
    message('m4', 'assistant', 12_000),
    message('m5', 'user', 20_000),
    message('m6', 'assistant', 21_000),
    message('t1', 'user', 10_000, THEIRS, THEM),
    message('t2', 'assistant', 12_000, THEIRS, THEM)
  );
  turn('turn-a', 'm1');
  turn('turn-b', 'm5');
  turn('turn-x', 't1', { userId: THEM, conversationId: THEIRS });
  world.values.push(
    value(ME, 'life_work', { version: 1, value: 'teaches', supersededAt: new Date(5_000) }),
    value(ME, 'life_work', {
      version: 2,
      value: 'stopped teaching',
      supersededAt: new Date(6_000),
    }),
    value(ME, 'life_work', { version: 3, value: 'retraining as a nurse' }),
    value(ME, 'life_rhythm', { version: 1, value: 'early riser' }),
    value(THEM, 'life_work', { version: 1, value: 'their own words' })
  );
  ledger('turn-a', 'life_work', 2);
  ledger('turn-b', 'life_work', 3);
  ledger('turn-b', 'life_rhythm', 1);
  ledger('turn-x', 'life_work', 1, THEM);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWorld();
  world.projections = [definition('life_work'), definition('life_rhythm')];
  world.ours = world.projections.map((row) => ({ slug: row.slug, visibility: row.visibility }));
});

describe('deleting an exchange', () => {
  it('takes every message in its window, its turn and its versions, and nothing else', async () => {
    twoExchanges();

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(result).toEqual({ exchanges: 1, messages: 4, versions: 1, recaps: 0 });
    // Every role in the window went, the tool's result included.
    expect(world.messages.map((row) => row.id).sort()).toEqual(['m5', 'm6', 't1', 't2']);
    expect(world.turns.map((row) => row.id).sort()).toEqual(['turn-b', 'turn-x']);
    expect(world.ledger.map((row) => `${row.turnId}:${row.slotSlug}`).sort()).toEqual([
      'turn-b:life_rhythm',
      'turn-b:life_work',
      'turn-x:life_work',
    ]);

    // Only the version turn-a wrote is a placeholder; its neighbours keep their words.
    const mine = rowsOf(ME, 'life_work');
    expect(mine.map((row) => row.sourceType === REMOVED_SOURCE_TYPE)).toEqual([false, true, false]);
    expect(mine[0].value).toBe('teaches');
    expect(mine[2].value).toBe('retraining as a nurse');
    expect(rowsOf(ME, 'life_rhythm')[0].value).toBe('early riser');
    expect(rowsOf(THEM, 'life_work')[0].value).toBe('their own words');
  });

  it('drops the vectors of the versions it wiped, in the same transaction (t-107)', async () => {
    twoExchanges();
    let wipedWhenForgotten: boolean[] = [];
    forgetWipedNotes.mockImplementationOnce(async () => {
      wipedWhenForgotten = rowsOf(ME, 'life_work').map(
        (row) => row.sourceType === REMOVED_SOURCE_TYPE
      );
      return 1;
    });

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(forgetWipedNotes).toHaveBeenCalledWith(prismaFake, { userId: ME });
    // And every stored memory-search result that may quote the deleted words (t-130).
    expect(clearStoredSearchResults).toHaveBeenCalledWith(prismaFake, { userId: ME });
    // Called after the wipe, inside it: the version turn-a wrote is already a placeholder.
    expect(wipedWhenForgotten).toEqual([false, true, false]);
  });

  it('takes the latest exchange to the end of its conversation', async () => {
    twoExchanges();
    // A pass written after the reply was linked still belongs to the last turn.
    world.messages.push(message('m7', 'tool', 22_000));

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-b'] });

    expect(result).toMatchObject({ exchanges: 1, messages: 3, versions: 2 });
    expect(world.messages.map((row) => row.id).sort()).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      't1',
      't2',
    ]);
  });

  it('forgets the cached context blocks that may quote what went', async () => {
    twoExchanges();

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(invalidateContext).toHaveBeenCalledWith('module', 'values', { userId: ME });
    expect(invalidateContext.mock.calls.every(([, , scope]) => scope.userId === ME)).toBe(true);
  });

  it('answers another person’s exchange exactly as one that does not exist, and changes nothing', async () => {
    twoExchanges();
    const before = JSON.stringify(world);

    const theirs = deleteExchanges({ userId: ME, exchangeIds: ['turn-x'] });
    await expect(theirs).rejects.toBeInstanceOf(NotFoundError);
    const absent = deleteExchanges({ userId: ME, exchangeIds: ['turn-nope'] });
    await expect(absent).rejects.toBeInstanceOf(NotFoundError);
    const [a, b] = await Promise.allSettled([theirs, absent]);
    expect((a as PromiseRejectedResult).reason.message).toBe(
      (b as PromiseRejectedResult).reason.message
    );

    // Mine beside theirs: all or nothing, so mine is not deleted either.
    await expect(
      deleteExchanges({ userId: ME, exchangeIds: ['turn-a', 'turn-x'] })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('refuses an exchange still being answered, naming the remedy, and changes nothing', async () => {
    twoExchanges();
    const turn = world.turns.find((row) => row.id === 'turn-b')!;
    turn.status = 'running';
    turn.startedAt = new Date();
    const before = JSON.stringify(world);

    const refused = deleteExchanges({ userId: ME, exchangeIds: ['turn-b'] });

    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toThrow(/Try again/);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('deletes an exchange whose claim was abandoned mid-answer, past the stale window', async () => {
    twoExchanges();
    const turn = world.turns.find((row) => row.id === 'turn-b')!;
    turn.status = 'running';
    // Deadline 120s + 60s grace: 181s ago is abandoned.
    turn.startedAt = new Date(Date.now() - 181_000);

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-b'] });

    expect(result.exchanges).toBe(1);
    expect(world.turns.some((row) => row.id === 'turn-b')).toBe(false);
  });

  it('deletes a turn whose conversation is already gone, with the versions it wrote', async () => {
    twoExchanges();
    world.messages = world.messages.filter((row) => row.conversationId !== MINE);

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(result).toEqual({ exchanges: 1, messages: 0, versions: 1, recaps: 0 });
    expect(rowsOf(ME, 'life_work')[1].sourceType).toBe(REMOVED_SOURCE_TYPE);
  });
});

describe('the synopsis of the session it was in (t-147)', () => {
  const DELETED_AT = new Date('2026-10-06T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DELETED_AT);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** turn-a in session one, turn-b in session two, theirs under session one's id too. */
  function inSessions(): void {
    twoExchanges();
    world.turns.find((row) => row.id === 'turn-a')!.sessionId = 'ses_one';
    world.turns.find((row) => row.id === 'turn-b')!.sessionId = 'ses_two';
    world.turns.find((row) => row.id === 'turn-x')!.sessionId = 'ses_one';
  }

  const entry = (id: string) => world.entries.find((row) => row.id === id);

  it('removes the session’s draft, and leaves another session’s and another person’s alone', async () => {
    inSessions();
    const draft = synopsisEntry({ sessionId: 'ses_one' });
    const other = synopsisEntry({ sessionId: 'ses_two' });
    const theirs = synopsisEntry({ userId: THEM, sessionId: 'ses_one' });
    world.entries.push(draft, other, theirs);
    expect(world.entries).toHaveLength(3);

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(entry(draft.id)).toBeUndefined();
    expect(entry(other.id)).toMatchObject({ state: 'draft', sourceRemovedAt: null });
    expect(entry(theirs.id)).toMatchObject({ state: 'draft', sourceRemovedAt: null });
  });

  it('flags a kept synopsis with when, and never takes it', async () => {
    inSessions();
    const kept = synopsisEntry({
      sessionId: 'ses_one',
      state: 'kept',
      keptAt: new Date('2026-10-02T00:00:00.000Z'),
      body: 'In my own words.',
    });
    const theirs = synopsisEntry({
      userId: THEM,
      sessionId: 'ses_one',
      state: 'kept',
      keptAt: new Date('2026-10-02T00:00:00.000Z'),
    });
    world.entries.push(kept, theirs);

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(entry(kept.id)).toMatchObject({
      state: 'kept',
      body: 'In my own words.',
      sourceRemovedAt: DELETED_AT,
    });
    expect(entry(theirs.id)?.sourceRemovedAt).toBeNull();
    // Its vector goes with the deletion, in the same transaction, and only mine (t-149).
    expect(forgetSourceRemovedJourneyEntries).toHaveBeenCalledTimes(1);
    expect(forgetSourceRemovedJourneyEntries).toHaveBeenCalledWith(expect.anything(), {
      userId: ME,
    });
  });

  it('settles every session the deleted exchanges were in', async () => {
    inSessions();
    const one = synopsisEntry({ sessionId: 'ses_one' });
    const two = synopsisEntry({ sessionId: 'ses_two', state: 'kept', keptAt: DELETED_AT });
    world.entries.push(one, two);

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a', 'turn-b'] });

    expect(entry(one.id)).toBeUndefined();
    expect(entry(two.id)?.sourceRemovedAt).toEqual(DELETED_AT);
  });

  it('touches no synopsis for a turn taken before sessions', async () => {
    twoExchanges();
    const draft = synopsisEntry({ sessionId: 'ses_one' });
    world.entries.push(draft);

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(entry(draft.id)).toMatchObject({ state: 'draft', sourceRemovedAt: null });
  });
});

describe('a heading the AI coined', () => {
  /** `my_father` coined by turn-a at v1, read again by turn-b at v2. */
  function coined(): void {
    twoExchanges();
    world.values.push(
      value(ME, 'my_father', { version: 1, value: 'ill', supersededAt: new Date(7_000) }),
      value(ME, 'my_father', { version: 2, value: 'recovering' })
    );
    ledger('turn-a', 'my_father', 1);
    ledger('turn-b', 'my_father', 2);
  }

  it('stays while another exchange’s reading is still filed under it', async () => {
    coined();

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    const rows = rowsOf(ME, 'my_father');
    expect(rows.map((row) => row.sourceType === REMOVED_SOURCE_TYPE)).toEqual([true, false]);
    expect(rows[1].value).toBe('recovering');
    expect(world.values.some((row) => row.slotSlug.startsWith(REMOVED_SLUG_PREFIX))).toBe(false);
  });

  it('goes once nothing under it is left, and the next reading starts its own chain', async () => {
    coined();

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });
    await deleteExchanges({ userId: ME, exchangeIds: ['turn-b'] });

    expect(rowsOf(ME, 'my_father')).toEqual([]);
    const moved = world.values.filter((row) => row.slotSlug.startsWith(REMOVED_SLUG_PREFIX));
    expect(moved.map((row) => row.version).sort()).toEqual([1, 2]);
    expect(new Set(moved.map((row) => row.slotSlug)).size).toBe(1);
    // A taxonomy heading wiped the same way keeps its slug.
    expect(rowsOf(ME, 'life_work')).toHaveLength(3);

    const next = await appendSlotValue({
      userId: ME,
      slotSlug: 'my_father',
      value: 'home again',
      confidence: 6,
      sourceType: 'inferred',
      reasoningNote: 'Said in passing.',
      provenance: {},
    });
    expect(next.version).toBe(1);
  });
});

describe('the notes page', () => {
  it('lists the exchanges each note came from, once each, oldest first', async () => {
    twoExchanges();
    ledger('turn-a', 'life_work', 2); // a retried write: still one exchange

    const view = await getNotes(ME);

    expect(view.notes.find((note) => note.slotSlug === 'life_work')?.exchanges).toEqual([
      'turn-a',
      'turn-b',
    ]);
    expect(view.notes.find((note) => note.slotSlug === 'life_rhythm')?.exchanges).toEqual([
      'turn-b',
    ]);
    // Never another person's turn, though they share the slug.
    expect(JSON.stringify(view)).not.toContain('turn-x');
  });

  it('still offers a removed note’s exchanges, and not once they are deleted', async () => {
    twoExchanges();
    await deleteNote({ userId: ME, slotSlug: 'life_rhythm' });

    const removed = (await getNotes(ME)).notes.find((note) => note.slotSlug === 'life_rhythm');
    expect(removed).toMatchObject({ removed: true, exchanges: ['turn-b'] });

    await deleteExchanges({ userId: ME, exchangeIds: removed!.exchanges });

    const after = (await getNotes(ME)).notes.find((note) => note.slotSlug === 'life_rhythm');
    expect(after).toMatchObject({ removed: true, exchanges: [] });
    expect(world.messages.some((row) => row.id === 'm5')).toBe(false);
  });

  it('keeps a note removable while an exchange deletion left a reading under its placeholder', async () => {
    twoExchanges();
    // turn-b wrote both: removing one note and deleting the exchange wipes
    // life_work's head (v3), but v1 and v2 came from elsewhere and are kept.
    await deleteNote({ userId: ME, slotSlug: 'life_rhythm' });
    await deleteExchanges({ userId: ME, exchangeIds: ['turn-b'] });

    const work = (await getNotes(ME)).notes.find((note) => note.slotSlug === 'life_work');
    expect(work).toMatchObject({ removed: true, removable: true });
    expect(work?.previous).toMatchObject({ removed: false, value: 'stopped teaching' });

    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    const gone = (await getNotes(ME)).notes.find((note) => note.slotSlug === 'life_work');
    expect(gone).toMatchObject({ removed: true, removable: false });
  });

  it('offers nothing for a note no conversation wrote', async () => {
    twoExchanges();
    world.values.push(value(ME, 'life_place', { value: 'by the sea', provenance: {} }));

    const view = await getNotes(ME);

    expect(view.notes.find((note) => note.slotSlug === 'life_place')?.exchanges).toEqual([]);
  });
});

describe('what the conversation row kept of an exchange', () => {
  function withConversations(pin: string | null, title = 'words of m1'): void {
    twoExchanges();
    world.conversations.push(
      {
        id: MINE,
        userId: ME,
        title,
        summary: pin ? 'They talked about work.' : null,
        summaryUpToMessageId: pin,
      },
      {
        id: THEIRS,
        userId: THEM,
        title: 'words of t1',
        summary: 'Their own summary.',
        summaryUpToMessageId: 't2',
      }
    );
  }
  const mine = () => world.conversations.find((row) => row.id === MINE)!;
  const theirs = () => world.conversations.find((row) => row.id === THEIRS)!;

  it('clears a summary that covers the deleted exchange, and the title its first message gave', async () => {
    withConversations('m4');

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(mine()).toMatchObject({ summary: null, summaryUpToMessageId: null, title: null });
    expect(theirs()).toMatchObject({
      summary: 'Their own summary.',
      summaryUpToMessageId: 't2',
      title: 'words of t1',
    });
  });

  it('clears a summary pinned before a deleted exchange only if the exchange is inside it', async () => {
    // Pinned at m4: turn-b (m5, m6) comes after it, so the summary holds none of it.
    withConversations('m4');

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-b'] });

    expect(mine()).toMatchObject({
      summary: 'They talked about work.',
      summaryUpToMessageId: 'm4',
      title: 'words of m1',
    });
  });

  it('clears a summary whose pin is already gone, since Sunrise would carry it forward', async () => {
    withConversations('m-gone');

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-b'] });

    expect(mine()).toMatchObject({ summary: null, summaryUpToMessageId: null });
    // turn-b's messages are not the first, so the title stays.
    expect(mine().title).toBe('words of m1');
  });
});

describe('the recaps that looked back on its session (t-151)', () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id).sort();

  function recap(
    id: string,
    session: string,
    since: number | null,
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
      recap: since === null ? null : { since: at(since), source, words: 2, notes: [], journey: 0 },
      ...row,
    });
  }

  /**
   * Three sessions of mine, and two of theirs begun at the same moments.
   *
   * - ses_one (began 1s): turn-a and turn-b, as `twoExchanges` has them.
   * - ses_two (began 100s): recap-two looking back on ses_one, whose reply r1
   *   repeats what I said; then turn-c, m7 · m8.
   * - ses_three (began 200s): recap-three looking back on ses_two, its reply r2.
   * - theirs: turn-x in their_one, and their recap looking back on it, its reply
   *   tr1, in their own conversation.
   */
  function threeSessions(): void {
    twoExchanges();
    world.sessions.push(
      { id: 'ses_one', userId: ME, occurredAt: new Date(1_000) },
      { id: 'ses_two', userId: ME, occurredAt: new Date(100_000) },
      { id: 'ses_three', userId: ME, occurredAt: new Date(200_000) },
      { id: 'their_one', userId: THEM, occurredAt: new Date(1_000) },
      { id: 'their_two', userId: THEM, occurredAt: new Date(100_000) }
    );
    world.turns.find((row) => row.id === 'turn-a')!.sessionId = 'ses_one';
    world.turns.find((row) => row.id === 'turn-b')!.sessionId = 'ses_one';
    world.turns.find((row) => row.id === 'turn-x')!.sessionId = 'their_one';
    world.messages.push(
      { ...message('r1', 'assistant', 101_000), content: 'Last time you said "words of m1".' },
      message('m7', 'user', 110_000),
      message('m8', 'assistant', 111_000),
      message('r2', 'assistant', 201_000),
      { ...message('tr1', 'assistant', 101_000, THEIRS, THEM), content: 'You said "words of t1".' }
    );
    recap('recap-two', 'ses_two', 1_000, { startedAt: new Date(100_500) });
    turn('turn-c', 'm7', { sessionId: 'ses_two', startedAt: new Date(110_000) });
    recap('recap-three', 'ses_three', 100_000, { startedAt: new Date(200_500) });
    recap('their-recap', 'their_two', 1_000, {
      userId: THEM,
      conversationId: THEIRS,
      startedAt: new Date(100_500),
    });
  }

  it('takes the recap that looked back on the session, and its reply, and no other', async () => {
    threeSessions();
    expect(ids(world.turns)).toEqual([
      'recap-three',
      'recap-two',
      'their-recap',
      'turn-a',
      'turn-b',
      'turn-c',
      'turn-x',
    ]);

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(result).toMatchObject({ exchanges: 1, recaps: 1 });
    // The recap that repeated it is gone with its reply.
    expect(ids(world.turns)).toEqual(['recap-three', 'their-recap', 'turn-b', 'turn-c', 'turn-x']);
    expect(world.messages.some((row) => row.content.includes('words of m1'))).toBe(false);
    expect(ids(world.messages)).toEqual(['m5', 'm6', 'm7', 'm8', 'r2', 't1', 't2', 'tr1']);
    // Theirs looked back on a session begun at the same moment, and stays word for word.
    expect(world.messages.find((row) => row.id === 'tr1')?.content).toBe('You said "words of t1".');
  });

  it('takes the recap of a later session when an exchange of that session goes', async () => {
    threeSessions();

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-c'] });

    expect(result).toMatchObject({ exchanges: 1, recaps: 1 });
    expect(ids(world.turns)).toEqual(['recap-two', 'their-recap', 'turn-a', 'turn-b', 'turn-x']);
    expect(world.messages.map((row) => row.id)).toContain('r1');
    expect(world.messages.map((row) => row.id)).not.toContain('r2');
  });

  it('takes a recap drawn from the kept account too, which the deletion only flags', async () => {
    threeSessions();
    world.turns.find((row) => row.id === 'recap-two')!.recap = {
      since: at(1_000),
      source: 'synopsis',
      words: 0,
      notes: [],
      journey: 0,
    };
    const kept = synopsisEntry({ sessionId: 'ses_one', state: 'kept', keptAt: new Date(50_000) });
    world.entries.push(kept);

    await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(world.turns.some((row) => row.id === 'recap-two')).toBe(false);
    expect(world.entries.find((row) => row.id === kept.id)?.sourceRemovedAt).not.toBeNull();
  });

  it('takes a recap whose account could not be kept if it began after the session, and not before', async () => {
    threeSessions();
    world.turns.find((row) => row.id === 'recap-three')!.recap = null;
    recap('recap-before', 'ses_zero', null, { startedAt: new Date(500) });

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] });

    expect(result.recaps).toBe(2);
    expect(ids(world.turns)).toEqual(['recap-before', 'their-recap', 'turn-b', 'turn-c', 'turn-x']);
  });

  it('counts a recap asked for by id as asked, and takes no recap for it', async () => {
    threeSessions();

    const result = await deleteExchanges({ userId: ME, exchangeIds: ['turn-a', 'recap-two'] });

    expect(result).toMatchObject({ exchanges: 2, recaps: 0 });
    expect(world.turns.some((row) => row.id === 'recap-two')).toBe(false);
    // recap-three looked back on ses_two, where only the person's words count.
    expect(world.turns.some((row) => row.id === 'recap-three')).toBe(true);
  });

  it('settles no synopsis of the session a recap asked for opened, which no synopsis reads', async () => {
    threeSessions();
    const draft = synopsisEntry({ sessionId: 'ses_two' });
    const kept = synopsisEntry({ sessionId: 'ses_two', state: 'kept', keptAt: new Date(150_000) });
    world.entries.push(draft, kept);

    await deleteExchanges({ userId: ME, exchangeIds: ['recap-two'] });

    expect(world.turns.some((row) => row.id === 'recap-two')).toBe(false);
    expect(world.entries.find((row) => row.id === draft.id)).toMatchObject({ state: 'draft' });
    expect(world.entries.find((row) => row.id === kept.id)?.sourceRemovedAt).toBeNull();
  });

  it('refuses while a recap that has to go is still being answered, and changes nothing', async () => {
    threeSessions();
    const running = world.turns.find((row) => row.id === 'recap-two')!;
    running.status = 'running';
    running.startedAt = new Date();
    const before = ids(world.messages);

    await expect(deleteExchanges({ userId: ME, exchangeIds: ['turn-a'] })).rejects.toBeInstanceOf(
      ConflictError
    );

    expect(ids(world.messages)).toEqual(before);
    expect(world.turns.some((row) => row.id === 'turn-a')).toBe(true);
  });

  describe('removing the kept account it was drawn from', () => {
    function drawnFromKept() {
      threeSessions();
      world.turns.find((row) => row.id === 'recap-two')!.recap = {
        since: at(1_000),
        source: 'synopsis',
        words: 0,
        notes: [],
        journey: 0,
      };
      // A second later session that looked back on ses_one through their words.
      recap('recap-words', 'ses_four', 1_000, { startedAt: new Date(300_500) });
      world.messages.push(message('r4', 'assistant', 301_000));
      const kept = synopsisEntry({ sessionId: 'ses_one', state: 'kept', keptAt: new Date(50_000) });
      const theirs = synopsisEntry({
        userId: THEM,
        sessionId: 'their_one',
        state: 'kept',
        keptAt: new Date(50_000),
      });
      world.entries.push(kept, theirs);
      world.turns.find((row) => row.id === 'their-recap')!.recap = {
        since: at(1_000),
        source: 'synopsis',
        words: 0,
        notes: [],
        journey: 0,
      };
      return { kept, theirs };
    }

    it('takes the recap drawn from it, and leaves one written from their words', async () => {
      const { kept, theirs } = drawnFromKept();

      const removed = await removeJourneyEntry(ME, kept.id);

      expect(removed).toEqual({ id: kept.id, kind: 'synopsis', recaps: 1 });
      expect(world.turns.some((row) => row.id === 'recap-two')).toBe(false);
      expect(world.turns.some((row) => row.id === 'recap-words')).toBe(true);
      expect(ids(world.messages)).not.toContain('r1');
      expect(ids(world.messages)).toContain('r4');
      // Theirs, drawn from their own kept account of a session begun at the same moment.
      expect(world.turns.some((row) => row.id === 'their-recap')).toBe(true);
      expect(world.entries.map((row) => row.id)).toEqual([theirs.id]);
      expect(invalidateContext).toHaveBeenCalled();
    });

    it('takes no recap for a draft, which no recap reads', async () => {
      drawnFromKept();
      const draft = synopsisEntry({ sessionId: 'ses_one' });
      world.entries.push(draft);

      expect(await removeJourneyEntry(ME, draft.id)).toMatchObject({ recaps: 0 });
      expect(world.turns.some((row) => row.id === 'recap-two')).toBe(true);
    });
  });
});
