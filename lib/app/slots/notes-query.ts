/**
 * Finding your way around Lelañea's notes — search, a group filter and a sort,
 * as one pure function over a list that has already been cleaned (f-slots t-79).
 *
 * ## Why this is not SQL
 *
 * `getNotes()` already loads every current note for the person, and it drops
 * hidden slots before anything is shaped — across both tiers' definition
 * tables. Everything here runs **after** that, over what it returned. So there
 * is still exactly one place a hidden slot is removed, and no query path in
 * this module could put one back: it never sees one.
 *
 * `ILIKE` would have been the obvious alternative, and it is worse here. It
 * needs a new query that repeats the both-tiers hidden check and the Art. 9
 * exclusion in SQL, joined across three tables — a second copy of the guardrail
 * that can drift from the first. At 50–70 notes per person the whole list is a
 * few kilobytes already in memory. **Revisit if one person passes a few hundred
 * notes.**
 *
 * ## What a search can match, and what it never can
 *
 * A note matches when **every** word of the search appears somewhere in what
 * the card shows about it: the reading, how Lelañea came to it, what she was
 * looking for, and the heading it is filed under.
 *
 * **An Art. 9 note matches on the slot's wording only — never the reading and
 * never the reasoning.** The reading is a sentinel, so matching it would find
 * every special-category note for a search on "redacted". The reasoning is
 * worse: Daybreak's `fill_slot` masks `value` and nothing else, so the
 * reasoning note is stored as written (**t-80**, raised on Daybreak too). A
 * search that matched it would answer "is there a health note that mentions
 * X?" with a yes, about words the page tells the person were never kept.
 *
 * The version before the current one is not searched. A match has to be
 * visible in the row it produced, and a list row shows the current reading.
 *
 * Case and accents are folded, so "lelanea" finds "Lelañea".
 *
 * @see lib/app/slots/notes.ts — `getNotes()`, the one place hidden slots go
 * @see .context/app/slots.md — "Finding your way around"
 */

import { z } from 'zod';

import { SLOT_SENSITIVITY } from '@/lib/framework/data-slots/vocabulary';
import { MAX_SLUG_LENGTH, slotSlugSchema } from '@/lib/app/slots/validation';
import {
  NOTES_LAYOUTS,
  NOTES_OWN_GROUP,
  NOTES_OWN_TITLE,
  NOTES_SEARCH_MAX,
  NOTES_SORTS,
  noteGroupTitle,
  type Note,
  type NoteGroupCount,
  type NotesLayout,
  type NotesSort,
  type NotesView,
} from '@/lib/app/slots/notes-view';

/** What the server is asked. `view` is the page's alone and never reaches it. */
export interface NotesQuery {
  q?: string;
  group?: string;
  sort?: NotesSort;
}

/**
 * The route's query string.
 *
 * `q` is trimmed, and an all-space search is no search. `group` is either a
 * slug-shaped key or {@link NOTES_OWN_GROUP}; a malformed one is a 400, but a
 * **well-formed key nobody has notes under — hidden or nonexistent — is an
 * empty answer, and the same one for both**, because answering differently
 * would tell someone a hidden group exists.
 *
 * Unknown parameters are dropped rather than refused: the page's own `view`
 * rides in the same URL, and a link someone saves should not start failing
 * because it carries a parameter this route does not read.
 */
export const notesQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(NOTES_SEARCH_MAX)
    .optional()
    .transform((q) => (q ? q : undefined)),
  group: z.union([z.literal(NOTES_OWN_GROUP), slotSlugSchema.max(MAX_SLUG_LENGTH)]).optional(),
  sort: z.enum(NOTES_SORTS).optional(),
});

/** Case and accents folded, so "lelanea" finds "Lelañea" and "CAFE" finds "café". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-GB');
}

/** The heading a note is filed under, in words. */
export function noteHeading(note: Note): string {
  return note.group === null ? NOTES_OWN_TITLE : noteGroupTitle(note.group);
}

/**
 * Everything a search may look at for this note, folded into one string.
 *
 * See the header for the Art. 9 rule — it is the reason this is a function and
 * not a field list.
 */
function searchableText(note: Note): string {
  const wording = [note.slotSlug.replace(/_/g, ' '), note.asking ?? '', noteHeading(note)];
  if (note.sensitivity === SLOT_SENSITIVITY.special_category) return fold(wording.join('\n'));
  return fold([note.value, note.reasoningNote, ...wording].join('\n'));
}

function matchesSearch(note: Note, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = searchableText(note);
  return terms.every((term) => text.includes(term));
}

function matchesGroup(note: Note, group: string | undefined): boolean {
  if (group === undefined) return true;
  if (group === NOTES_OWN_GROUP) return note.group === null;
  return note.group === group;
}

/** Newest first; ties by slug so the order is total and two reads agree. */
function byRecency(a: Note, b: Note): number {
  return b.capturedAt.localeCompare(a.capturedAt) || a.slotSlug.localeCompare(b.slotSlug);
}

/**
 * The page a person asked for, from every note they may see.
 *
 * `notes` must already be free of hidden slots — `getNotes()` is the only
 * caller, and it is where that happens. The counts are taken from the whole
 * list before the search and the filter, so the filter's options and the
 * "12 of 57" stay put as someone narrows.
 *
 * Order: `recent` is freshest first across everything. `grouped` is by heading,
 * alphabetically, with Lelañea's own headings last, and freshest first inside
 * each — the order the page has always read in.
 */
export function queryNotes(notes: Note[], query: NotesQuery = {}): NotesView {
  const counts = new Map<string, number>();
  let own = 0;
  for (const note of notes) {
    if (note.group === null) own += 1;
    else counts.set(note.group, (counts.get(note.group) ?? 0) + 1);
  }
  const groups: NoteGroupCount[] = [...counts.entries()]
    .map(([key, count]) => ({ key, title: noteGroupTitle(key), count }))
    .sort((a, b) => a.title.localeCompare(b.title));

  const terms = query.q ? fold(query.q).split(/\s+/).filter(Boolean) : [];
  const kept = notes.filter(
    (note) => matchesGroup(note, query.group) && matchesSearch(note, terms)
  );

  const sort = query.sort ?? 'grouped';
  const rank = new Map(groups.map((group, index) => [group.key, index]));
  const ordered = [...kept].sort((a, b) => {
    if (sort === 'grouped') {
      const ra = a.group === null ? groups.length : (rank.get(a.group) ?? groups.length);
      const rb = b.group === null ? groups.length : (rank.get(b.group) ?? groups.length);
      if (ra !== rb) return ra - rb;
    }
    return byRecency(a, b);
  });

  return { notes: ordered, groups, own, total: notes.length, matched: ordered.length };
}

/** The page's controls, as they stand in the URL. */
export interface NotesParams {
  q: string;
  group: string | null;
  sort: NotesSort;
  view: NotesLayout;
}

export const NOTES_DEFAULTS: NotesParams = { q: '', group: null, sort: 'grouped', view: 'cards' };

/**
 * The URL's controls, read leniently.
 *
 * The server refuses a malformed query; the page does not refuse a malformed
 * URL. A hand-edited or stale link falls back to the default for whichever
 * control it got wrong and keeps the rest, because a person who followed a link
 * to their own notes should land on their notes, not on an error.
 */
export function readNotesParams(params: URLSearchParams): NotesParams {
  // Field by field, so one bad value costs that control and not the others.
  const field = <K extends keyof NotesQuery>(key: K): NotesQuery[K] | undefined => {
    const one = notesQuerySchema.safeParse({ [key]: params.get(key) ?? undefined });
    return one.success ? one.data[key] : undefined;
  };
  const view = z.enum(NOTES_LAYOUTS).safeParse(params.get('view'));
  return {
    q: field('q') ?? NOTES_DEFAULTS.q,
    group: field('group') ?? NOTES_DEFAULTS.group,
    sort: field('sort') ?? NOTES_DEFAULTS.sort,
    view: view.success ? view.data : NOTES_DEFAULTS.view,
  };
}

/**
 * The controls as a query string, with every default left out — so the plain
 * page is `/app/notes` and a link says only what someone actually chose.
 */
export function notesSearch(params: Partial<NotesParams>): string {
  const out = new URLSearchParams();
  const q = params.q?.trim();
  if (q) out.set('q', q);
  if (params.group) out.set('group', params.group);
  if (params.sort && params.sort !== NOTES_DEFAULTS.sort) out.set('sort', params.sort);
  if (params.view && params.view !== NOTES_DEFAULTS.view) out.set('view', params.view);
  const text = out.toString();
  return text ? `?${text}` : '';
}
