/**
 * Finding your way around the journey record (f-journey-record t-145): the
 * search, the filters, the order and the totals, as one pure function.
 *
 * @see lib/app/journey-record/query.ts
 */

import { describe, expect, it } from 'vitest';

import type { JourneyEntry } from '@/lib/app/journey-record/entry';
import { journeyRecordQuerySchema, queryJourneyRecord } from '@/lib/app/journey-record/query';

function entry(overrides: Partial<JourneyEntry> & Pick<JourneyEntry, 'id'>): JourneyEntry {
  return {
    kind: 'synopsis',
    state: 'kept',
    summary: 'A session',
    body: 'What was said.',
    outcomes: [],
    modules: [],
    notes: [],
    withheldFromAgent: false,
    regenerationsLeft: null,
    sourceRemoved: false,
    occurredAt: '2026-10-01T09:00:00.000Z',
    keptAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    session: null,
    ...overrides,
  };
}

const RECORD: JourneyEntry[] = [
  entry({
    id: 'older',
    summary: 'Where the café story came from',
    body: 'We talked about the father and the shop.',
    occurredAt: '2026-09-20T09:00:00.000Z',
    outcomes: [
      { kind: 'insight', text: 'The standard was never mine' },
      { kind: 'tension', text: 'Wanting rest, fearing idleness' },
    ],
    modules: ['values'],
  }),
  entry({
    id: 'own',
    kind: 'own',
    summary: null,
    body: 'Woke at three thinking about Lelañea’s question.',
    occurredAt: '2026-09-25T03:00:00.000Z',
  }),
  entry({
    id: 'newer',
    summary: 'Boundaries at work',
    body: 'Saying no to the Thursday meeting.',
    occurredAt: '2026-10-02T09:00:00.000Z',
    outcomes: [{ kind: 'action', text: 'Decline the Thursday meeting' }],
    modules: ['boundaries', 'values'],
  }),
  entry({
    id: 'draft',
    state: 'draft',
    keptAt: null,
    summary: 'Not kept yet',
    body: 'A tension about the father.',
    occurredAt: '2026-10-05T09:00:00.000Z',
    outcomes: [{ kind: 'tension', text: 'Still open' }],
    modules: ['money'],
  }),
];

const ids = (entries: JourneyEntry[]) => entries.map((e) => e.id);

describe('queryJourneyRecord', () => {
  it('lists the kept record newest first, leaving drafts out unless asked', () => {
    const view = queryJourneyRecord(RECORD);

    expect(ids(view.entries)).toEqual(['newer', 'own', 'older']);
    expect(view).toMatchObject({ total: 3, matched: 3, drafts: 1 });
  });

  it('adds drafts, in their place in time, when they are asked for', () => {
    const view = queryJourneyRecord(RECORD, { drafts: true });

    expect(ids(view.entries)).toEqual(['draft', 'newer', 'own', 'older']);
    // The totals stay the kept record's: a draft is not in it yet (§12).
    expect(view.total).toBe(3);
  });

  it('totals the kept record only, whatever is searched or filtered', () => {
    const all = queryJourneyRecord(RECORD);
    const narrowed = queryJourneyRecord(RECORD, { q: 'thursday', drafts: true });

    const expected = {
      synopses: 2,
      own: 1,
      // The draft's tension is not counted.
      outcomes: { action: 1, insight: 1, tension: 1 },
    };
    expect(all.totals).toEqual(expected);
    expect(narrowed.totals).toEqual(expected);
    // The module filter's options are the kept record's too: no `money`.
    expect(all.modules).toEqual(['boundaries', 'values']);
  });

  it('matches every word of a search across summary, body, outcomes and modules', () => {
    expect(ids(queryJourneyRecord(RECORD, { q: 'father shop' }).entries)).toEqual(['older']);
    // An outcome's words are searched.
    expect(ids(queryJourneyRecord(RECORD, { q: 'idleness' }).entries)).toEqual(['older']);
    // A module, as words.
    expect(ids(queryJourneyRecord(RECORD, { q: 'boundaries' }).entries)).toEqual(['newer']);
    // Every word must match somewhere; one missing word is no match.
    expect(queryJourneyRecord(RECORD, { q: 'father thursday' }).matched).toBe(0);
  });

  it('folds case and accents', () => {
    expect(ids(queryJourneyRecord(RECORD, { q: 'LELANEA' }).entries)).toEqual(['own']);
    expect(ids(queryJourneyRecord(RECORD, { q: 'cafe' }).entries)).toEqual(['older']);
  });

  it('filters by module, by kind of outcome and by kind of entry', () => {
    expect(ids(queryJourneyRecord(RECORD, { module: 'values' }).entries)).toEqual([
      'newer',
      'older',
    ]);
    expect(ids(queryJourneyRecord(RECORD, { outcome: 'tension' }).entries)).toEqual(['older']);
    expect(ids(queryJourneyRecord(RECORD, { outcome: 'tension', drafts: true }).entries)).toEqual([
      'draft',
      'older',
    ]);
    expect(ids(queryJourneyRecord(RECORD, { kind: 'own' }).entries)).toEqual(['own']);
  });

  it('answers an empty record with zeros, not an error', () => {
    expect(queryJourneyRecord([])).toEqual({
      entries: [],
      matched: 0,
      total: 0,
      drafts: 0,
      totals: { synopses: 0, own: 0, outcomes: { action: 0, insight: 0, tension: 0 } },
      modules: [],
    });
  });
});

describe('journeyRecordQuerySchema', () => {
  it('reads the query string, treating an all-space search as none', () => {
    expect(
      journeyRecordQuerySchema.parse({
        q: '   ',
        module: 'values',
        outcome: 'insight',
        drafts: 'true',
      })
    ).toEqual({ q: undefined, module: 'values', outcome: 'insight', drafts: true });
    expect(journeyRecordQuerySchema.parse({}).drafts).toBe(false);
  });

  it('refuses a malformed module or outcome', () => {
    expect(journeyRecordQuerySchema.safeParse({ module: 'Values!' }).success).toBe(false);
    expect(journeyRecordQuerySchema.safeParse({ outcome: 'decision' }).success).toBe(false);
  });
});
