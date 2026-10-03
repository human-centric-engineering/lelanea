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

const { deleteNote } = await import('@/lib/app/slots/delete-note');
const { getNotes, correctNote } = await import('@/lib/app/slots/notes');
const { appendSlotValue } = await import('@/lib/framework/data-slots');
const { evaluateCondition } = await import('@/lib/framework/facilitation/engine/conditions');
const { READABLE_SEATS } = await import('@/lib/app/conversation/seats');
const { FACILITATION_CONTEXT_TYPE } = await import('@/lib/app/voice/context-contributor');
const { REMOVED_REASONING, REMOVED_SOURCE_TYPE, REMOVED_VALUE, REMOVED_VALUE_JSON } =
  await import('@/lib/app/slots/removed');

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

    expect(result).toEqual({ versions: 3 });
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

    await expect(deleteNote({ userId: ME, slotSlug: 'life_work' })).rejects.toMatchObject({
      status: 404,
    });
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
