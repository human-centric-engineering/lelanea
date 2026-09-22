/**
 * Her notes: what reaches the person they are about, and what never does
 * (f-slots t-73).
 *
 * ## The assertions that fail when the behaviour is wrong (`fp6`)
 *
 * Three, and each is written against a **non-empty** population, because every
 * claim here is an absence and an absence proves nothing on an empty store:
 *
 * - *Hidden slots never leave the server.* The fixture holds a development
 *   note beside the open ones, and the open ones are asserted present in the
 *   same case. Delete the `hidden` filter in `getNotes` and this fails.
 * - *One person's notes are not another's.* Both people have notes under the
 *   same slugs with different words, and each read is asserted to carry its
 *   own — so a read that ignored `userId` would return rows and still fail.
 * - *A correction appends.* The prior row is asserted still present, still
 *   holding its words, stamped `supersededAt` rather than gone.
 *
 * ## What is faked, and what is not
 *
 * The Prisma client only — `notes-fake.ts`, shared with the route's query tests. Daybreak's value engine (`appendSlotValue`,
 * `getSlotHeads`) and its definition queries run for REAL against it, because
 * the properties above are properties of those queries — a test that mocked
 * `getSlotHeads` to filter by person would be asserting its own fake (`B9`).
 * The fake therefore honours the `where` clauses those functions actually send,
 * and nothing else: an unrecognised filter throws rather than being ignored,
 * so a query this file does not model fails loudly instead of matching
 * everything.
 *
 * @see lib/app/slots/notes.ts
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

vi.mock('@/lib/db/client', async () => ({
  prisma: (await import('@/tests/unit/lib/app/slots/notes-fake')).prismaFake,
}));
vi.mock('@/lib/db/utils', async () => {
  const { prismaFake } = await import('@/tests/unit/lib/app/slots/notes-fake');
  return {
    executeTransaction: (work: (tx: typeof prismaFake) => Promise<unknown>) => work(prismaFake),
  };
});

// Imported dynamically, after the mocks above — the same shape as
// `capture.test.ts` next door.
const { getNotes, correctNote, CORRECTION_CONFIDENCE } = await import('@/lib/app/slots/notes');

beforeEach(() => {
  vi.clearAllMocks();
  resetWorld();
});

describe('what a person is shown', () => {
  beforeEach(() => {
    world.projections = [
      definition('life_work'),
      definition('the_person_disposition', { group: 'the_person' }),
      definition('development_stage', { group: 'development', visibility: 'hidden' }),
    ];
    world.ours = world.projections.map((row) => ({ slug: row.slug, visibility: row.visibility }));
    world.values = [
      value(ME, 'life_work'),
      value(ME, 'the_person_disposition'),
      value(ME, 'development_stage', { value: 'they are at stage two' }),
    ];
  });

  it('withholds a hidden slot while showing the open ones beside it', async () => {
    const view = await getNotes(ME);

    // The population is non-empty and two of its three rows come back, so the
    // absence below is a filter doing work rather than an empty store.
    expect(view.total).toBe(2);
    const slugs = view.notes.map((note) => note.slotSlug);
    expect(slugs).toEqual(expect.arrayContaining(['life_work', 'the_person_disposition']));
    expect(slugs).not.toContain('development_stage');
    expect(JSON.stringify(view)).not.toContain('they are at stage two');
  });

  it('withholds a slot hidden in our taxonomy even when its projection is stale', async () => {
    // `loadGlobalSlotDefinitions()` withholds a row whose classifier it cannot
    // read, so the projection can still say `open` after an admin has hidden
    // it. Reading only Daybreak's table would leak this one.
    world.projections = world.projections.map((row) =>
      row.slug === 'development_stage' ? { ...row, visibility: 'open' } : row
    );

    const view = await getNotes(ME);

    expect(view.total).toBe(2);
    expect(JSON.stringify(view)).not.toContain('they are at stage two');
  });

  it('files each note under its taxonomy group, and counts the groups in use by title', async () => {
    const view = await getNotes(ME);
    expect(view.notes.map((note) => [note.slotSlug, note.group])).toEqual([
      ['life_work', 'life_areas'],
      ['the_person_disposition', 'the_person'],
    ]);
    // The hidden `development` group has a note in the store and is still not
    // offered as a group — it never reaches the counts.
    expect(view.groups).toEqual([
      { key: 'life_areas', title: 'Life areas', count: 1 },
      { key: 'the_person', title: 'The person', count: 1 },
    ]);
  });

  it('keeps a slug she invented apart from the taxonomy', async () => {
    world.values.push(
      value(ME, 'family_communication', { value: 'has not spoken to his brother' })
    );

    const view = await getNotes(ME);

    const mint = view.notes.find((note) => note.slotSlug === 'family_communication');
    // No definition means no group, and nothing to have been measured against.
    expect(mint?.group).toBeNull();
    expect(mint?.asking).toBeNull();
    expect(view.own).toBe(1);
    // Lelañea's own headings come after every taxonomy group, however fresh.
    expect(view.notes.at(-1)?.slotSlug).toBe('family_communication');
  });

  it('labels a retired slot and refuses to offer a correction on it', async () => {
    world.projections = world.projections.map((row) =>
      row.slug === 'life_work' ? { ...row, isActive: false } : row
    );

    const view = await getNotes(ME);
    const note = view.notes.find((candidate) => candidate.slotSlug === 'life_work');

    // Retirement deletes nothing: the note is still the person's.
    expect(note?.retired).toBe(true);
    expect(note?.correctable).toBe(false);
  });

  it('takes the stricter sensitivity of the two tiers, so it never offers a correction the route refuses', async () => {
    // Only OUR taxonomy calls this slot special-category; the projection says
    // standard. `correctNote` refuses a correction here — so offering one would
    // be a button whose every save returns 409. /code-review, round 1: the
    // read went on consulting the projection alone after the write learned to
    // read both.
    world.projections.push(definition('life_physical_health', { sensitivity: 'standard' }));
    world.ours.push({
      slug: 'life_physical_health',
      visibility: 'open',
      sensitivity: 'special_category',
    });
    world.values.push(value(ME, 'life_physical_health', { value: '<redacted: special_category>' }));

    const view = await getNotes(ME);
    const note = view.notes.find((candidate) => candidate.slotSlug === 'life_physical_health');

    expect(note?.sensitivity).toBe('special_category');
    expect(note?.correctable).toBe(false);
    // And the sentinel is read as what it is, not printed raw.
    expect(note?.withheld).toBe(true);
    // The read and the write agree: the route refuses the same slot.
    await expect(
      correctNote({ userId: ME, slotSlug: 'life_physical_health', value: 'x' })
    ).rejects.toThrow(/ask Lelañea about it/i);
  });

  it('says an Art. 9 note was never written down, rather than printing the sentinel', async () => {
    world.projections.push(definition('life_physical_health', { sensitivity: 'special_category' }));
    world.ours.push({ slug: 'life_physical_health', visibility: 'open' });
    world.values.push(value(ME, 'life_physical_health', { value: '<redacted: special_category>' }));

    const view = await getNotes(ME);
    const note = view.notes.find((candidate) => candidate.slotSlug === 'life_physical_health');

    expect(note?.withheld).toBe(true);
    expect(note?.correctable).toBe(false);
  });

  it('still reads a note blanked out before its slot moved to sensitive as withheld, and lets them correct it', async () => {
    // t-84 moved the nine health slots from special_category to sensitive. A
    // note captured before that holds the sentinel; keyed on the slot's current
    // sensitivity it would print `<redacted: special_category>` as the note.
    world.projections.push(definition('life_physical_health', { sensitivity: 'sensitive' }));
    world.ours.push({ slug: 'life_physical_health', visibility: 'open', sensitivity: 'sensitive' });
    world.values.push(value(ME, 'life_physical_health', { value: '<redacted: special_category>' }));

    const view = await getNotes(ME);
    const note = view.notes.find((candidate) => candidate.slotSlug === 'life_physical_health');

    expect(note?.sensitivity).toBe('sensitive');
    expect(note?.withheld).toBe(true);
    // Their words can be kept now, so they can say them again.
    expect(note?.correctable).toBe(true);
  });

  it('carries the provenance a person is promised (§3.19)', async () => {
    const view = await getNotes(ME);
    const note = view.notes[0];

    expect(note).toMatchObject({
      confidence: 6,
      sourceType: 'inferred',
      reasoningNote: 'She put this together from what was said.',
      conversationId: 'conv-1',
    });
    expect(note?.capturedAt).toBeTypeOf('string');
  });

  it('is empty, not broken, for someone she has learned nothing about', async () => {
    world.values = [];
    await expect(getNotes(ME)).resolves.toEqual({
      notes: [],
      groups: [],
      own: 0,
      total: 0,
      matched: 0,
    });
  });
});

describe('one person’s notes are not another’s', () => {
  it('answers each person with their own words', async () => {
    world.projections = [definition('life_work')];
    world.ours = [{ slug: 'life_work', visibility: 'open' }];
    world.values = [
      value(ME, 'life_work', { value: 'mine' }),
      value(THEM, 'life_work', { value: 'theirs' }),
    ];

    const mine = await getNotes(ME);
    const theirs = await getNotes(THEM);

    // Both populations are non-empty, so "does not contain theirs" is the read
    // being scoped rather than there being nothing to find.
    expect(mine.notes[0]?.value).toBe('mine');
    expect(theirs.notes[0]?.value).toBe('theirs');
    expect(JSON.stringify(mine)).not.toContain('theirs');
  });

  it('will not correct a slot under someone else who has one', async () => {
    world.projections = [definition('life_work')];
    world.values = [value(THEM, 'life_work', { value: 'theirs' })];

    // The slug exists, is open, is active, and has a head — for the other
    // person. The refusal is the scope, not the slug.
    await expect(correctNote({ userId: ME, slotSlug: 'life_work', value: 'mine' })).rejects.toThrow(
      /no note under that heading/i
    );
    expect(world.values).toHaveLength(1);
    expect(world.values[0]?.value).toBe('theirs');
  });
});

describe('a correction is a new version, never an overwrite', () => {
  beforeEach(() => {
    world.projections = [definition('life_work')];
    world.ours = [{ slug: 'life_work', visibility: 'open' }];
    world.values = [value(ME, 'life_work', { value: 'she thinks work is going badly' })];
  });

  it('appends, and leaves the version before it exactly as it was', async () => {
    const written = await correctNote({
      userId: ME,
      slotSlug: 'life_work',
      value: 'it is going fine, actually',
    });

    expect(written).toEqual({ slotSlug: 'life_work', version: 2 });
    expect(world.values).toHaveLength(2);

    const prior = world.values.find((row) => row.version === 1);
    expect(prior?.value).toBe('she thinks work is going badly');
    expect(prior?.supersededAt).toBeInstanceOf(Date);

    const head = world.values.find((row) => row.version === 2);
    expect(head).toMatchObject({
      value: 'it is going fine, actually',
      sourceType: 'user_confirmed',
      confidence: CORRECTION_CONFIDENCE,
      supersededAt: null,
    });
  });

  it('shows both sides of the contradiction afterwards (§3.12)', async () => {
    await correctNote({ userId: ME, slotSlug: 'life_work', value: 'it is going fine, actually' });

    const view = await getNotes(ME);
    const note = view.notes[0];

    expect(note?.value).toBe('it is going fine, actually');
    expect(note?.previous).toMatchObject({
      version: 1,
      value: 'she thinks work is going badly',
      sourceType: 'inferred',
    });
  });

  it('refuses a slug with no note of the caller’s own, so the route cannot mint', async () => {
    await expect(
      correctNote({ userId: ME, slotSlug: 'life_money', value: 'anything at all' })
    ).rejects.toThrow(/no note under that heading/i);
    expect(world.values).toHaveLength(1);
  });

  it('refuses a hidden slot the same way it refuses one that does not exist', async () => {
    world.projections.push(
      definition('development_stage', { group: 'development', visibility: 'hidden' })
    );
    world.ours.push({ slug: 'development_stage', visibility: 'hidden' });
    world.values.push(value(ME, 'development_stage', { value: 'stage two' }));

    // Not a different message and not a different status: answering
    // distinctly would disclose that a hidden slot exists and is filled.
    await expect(
      correctNote({ userId: ME, slotSlug: 'development_stage', value: 'stage four' })
    ).rejects.toThrow(/no note under that heading/i);
    expect(world.values).toHaveLength(2);
  });

  it('refuses a retired slot, naming what happened', async () => {
    world.projections = [definition('life_work', { isActive: false })];

    await expect(
      correctNote({ userId: ME, slotSlug: 'life_work', value: 'it is going fine' })
    ).rejects.toThrow(/no longer asking/i);
    expect(world.values).toHaveLength(1);
  });

  it('refuses an Art. 9 slot our taxonomy marks even when the projection says standard', async () => {
    // The tiers can disagree — a row with a classifier the sync cannot read is
    // withheld from it, leaving a stale projection. Only the union fails
    // closed, which is the rule the hidden check already followed and this one
    // did not until /security-review.
    world.projections = [definition('life_work', { sensitivity: 'standard' })];
    world.ours = [{ slug: 'life_work', visibility: 'open', sensitivity: 'special_category' }];

    await expect(
      correctNote({ userId: ME, slotSlug: 'life_work', value: 'raw health prose' })
    ).rejects.toThrow(/ask Lelañea about it/i);
    expect(JSON.stringify(world.values)).not.toContain('raw health prose');
  });

  it('corrects a note under a slug she coined that the taxonomy rule would reject', async () => {
    // `fill_slot` accepts any slug of 1–120 characters, so a note can sit
    // under one with capitals and a hyphen. The first cut validated
    // corrections with the TAXONOMY rule, and a note like this offered
    // "That's not right" and then refused every save.
    world.projections = [];
    world.ours = [];
    world.values = [value(ME, 'Weekly-Rhythm', { value: 'Sundays are for thinking.' })];

    await expect(
      correctNote({ userId: ME, slotSlug: 'Weekly-Rhythm', value: 'Saturdays, actually.' })
    ).resolves.toEqual({ slotSlug: 'Weekly-Rhythm', version: 2 });
  });

  it('refuses an Art. 9 slot and names the remedy rather than the rule (HB10)', async () => {
    world.projections = [definition('life_work', { sensitivity: 'special_category' })];

    await expect(
      correctNote({ userId: ME, slotSlug: 'life_work', value: 'raw health prose' })
    ).rejects.toThrow(/ask Lelañea about it/i);
    // The words the guard exists to keep out are not at rest.
    expect(world.values).toHaveLength(1);
    expect(JSON.stringify(world.values)).not.toContain('raw health prose');
  });
});
