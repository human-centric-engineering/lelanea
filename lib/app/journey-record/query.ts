/**
 * Finding your way around the journey record: search, filters by module, by
 * kind of outcome and by kind of entry, as one pure function over the
 * person's whole record (f-journey-record t-145; §3.16: "searchable,
 * filterable by module or by kind of outcome").
 *
 * ## Why this is not SQL
 *
 * The same reasoning as the notes (`lib/app/slots/notes-query.ts`). A record
 * holds one entry per session plus what the person writes, so it runs to
 * dozens of rows, or a few hundred after years. The page needs the totals over
 * all of it before any narrowing, so the read loads it anyway. Matching in
 * memory also lets a search reach the outcomes, which are JSON. **Revisit if
 * one person's record passes a few thousand entries.**
 *
 * ## What a search matches
 *
 * An entry matches when **every** word of the search appears somewhere in what
 * its stop shows: the one-line summary, the account or the words, each outcome,
 * and the modules it touched. Case and accents are folded, so "lelanea" finds
 * "Lelañea".
 */

import { z } from 'zod';

import {
  JOURNEY_ENTRY_KINDS,
  JOURNEY_OUTCOME_KINDS,
  countOutcomes,
  type JourneyEntry,
  type JourneyEntryKind,
  type JourneyOutcomeCounts,
  type JourneyOutcomeKind,
} from '@/lib/app/journey-record/entry';

export const JOURNEY_SEARCH_MAX = 200;

/** A module slug as the roster writes one. A slug nobody has is an empty answer, not an error. */
const moduleSlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Not a module slug');

/**
 * The route's query string. Unknown parameters are dropped rather than
 * refused, so a saved link carrying the page's own state keeps working.
 */
export const journeyRecordQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(JOURNEY_SEARCH_MAX)
    .optional()
    .transform((q) => (q ? q : undefined)),
  module: moduleSlugSchema.optional(),
  outcome: z.enum(JOURNEY_OUTCOME_KINDS).optional(),
  kind: z.enum(JOURNEY_ENTRY_KINDS).optional(),
  /** Whether drafts waiting for the person come back too. The page asks; nothing else needs to. */
  drafts: z
    .enum(['true', 'false'])
    .optional()
    .transform((drafts) => drafts === 'true'),
});

export interface JourneyRecordQuery {
  q?: string;
  module?: string;
  outcome?: JourneyOutcomeKind;
  kind?: JourneyEntryKind;
  drafts?: boolean;
}

/** Totals over the kept record, before any search or filter, so they hold still as someone narrows. */
export interface JourneyRecordTotals {
  /** Kept synopses, which is one per session the person kept an account of. */
  synopses: number;
  own: number;
  outcomes: JourneyOutcomeCounts;
}

export interface JourneyRecordView {
  entries: JourneyEntry[];
  /** How many entries the search and filters left. */
  matched: number;
  /** Every kept entry. */
  total: number;
  /** Synopses waiting for the person to approve, edit or regenerate. Counted whether or not they were asked for. */
  drafts: number;
  totals: JourneyRecordTotals;
  /** Every module the kept record touches, alphabetically: the module filter's options. */
  modules: string[];
}

/** Case and accents folded, so "lelanea" finds "Lelañea" and "CAFE" finds "café". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-GB');
}

function searchableText(entry: JourneyEntry): string {
  return fold(
    [
      entry.summary ?? '',
      entry.body,
      ...entry.outcomes.map((outcome) => outcome.text),
      ...entry.modules.map((slug) => slug.replace(/[_-]/g, ' ')),
    ].join('\n')
  );
}

function matches(entry: JourneyEntry, query: JourneyRecordQuery, terms: string[]): boolean {
  if (query.kind !== undefined && entry.kind !== query.kind) return false;
  if (query.module !== undefined && !entry.modules.includes(query.module)) return false;
  if (query.outcome !== undefined && !entry.outcomes.some((o) => o.kind === query.outcome)) {
    return false;
  }
  if (terms.length === 0) return true;
  const text = searchableText(entry);
  return terms.every((term) => text.includes(term));
}

/** Newest first; ties by id so the order is total and two reads agree. */
function byRecency(a: JourneyEntry, b: JourneyEntry): number {
  return b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id);
}

/**
 * The page a person asked for, from their whole record.
 *
 * Drafts never count toward the totals: they are not in the record yet (§12).
 */
export function queryJourneyRecord(
  entries: readonly JourneyEntry[],
  query: JourneyRecordQuery = {}
): JourneyRecordView {
  const kept = entries.filter((entry) => entry.state === 'kept');
  const drafts = entries.length - kept.length;

  const synopses = kept.filter((entry) => entry.kind === 'synopsis');
  const totals: JourneyRecordTotals = {
    synopses: synopses.length,
    own: kept.length - synopses.length,
    outcomes: countOutcomes(kept.flatMap((entry) => entry.outcomes)),
  };
  const modules = [...new Set(kept.flatMap((entry) => entry.modules))].sort();

  const terms = query.q ? fold(query.q).split(/\s+/).filter(Boolean) : [];
  const pool = query.drafts ? entries : kept;
  const matched = pool.filter((entry) => matches(entry, query, terms)).sort(byRecency);

  return { entries: matched, matched: matched.length, total: kept.length, drafts, totals, modules };
}
