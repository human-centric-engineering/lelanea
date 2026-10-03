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

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  definition,
  ME,
  resetWorld,
  THEM,
  value,
  world,
  type MessageRow,
} from '@/tests/unit/lib/app/slots/notes-fake';

const { invalidateContext } = vi.hoisted(() => ({ invalidateContext: vi.fn() }));

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
const { deleteNote } = await import('@/lib/app/slots/delete-note');
const { getNotes } = await import('@/lib/app/slots/notes');
const { appendSlotValue } = await import('@/lib/framework/data-slots');
const { NotFoundError, ConflictError } = await import('@/lib/api/errors');
const { REMOVED_SLUG_PREFIX, REMOVED_SOURCE_TYPE } = await import('@/lib/app/slots/removed');

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

    expect(result).toEqual({ exchanges: 1, messages: 4, versions: 1 });
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

    expect(result).toEqual({ exchanges: 1, messages: 0, versions: 1 });
    expect(rowsOf(ME, 'life_work')[1].sourceType).toBe(REMOVED_SOURCE_TYPE);
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
