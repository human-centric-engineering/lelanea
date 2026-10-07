/**
 * Removing one of Lelañea's notes: what goes, what stays, and who can reach it
 * (f-memory t-78).
 *
 * ## The assertions that fail when the behaviour is wrong (`fp6`)
 *
 * Every claim here is partly an absence, so each is made over a population
 * where something else survives:
 *
 * - *Every version of the note goes, and nothing else does.* The fixture holds
 *   three versions of the note, a sibling note of the same person's, and the
 *   other person's note under the same slug — and the sibling and theirs are
 *   asserted untouched, word for word, in the same case.
 * - *The next capture numbers correctly.* Daybreak's `appendSlotValue` runs for
 *   real against the fake after a removal, and the version it writes is
 *   asserted — the bug this design exists to avoid is a second version 1.
 * - *A gate reads a removed note as unknown.* Daybreak's own
 *   `evaluateCondition` is run against the placeholder head, beside a live head
 *   that does satisfy the same condition.
 *
 * ## What is faked
 *
 * The Prisma client (`notes-fake.ts`, shared with the notes store's tests) and
 * the context cache, whose invalidation is asserted as calls. Daybreak's value
 * engine and its gate evaluator are real.
 *
 * @see lib/app/slots/delete-note.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  definition,
  ME,
  resetWorld,
  THEM,
  value,
  world,
} from '@/tests/unit/lib/app/slots/notes-fake';

const { invalidateContext } = vi.hoisted(() => ({ invalidateContext: vi.fn() }));

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
vi.mock('@/lib/framework/modules/registry', () => ({
  getRegisteredModules: () => [{ slug: 'values' }, { slug: 'onboarding' }],
}));
vi.mock('@/lib/app/agent/settings', () => ({
  getAgentDeadlines: async () => ({ firstWordsDeadlineMs: 30_000, turnDeadlineMs: 120_000 }),
}));

const { deleteNote } = await import('@/lib/app/slots/delete-note');
const { prismaFake } = await import('@/tests/unit/lib/app/slots/notes-fake');
const { getNotes, correctNote } = await import('@/lib/app/slots/notes');
const { appendSlotValue } = await import('@/lib/framework/data-slots');
const { evaluateCondition } = await import('@/lib/framework/facilitation/engine/conditions');
const { READABLE_SEATS } = await import('@/lib/app/conversation/seats');
const { FACILITATION_CONTEXT_TYPE } = await import('@/lib/app/voice/context-contributor');
const {
  REMOVED_REASONING,
  REMOVED_SLUG_PREFIX,
  REMOVED_SOURCE_TYPE,
  REMOVED_VALUE,
  REMOVED_VALUE_JSON,
} = await import('@/lib/app/slots/removed');
const { recapTurnId } = await import('@/lib/app/conversation/opening-id');
const { ConflictError } = await import('@/lib/api/errors');

beforeEach(() => {
  vi.clearAllMocks();
  resetWorld();
  world.projections = [definition('life_work'), definition('life_rhythm')];
  world.ours = world.projections.map((row) => ({ slug: row.slug, visibility: row.visibility }));
});

/** Three versions of my `life_work` note, the last the head. */
function threeVersions(): void {
  world.values.push(
    value(ME, 'life_work', {
      version: 1,
      value: 'teaches part-time',
      valueJson: 'teaches part-time',
      supersededAt: new Date(5_000),
    }),
    value(ME, 'life_work', {
      version: 2,
      value: 'stopped teaching',
      valueJson: 'stopped teaching',
      supersededAt: new Date(6_000),
    }),
    value(ME, 'life_work', {
      version: 3,
      value: 'retraining as a nurse',
      valueJson: 'retraining as a nurse',
      reasoningNote: 'Said plainly, about their father’s illness.',
      provenance: { conversationId: 'conv-1' },
    })
  );
}

function rowsOf(userId: string, slotSlug: string) {
  return world.values
    .filter((row) => row.userId === userId && row.slotSlug === slotSlug)
    .sort((a, b) => a.version - b.version);
}

describe('removing a note', () => {
  it('wipes every version in place, and touches nothing else', async () => {
    threeVersions();
    world.values.push(
      value(ME, 'life_rhythm', { value: 'early riser' }),
      value(THEM, 'life_work', { value: 'their own words' })
    );
    const supersededBefore = rowsOf(ME, 'life_work').map((row) => row.supersededAt);

    const result = await deleteNote({ userId: ME, slotSlug: 'life_work' });

    expect(result).toEqual({ versions: 3, recaps: 0 });
    const mine = rowsOf(ME, 'life_work');
    // The rows stay, with their numbers — the placeholder is a row, not a hole.
    expect(mine.map((row) => row.version)).toEqual([1, 2, 3]);
    for (const row of mine) {
      expect(row).toMatchObject({
        value: REMOVED_VALUE,
        valueJson: REMOVED_VALUE_JSON,
        sourceType: REMOVED_SOURCE_TYPE,
        reasoningNote: REMOVED_REASONING,
        provenance: {},
        confidence: 1,
      });
    }
    // The chain's shape is kept: only the head is the head.
    expect(mine.map((row) => row.supersededAt)).toEqual(supersededBefore);
    // Nothing of the words survives anywhere in the person's rows.
    const serialised = JSON.stringify(mine);
    for (const words of ['teaches', 'teaching', 'nurse', 'father', 'conv-1']) {
      expect(serialised).not.toContain(words);
    }
    // The sibling note and the other person's note are exactly as they were.
    expect(rowsOf(ME, 'life_rhythm')[0]).toMatchObject({ value: 'early riser' });
    expect(rowsOf(THEM, 'life_work')[0]).toMatchObject({
      value: 'their own words',
      sourceType: 'inferred',
    });
  });

  it('drops the note’s vectors in the same transaction, once its versions are placeholders (t-107)', async () => {
    threeVersions();
    let wipedWhenForgotten: boolean[] = [];
    forgetWipedNotes.mockImplementationOnce(async () => {
      wipedWhenForgotten = rowsOf(ME, 'life_work').map(
        (row) => row.sourceType === REMOVED_SOURCE_TYPE
      );
      return 3;
    });

    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    // The transaction's client (the fake forwards it), and the person from the session.
    expect(forgetWipedNotes).toHaveBeenCalledWith(prismaFake, { userId: ME });
    expect(wipedWhenForgotten).toEqual([true, true, true]);
    // And every stored memory-search result that may quote the note (t-130).
    expect(clearStoredSearchResults).toHaveBeenCalledWith(prismaFake, { userId: ME });
  });

  it('cannot reach another person’s note under the same heading', async () => {
    world.values.push(value(THEM, 'life_work', { value: 'their own words' }));

    await expect(deleteNote({ userId: ME, slotSlug: 'life_work' })).rejects.toMatchObject({
      status: 404,
    });
    expect(rowsOf(THEM, 'life_work')[0]).toMatchObject({ value: 'their own words' });
  });

  it('answers a hidden slot exactly as it answers an absent one, and changes nothing', async () => {
    world.projections.push(definition('development_stage', { visibility: 'hidden' }));
    world.values.push(value(ME, 'development_stage', { value: 'stage two' }));

    const hidden = await deleteNote({ userId: ME, slotSlug: 'development_stage' }).catch(
      (error: unknown) => error
    );
    const absent = await deleteNote({ userId: ME, slotSlug: 'never_filled' }).catch(
      (error: unknown) => error
    );

    expect(hidden).toMatchObject({ status: 404 });
    expect(absent).toMatchObject({ status: 404 });
    expect((hidden as Error).message).toBe((absent as Error).message);
    expect(rowsOf(ME, 'development_stage')[0]).toMatchObject({ value: 'stage two' });
  });

  it('treats a slot hidden only in our own taxonomy as hidden', async () => {
    world.ours = [{ slug: 'life_work', visibility: 'hidden' }];
    world.values.push(value(ME, 'life_work'));

    await expect(deleteNote({ userId: ME, slotSlug: 'life_work' })).rejects.toMatchObject({
      status: 404,
    });
    expect(rowsOf(ME, 'life_work')[0].sourceType).toBe('inferred');
  });

  it('has nothing to remove the second time', async () => {
    threeVersions();
    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    forgetWipedNotes.mockClear();

    await expect(deleteNote({ userId: ME, slotSlug: 'life_work' })).rejects.toMatchObject({
      status: 404,
    });
    expect(forgetWipedNotes).not.toHaveBeenCalled();
  });

  it('removes a retired note and an Art. 9 one — taking something back does not depend on either', async () => {
    world.projections = [
      definition('life_work', { isActive: false }),
      definition('beliefs', { sensitivity: 'special_category' }),
    ];
    world.ours = [];
    world.values.push(
      value(ME, 'life_work'),
      value(ME, 'beliefs', {
        value: '<redacted: special_category>',
        reasoningNote: 'A paraphrase of what they believe.',
      })
    );

    await deleteNote({ userId: ME, slotSlug: 'life_work' });
    await deleteNote({ userId: ME, slotSlug: 'beliefs' });

    expect(rowsOf(ME, 'life_work')[0].sourceType).toBe(REMOVED_SOURCE_TYPE);
    // The kept summary of an Art. 9 note is exactly what someone may want gone.
    expect(rowsOf(ME, 'beliefs')[0].reasoningNote).toBe(REMOVED_REASONING);
  });

  it('drops the person’s cached context on every seat and every module', async () => {
    threeVersions();

    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    for (const seat of READABLE_SEATS) {
      expect(invalidateContext).toHaveBeenCalledWith(FACILITATION_CONTEXT_TYPE, seat, {
        userId: ME,
      });
    }
    expect(invalidateContext).toHaveBeenCalledWith('module', 'values', { userId: ME });
    expect(invalidateContext).toHaveBeenCalledWith('module', 'onboarding', { userId: ME });
  });

  it('drops no cache when it removed nothing', async () => {
    await deleteNote({ userId: ME, slotSlug: 'life_work' }).catch(() => undefined);

    expect(invalidateContext).not.toHaveBeenCalled();
  });
});

describe('a heading Lelañea made up (`/code-review`, t-78)', () => {
  // No definition in either tier: the AI coined it from what was said.
  const MINTED = 'leaving_my_husband';

  beforeEach(() => {
    world.values.push(
      value(ME, MINTED, { version: 1, supersededAt: new Date(5_000) }),
      value(ME, MINTED, { version: 2 }),
      value(THEM, MINTED, { value: 'their own words' }),
      value(ME, 'life_work', { value: 'a taxonomy note' })
    );
    world.ledger = [
      { turnId: 'turn-mine', userId: ME, slotSlug: MINTED, version: 2 },
      { turnId: 'turn-theirs', userId: THEM, slotSlug: MINTED, version: 1 },
    ];
  });

  it('moves every version to an opaque heading, so the words in it go too', async () => {
    await deleteNote({ userId: ME, slotSlug: MINTED });

    const mine = world.values.filter((row) => row.userId === ME && row.slotSlug !== 'life_work');
    expect(mine).toHaveLength(2);
    const [renamed] = new Set(mine.map((row) => row.slotSlug));
    expect(new Set(mine.map((row) => row.slotSlug)).size).toBe(1);
    expect(renamed.startsWith(REMOVED_SLUG_PREFIX)).toBe(true);
    expect(renamed).not.toContain('husband');
    expect(mine.map((row) => row.version).sort()).toEqual([1, 2]);
    // The other person's note under the same coined heading is theirs, untouched.
    expect(rowsOf(THEM, MINTED)[0]).toMatchObject({ value: 'their own words' });
    // And a taxonomy heading is an admin's wording, which stays.
    expect(rowsOf(ME, 'life_work')[0].slotSlug).toBe('life_work');
  });

  it('moves the person’s ledger rows with it, and nobody else’s', async () => {
    await deleteNote({ userId: ME, slotSlug: MINTED });

    const [renamed] = world.values
      .filter((row) => row.userId === ME && row.slotSlug.startsWith(REMOVED_SLUG_PREFIX))
      .map((row) => row.slotSlug);
    expect(world.ledger.find((row) => row.turnId === 'turn-mine')?.slotSlug).toBe(renamed);
    expect(world.ledger.find((row) => row.turnId === 'turn-theirs')?.slotSlug).toBe(MINTED);
  });

  it('lets a later reading under the old heading start afresh, without colliding', async () => {
    await deleteNote({ userId: ME, slotSlug: MINTED });

    const next = await appendSlotValue({
      userId: ME,
      slotSlug: MINTED,
      value: 'said again',
      confidence: 6,
      sourceType: 'inferred',
      reasoningNote: 'Came up again.',
      provenance: {},
    });

    expect(next.version).toBe(1);
    expect(rowsOf(ME, MINTED)).toHaveLength(1);
  });

  it('keeps a taxonomy note’s ledger rows where they are', async () => {
    world.ledger.push({ turnId: 'turn-work', userId: ME, slotSlug: 'life_work', version: 1 });

    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    expect(world.ledger.find((row) => row.turnId === 'turn-work')?.slotSlug).toBe('life_work');
  });
});

describe('after a removal', () => {
  it('numbers the next capture after the placeholder, not from 1', async () => {
    threeVersions();
    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    const next = await appendSlotValue({
      userId: ME,
      slotSlug: 'life_work',
      value: 'a new reading',
      confidence: 7,
      sourceType: 'direct',
      reasoningNote: 'Said again, later.',
      provenance: {},
    });

    expect(next.version).toBe(4);
    // The placeholder head was superseded like any other head.
    expect(rowsOf(ME, 'life_work')[2].supersededAt).not.toBeNull();
    expect(rowsOf(ME, 'life_work').filter((row) => row.supersededAt === null)).toHaveLength(1);
  });

  it('shows the placeholder on the panel, and nothing of the note', async () => {
    threeVersions();
    world.values.push(value(ME, 'life_rhythm', { value: 'early riser' }));
    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    const view = await getNotes(ME);

    const removed = view.notes.find((note) => note.slotSlug === 'life_work');
    expect(removed).toMatchObject({
      removed: true,
      removable: false,
      correctable: false,
      value: '',
      reasoningNote: '',
      conversationId: null,
      withheld: false,
    });
    expect(removed?.previous).toMatchObject({ removed: true, value: '', withheld: false });
    // The marker is written for the AI and never reaches the person.
    expect(JSON.stringify(view)).not.toContain(REMOVED_VALUE);
    expect(JSON.stringify(view)).not.toContain('nurse');
    // The sibling is a live note beside it.
    expect(view.notes.find((note) => note.slotSlug === 'life_rhythm')).toMatchObject({
      removed: false,
      removable: true,
      value: 'early riser',
    });
  });

  it('shows a removed earlier version under a new reading as removed', async () => {
    threeVersions();
    await deleteNote({ userId: ME, slotSlug: 'life_work' });
    await appendSlotValue({
      userId: ME,
      slotSlug: 'life_work',
      value: 'a new reading',
      confidence: 7,
      sourceType: 'direct',
      reasoningNote: 'Said again, later.',
      provenance: {},
    });

    const view = await getNotes(ME);

    expect(view.notes[0]).toMatchObject({ value: 'a new reading', removed: false, version: 4 });
    expect(view.notes[0].previous).toMatchObject({ version: 3, removed: true, value: '' });
  });

  it('refuses to correct a removed note, with the correction’s own 404', async () => {
    threeVersions();
    await deleteNote({ userId: ME, slotSlug: 'life_work' });

    await expect(
      correctNote({ userId: ME, slotSlug: 'life_work', value: 'my words' })
    ).rejects.toMatchObject({ status: 404 });
    expect(rowsOf(ME, 'life_work')).toHaveLength(3);
  });

  it('reads as unknown to a journey gate, where a live reading satisfies it', async () => {
    threeVersions();
    world.values.push(value(ME, 'life_rhythm', { valueJson: 'retraining as a nurse' }));
    await deleteNote({ userId: ME, slotSlug: 'life_work' });
    const [placeholder] = rowsOf(ME, 'life_work').filter((row) => row.supersededAt === null);
    const [live] = rowsOf(ME, 'life_rhythm');
    const gate = (op: 'eq' | 'gte' | 'lte', target: string | number) =>
      ({ family: 'slot', slug: 'any', op, value: target }) as const;
    const against = (row: typeof placeholder) => ({
      nodeState: () => undefined,
      slot: () => ({
        slotSlug: row.slotSlug,
        valueJson: row.valueJson,
        confidence: row.confidence,
      }),
      now: new Date(),
      target: undefined,
    });

    // The live reading does satisfy these, so a `false` below is the placeholder.
    expect(evaluateCondition(gate('eq', 'retraining as a nurse'), against(live))).toBe(true);
    expect(evaluateCondition(gate('gte', 'a'), against(live))).toBe(true);

    for (const condition of [
      gate('eq', 'retraining as a nurse'),
      gate('gte', 'a'),
      gate('lte', 'z'),
      gate('gte', 0),
    ]) {
      expect(evaluateCondition(condition, against(placeholder))).toBe(false);
    }
  });
});

describe('the recaps given the note (f-recap t-156)', () => {
  const MINTED = 'leaving_my_husband';
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id).sort();

  /** A recap of mine, whose reply is one message, listing these headings. */
  function recap(
    id: string,
    notes: string[] | null,
    { userId = ME, startedAt = 100_000 }: { userId?: string; startedAt?: number } = {}
  ): void {
    const conversationId = userId === ME ? 'conv-mine' : 'conv-theirs';
    world.turns.push({
      id,
      userId,
      turnId: recapTurnId(`ses_${id}`),
      status: 'completed',
      startedAt: new Date(startedAt),
      conversationId,
      userMessageId: null,
      sessionId: `ses_${id}`,
      recap:
        notes === null
          ? null
          : { since: new Date(0).toISOString(), source: 'words', words: 1, notes, journey: 0 },
    });
    world.messages.push({
      id: `reply-${id}`,
      conversationId,
      ownerId: userId,
      role: 'assistant',
      content: `The recap ${id}, saying back ${notes?.join(', ') ?? 'something'}.`,
      createdAt: new Date(startedAt + 500),
    });
  }

  /**
   * My `life_work` (three versions, first captured at 1s) and `life_rhythm`;
   * their `life_work`; and recaps of mine and theirs listing them.
   */
  function withRecaps(): void {
    threeVersions();
    world.values.push(
      value(ME, 'life_rhythm', { value: 'early riser' }),
      value(THEM, 'life_work', { value: 'their own words' })
    );
    recap('named-it', ['life work', 'life rhythm']);
    recap('named-other', ['life rhythm'], { startedAt: 200_000 });
    recap('theirs', ['life work'], { userId: THEM });
  }

  it('takes my recap that listed its heading, with its reply, and no other', async () => {
    withRecaps();
    expect(world.turns).toHaveLength(3);

    const result = await deleteNote({ userId: ME, slotSlug: 'life_work' });

    expect(result).toEqual({ versions: 3, recaps: 1 });
    expect(ids(world.turns)).toEqual(['named-other', 'theirs']);
    expect(ids(world.messages)).toEqual(['reply-named-other', 'reply-theirs']);
    // Theirs listed the same heading, and stays word for word.
    expect(world.messages.find((row) => row.id === 'reply-theirs')?.content).toBe(
      'The recap theirs, saying back life work.'
    );
    expect(rowsOf(THEM, 'life_work')[0].value).toBe('their own words');
  });

  it('takes the recap that listed a heading the AI made up, though the heading moves', async () => {
    world.values.push(value(ME, MINTED, { value: 'said once' }));
    recap('named-minted', ['leaving my husband']);
    recap('named-other', ['life rhythm']);

    const result = await deleteNote({ userId: ME, slotSlug: MINTED });

    expect(result.recaps).toBe(1);
    expect(ids(world.turns)).toEqual(['named-other']);
    expect(world.values.find((row) => row.userId === ME)?.slotSlug).toMatch(
      new RegExp(`^${REMOVED_SLUG_PREFIX}`)
    );
  });

  it('takes a recap with no account it can read if it began after the note was first captured', async () => {
    threeVersions(); // first captured at 1s
    recap('unreadable-after', null, { startedAt: 100_000 });
    recap('unreadable-before', null, { startedAt: 500 });

    const result = await deleteNote({ userId: ME, slotSlug: 'life_work' });

    expect(result.recaps).toBe(1);
    expect(ids(world.turns)).toEqual(['unreadable-before']);
  });

  it('refuses while a recap that has to go is still being answered, and changes nothing', async () => {
    withRecaps();
    const running = world.turns.find((row) => row.id === 'named-it')!;
    running.status = 'running';
    running.startedAt = new Date();
    const before = JSON.stringify(world);

    const refused = deleteNote({ userId: ME, slotSlug: 'life_work' });

    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toThrow(/Try again/);
    expect(JSON.stringify(world)).toBe(before);
  });
});
