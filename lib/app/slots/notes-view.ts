/**
 * The wire contract for Lelañea's notes — what a member reads back about
 * themselves, free of Prisma (f-slots t-73).
 *
 * Its own module, not the store's, for the reason Daybreak states at
 * `lib/framework/data-slots/view.ts`: the panel is a client component, and the
 * store imports `@/lib/db/client`, which drags `pg` into any bundle that
 * reaches it. A shape both ends can import has to live somewhere neither end's
 * dependencies reach. Dates are ISO **strings** here, never `Date` — a fetched
 * row is JSON, and typing them as the Prisma model would be a lie the browser
 * cannot honour.
 *
 * ## What a note is, and what it is not
 *
 * A note is one **head** slot value: the current version of one reading, with
 * the version before it where there is one. It is deliberately not the whole
 * chain — §3.12 asks for the previous answer beside the new one as an
 * invitation to revisit, not for a changelog.
 *
 * @see lib/app/slots/notes.ts — the read and the correction
 * @see .context/app/slots.md — "Her notes"
 */

/**
 * The capability whose answering call means a turn wrote a note.
 *
 * It lives in this module, of all places, because this module imports nothing:
 * `use-conversation.ts` is a client hook and needs the slug to know when to
 * refresh the panel, and the two other places that hold it —
 * `lib/app/agent/pins.ts` and `lib/app/capabilities.ts` — pull the 53-slot
 * taxonomy JSON and the Prisma client in behind them. `pins.ts` builds its
 * `SELF_WRITE_CAPABILITY_SLUGS` from this constant, so there is one spelling
 * and the compiler holds the two together.
 */
export const SLOT_WRITE_CAPABILITY = 'fill_slot';

/**
 * How a reading was made, in plain words rather than the stored classifier.
 *
 * ## Two rules of register, both owner corrections (21 September 2026)
 *
 * **Lelañea is named, never pronouned.** Every line says *Lelañea*, not *she*
 * or *her*. The persona is hers and the product uses it, but a panel that calls
 * her "she" throughout starts to read as though somebody else were describing
 * her to you — and this is the one surface where the reader needs to know
 * exactly who is making each claim. (The admin surfaces have the opposite rule
 * and the opposite reason: there she is "the AI", because an operator is
 * looking at configuration.)
 *
 * **And the reader is "you", never "they".** These lines are read by the person
 * they are about. The taxonomy's own `description` is third-person because its
 * audience is a model, which is why the card shows it as a quotation inside the
 * disclosure rather than as the panel speaking.
 *
 * Each value stands alone as a **capitalised fragment**: the card's meta line
 * joins three of them with `·`, so lower-case openings read as one sentence
 * broken into pieces rather than as three separate facts.
 */
export const NOTE_SOURCES: Readonly<Record<string, string>> = {
  direct: 'You told Lelañea directly',
  unprompted: 'You brought it up yourself',
  emerged_naturally: 'It came up in passing',
  built_across_turns: 'Lelañea put it together over several things you said',
  inferred: 'Lelañea inferred it',
  user_confirmed: 'You corrected this yourself',
  synthesised: 'Lelañea drew it together from other things already noted',
};

/**
 * The stored `sourceType` in words, or the stored value itself when it is one
 * this build does not know.
 *
 * Falling through to the raw string rather than to "unknown": `sourceType` is a
 * free-form column (the framework's X1 convention), so a value added upstream
 * arrives here before this table does — and `built_across_turns` read raw is
 * still more honest to a member than a shrug.
 */
export function noteSourceWords(sourceType: string): string {
  const known = NOTE_SOURCES[sourceType];
  if (known) return known;
  // Capitalised like the rest, so an unrecognised classifier still reads as a
  // fragment of the meta line rather than as the one lower-case thing on it.
  const words = sourceType.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A version of a note that is no longer the current one. */
export interface NoteHistory {
  version: number;
  /** Withheld the same way the head is — see {@link Note.withheld}. */
  value: string;
  withheld: boolean;
  sourceType: string;
  confidence: number;
  capturedAt: string;
}

/** One reading she is currently holding about the person asking. */
export interface Note {
  slotSlug: string;
  /**
   * What she was looking for, in the taxonomy's own words — the definition's
   * `description`. `null` for a slug she invented, which has no definition and
   * so has nothing to be measured against.
   */
  asking: string | null;
  /** The plain-language reading. A sentinel when `withheld`. */
  value: string;
  /**
   * The words were never stored. True for a `special_category` slot, where
   * masking-before-storage replaces the prose with a sentinel at capture
   * (`lib/framework/data-slots/capabilities/masking.ts`) — so what the app holds
   * really is only the fact that something was noted. The panel says that in a
   * sentence rather than showing `<redacted: special_category>`.
   */
  withheld: boolean;
  /** 1–10, as she judged it. */
  confidence: number;
  /** The stored classifier; {@link noteSourceWords} turns it into a sentence. */
  sourceType: string;
  /** Her one line on how the reading was made. */
  reasoningNote: string;
  version: number;
  capturedAt: string;
  /** The conversation it was drawn from, where the capture recorded one. */
  conversationId: string | null;
  /** The definition's sensitivity, or `standard` for an invented slug. */
  sensitivity: string;
  /** The slot was retired: she is no longer asking about this. */
  retired: boolean;
  /**
   * Whether this note can be corrected in place. False for a retired slot and
   * for a withheld one — see `.context/app/slots.md`, "Why a withheld note
   * cannot be corrected". A note that cannot be corrected can still be taken
   * back to her.
   */
  correctable: boolean;
  /** The version before this one, where there is one. */
  previous: NoteHistory | null;
  /**
   * The taxonomy group it is filed under — `life_areas` — or `null` for a
   * heading Lelañea made up, which has no definition and so no group.
   *
   * Carried on the note since t-79 flattened the response: the panel groups by
   * this, and the `recent` sort labels each note with it.
   */
  group: string | null;
}

/**
 * A group that has notes in it, with how many — the options the panel's filter
 * offers.
 *
 * Counted **before** the search and the filter are applied, so narrowing never
 * makes an option vanish from under the reader: a group with no match still has
 * notes, and picking it is still a thing someone can mean.
 */
export interface NoteGroupCount {
  /** The stored group key — `life_areas`. */
  key: string;
  /** The key as a heading: `life_areas` → `Life areas`. */
  title: string;
  count: number;
}

/**
 * The `group` value that asks for Lelañea's own headings.
 *
 * It cannot collide with a real group: group keys are slugs, and a slug starts
 * with a letter (`slotSlugSchema`). It is a **query** value only — on a note the
 * same fact is `group: null`, so no stored or returned key is ever compared
 * against it.
 */
export const NOTES_OWN_GROUP = '_own';

/** The heading Lelañea's own headings are filed under. One spelling, both views. */
export const NOTES_OWN_TITLE = 'Lelañea’s own headings';

/**
 * `grouped` is by taxonomy group, freshest first within each, and is the
 * default. `recent` is one list across every group, freshest first — "the last
 * five things noted".
 */
export const NOTES_SORTS = ['grouped', 'recent'] as const;
export type NotesSort = (typeof NOTES_SORTS)[number];

/** How the page draws one response. Never sent to the server. */
export const NOTES_LAYOUTS = ['cards', 'list'] as const;
export type NotesLayout = (typeof NOTES_LAYOUTS)[number];

/** Longest search the route accepts. The input carries the same cap. */
export const NOTES_SEARCH_MAX = 200;

/**
 * `GET /api/v1/app/notes`.
 *
 * ## Flat, since t-79
 *
 * It was `{ groups: [{ key, title, notes }], improvised, total }`, and the
 * panel was its only reader. A `recent` sort has no groups to put notes in, so
 * the list is flat and each note carries its `group`; the panel groups
 * consecutive runs when the sort is `grouped`. One shape rather than a grouped
 * variant kept beside a flat one — two shapes would be two readers to keep in
 * step.
 *
 * `notes` is already in display order for the sort asked for.
 */
export interface NotesView {
  /** The notes that match, in the order they are to be read. */
  notes: Note[];
  /** Taxonomy groups with notes in them, before filtering. Ordered by title. */
  groups: NoteGroupCount[];
  /** How many notes are under Lelañea's own headings, before filtering. */
  own: number;
  /** Every note, however filed and whatever the filter — so "a new account" is one test. */
  total: number;
  /** How many of those the search and the group filter kept. */
  matched: number;
}

/** `life_areas` → `Life areas`. The convention the admin browser already uses. */
export function noteGroupTitle(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
