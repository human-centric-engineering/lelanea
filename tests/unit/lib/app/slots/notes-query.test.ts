/**
 * Search, group filter and sort over a cleaned list of notes (f-slots t-79).
 *
 * `queryNotes` is pure, so this is where its rules are pinned case by case. The
 * guarantee that hidden slots never reach it is `getNotes()`'s, and is asserted
 * end to end through the route in
 * `tests/unit/app/api/v1/app/notes/route-query.test.ts`.
 *
 * Every absence below is asserted beside a presence over the same term, so an
 * empty result is the rule working rather than a search that finds nothing.
 *
 * @see lib/app/slots/notes-query.ts
 */

import { describe, it, expect } from 'vitest';

import {
  notesQuerySchema,
  notesSearch,
  queryNotes,
  readNotesParams,
} from '@/lib/app/slots/notes-query';
import type { Note } from '@/lib/app/slots/notes-view';

function note(overrides: Partial<Note> = {}): Note {
  return {
    slotSlug: 'life_work',
    asking: 'How work stands for this person right now.',
    value: 'Work is going badly.',
    withheld: false,
    confidence: 6,
    sourceType: 'inferred',
    reasoningNote: 'Put together from two things said in passing.',
    version: 1,
    capturedAt: '2026-09-21T09:00:00.000Z',
    conversationId: null,
    sensitivity: 'standard',
    retired: false,
    correctable: true,
    previous: null,
    group: 'life_areas',
    ...overrides,
  };
}

const record = [
  note({ slotSlug: 'life_work', capturedAt: '2026-09-21T09:00:00.000Z' }),
  note({
    slotSlug: 'life_money',
    value: 'Money is tight this month.',
    capturedAt: '2026-09-21T11:00:00.000Z',
  }),
  note({
    slotSlug: 'the_person_disposition',
    group: 'the_person',
    value: 'Quick to laugh, slow to decide.',
    capturedAt: '2026-09-21T10:00:00.000Z',
  }),
  note({
    slotSlug: 'family_communication',
    group: null,
    asking: null,
    value: 'Has not spoken to his brother since the summer.',
    capturedAt: '2026-09-21T12:00:00.000Z',
  }),
];

const slugs = (notes: Note[]) => notes.map((n) => n.slotSlug);

describe('search', () => {
  it('finds the thing about the brother, and only that', () => {
    const view = queryNotes(record, { q: 'brother' });
    expect(slugs(view.notes)).toEqual(['family_communication']);
    expect(view.matched).toBe(1);
    expect(view.total).toBe(4);
  });

  it('needs every word, in any field, in any order', () => {
    // "tight" is in the reading and "money" in the slug's tag.
    expect(slugs(queryNotes(record, { q: 'tight money' }).notes)).toEqual(['life_money']);
    expect(queryNotes(record, { q: 'tight brother' }).matched).toBe(0);
  });

  it('folds case and accents', () => {
    const accented = [note({ value: 'Talked about Lelañea and the café.' })];
    expect(queryNotes(accented, { q: 'LELANEA cafe' }).matched).toBe(1);
  });

  it('matches the reasoning, the wording and the heading of a standard note', () => {
    expect(slugs(queryNotes(record, { q: 'in passing' }).notes)).toHaveLength(4);
    expect(slugs(queryNotes(record, { q: 'how work stands' }).notes)).toContain('life_work');
    expect(slugs(queryNotes(record, { q: 'own headings' }).notes)).toEqual([
      'family_communication',
    ]);
  });

  it('matches a blanked-out note on its summary and wording, never its sentinel', () => {
    // The card shows the summary since t-80, so a search finds it there. The
    // sentinel is never matched: "redacted" would otherwise find every one.
    const art9 = note({
      slotSlug: 'life_physical_health',
      value: '<redacted: special_category>',
      withheld: true,
      sensitivity: 'special_category',
      correctable: false,
      reasoningNote: 'Mentioned the migraines twice.',
      asking: 'How their body and sleep stand right now.',
    });
    const standard = note({
      slotSlug: 'life_work',
      reasoningNote: 'Blamed the migraines on work.',
    });
    const both = [art9, standard];

    expect(slugs(queryNotes(both, { q: 'migraines' }).notes).sort()).toEqual([
      'life_physical_health',
      'life_work',
    ]);
    expect(slugs(queryNotes(both, { q: 'redacted' }).notes)).toEqual([]);
    expect(slugs(queryNotes(both, { q: 'special_category' }).notes)).toEqual([]);
    // Its wording still finds it — the person can look for what was asked.
    expect(slugs(queryNotes(both, { q: 'sleep' }).notes)).toEqual(['life_physical_health']);
    expect(slugs(queryNotes(both, { q: 'physical health' }).notes)).toEqual([
      'life_physical_health',
    ]);
  });

  it('does not search the version before the current one', () => {
    const corrected = [
      note({
        value: 'Work is going fine.',
        version: 2,
        previous: {
          version: 1,
          value: 'Thinking about leaving.',
          withheld: false,
          sourceType: 'inferred',
          confidence: 6,
          capturedAt: '2026-09-20T09:00:00.000Z',
        },
      }),
    ];
    expect(queryNotes(corrected, { q: 'fine' }).matched).toBe(1);
    expect(queryNotes(corrected, { q: 'leaving' }).matched).toBe(0);
  });
});

describe('group filter', () => {
  it('keeps one group, and Lelañea’s own headings as `_own`', () => {
    expect(slugs(queryNotes(record, { group: 'the_person' }).notes)).toEqual([
      'the_person_disposition',
    ]);
    expect(slugs(queryNotes(record, { group: '_own' }).notes)).toEqual(['family_communication']);
  });

  it('answers a group nobody has notes under with nothing — the counts unchanged', () => {
    const view = queryNotes(record, { group: 'development' });
    expect(view.notes).toEqual([]);
    expect(view.matched).toBe(0);
    expect(view.total).toBe(4);
    expect(view).toEqual(queryNotes(record, { group: 'no_such_group' }));
  });

  it('counts the groups in use before narrowing, so the options stay put', () => {
    const narrowed = queryNotes(record, { q: 'brother', group: '_own' });
    expect(narrowed.groups).toEqual([
      { key: 'life_areas', title: 'Life areas', count: 2 },
      { key: 'the_person', title: 'The person', count: 1 },
    ]);
    expect(narrowed.own).toBe(1);
  });
});

describe('sort', () => {
  it('`grouped`: by heading, own headings last, freshest first inside each', () => {
    expect(slugs(queryNotes(record).notes)).toEqual([
      'life_money',
      'life_work',
      'the_person_disposition',
      'family_communication',
    ]);
  });

  it('`recent`: one list across every group, freshest first', () => {
    expect(slugs(queryNotes(record, { sort: 'recent' }).notes)).toEqual([
      'family_communication',
      'life_money',
      'the_person_disposition',
      'life_work',
    ]);
  });
});

describe('the query string', () => {
  it('trims the search and treats an all-space one as none', () => {
    expect(notesQuerySchema.parse({ q: '  brother  ' })).toEqual({ q: 'brother' });
    expect(notesQuerySchema.parse({ q: '   ' })).toEqual({ q: undefined });
  });

  it('refuses an overlong search and a malformed group, and drops what it does not read', () => {
    expect(notesQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(notesQuerySchema.safeParse({ group: 'Life Areas' }).success).toBe(false);
    expect(notesQuerySchema.safeParse({ sort: 'oldest' }).success).toBe(false);
    expect(notesQuerySchema.parse({ group: '_own', view: 'list' })).toEqual({ group: '_own' });
  });

  it('writes a URL with the defaults left out', () => {
    expect(notesSearch({ q: '', group: null, sort: 'grouped', view: 'cards' })).toBe('');
    expect(notesSearch({ q: ' brother ', group: '_own', sort: 'recent', view: 'list' })).toBe(
      '?q=brother&group=_own&sort=recent&view=list'
    );
  });

  it('reads a URL leniently: a bad control falls back alone, the rest are kept', () => {
    expect(
      readNotesParams(new URLSearchParams('q=brother&group=Bad%20Group&sort=oldest&view=list'))
    ).toEqual({ q: 'brother', group: null, sort: 'grouped', view: 'list' });
    expect(readNotesParams(new URLSearchParams(''))).toEqual({
      q: '',
      group: null,
      sort: 'grouped',
      view: 'cards',
    });
  });
});
