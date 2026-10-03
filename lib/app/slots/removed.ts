/**
 * What a note the person removed leaves behind (f-memory t-78; product
 * description §3.19).
 *
 * ## A placeholder, not a hole (owner ruling, 3 Oct 2026)
 *
 * Removing a note wipes every version of it **in place**: the words, the typed
 * value, the reasoning and the provenance go, and each row keeps its version
 * number with these values written over it. Two things depend on the rows
 * staying:
 *
 * - **The history count stays true.** The panel counts "N older readings" as
 *   `version - 1` (`notes.ts`), which only holds while no version is missing.
 * - **The next capture numbers correctly.** Daybreak's `appendSlotValue` numbers
 *   a new version from the current head, or `1` when there is none
 *   (`lib/framework/data-slots/values.ts`). A removed head that stopped being
 *   the head would make the next reading of the same slug a second version 1.
 *   So the placeholder **stays the head**, and the next reading supersedes it
 *   like any other.
 *
 * ## Why a placeholder head is safe for Daybreak's own readers
 *
 * A journey gate reads a head's **typed** value (`valueJson`) and never its
 * text (`facilitation/engine/conditions.ts`), and it compares scalars only. The
 * placeholder's typed value is {@link REMOVED_VALUE_JSON}, an object, which
 * matches no gate — so a removed note gates exactly as an unknown one does. Every reader that shows a head's **text** to the AI — `get_state`,
 * a module's context block — shows {@link REMOVED_VALUE}. That is the marker the
 * owner asked for: the AI learns something was removed, never what.
 *
 * Imports nothing, so the panel, the store and the context loaders can all read
 * it.
 *
 * @see lib/app/slots/delete-note.ts — the write
 * @see .context/app/slots.md — "Removing a note"
 */

/**
 * The `sourceType` a removed version carries. `sourceType` is a free-form
 * column (Daybreak's X1 convention), so a leaf value is a value Daybreak stores
 * without judging — and it is what every reader here keys on, rather than on the
 * text, so nobody can make a note read as removed by writing these words.
 */
export const REMOVED_SOURCE_TYPE = 'removed_by_person';

/**
 * The text a removed version holds, written for the AI: it is what `get_state`
 * and the module context print where the reading was. It says what happened and
 * how to behave, and nothing about what was there.
 */
export const REMOVED_VALUE =
  '[The person removed this note. Do not ask what it said, and do not note it again unless they raise it themselves.]';

/**
 * The typed value a removed version holds. An object rather than NULL because
 * `lib/app/**` may not import Prisma (`eslint.config.mjs`), and writing a
 * nullable Json column back to NULL takes `Prisma.DbNull`. An object does the
 * same job for every reader: a gate compares scalars only, so it matches no
 * condition, and it holds nothing of what was there.
 */
export const REMOVED_VALUE_JSON = { removed: true } as const;

/**
 * The reasoning line a removed version holds. The original was a paraphrase of
 * what was said, so it goes with the words.
 */
export const REMOVED_REASONING = 'The person removed this note in Lelañea’s notes.';

/**
 * The lowest confidence the scale has. Nothing reads a removed version's
 * confidence as evidence — its typed value is null — but a gate with a
 * `minConfidence` should have a second reason to refuse it.
 */
export const REMOVED_CONFIDENCE = 1;

/**
 * The prefix a removed note's slug takes when the AI made the heading up.
 *
 * A taxonomy slug is an admin's wording for a question, and it stays. But a
 * slug the AI coined in open mode is free text drawn from what the person said
 * (`validation.ts`) — `leaving_my_husband` — so keeping it would leave the
 * gist of the note on the head, where `get_state` and a module's context
 * print it beside the marker. Such a note's versions move together to
 * `removed_<random>`, which says nothing (`/code-review`, t-78).
 */
export const REMOVED_SLUG_PREFIX = 'removed_';

/** Whether a stored version is a placeholder the person left by removing a note. */
export function isRemoved(row: { sourceType: string }): boolean {
  return row.sourceType === REMOVED_SOURCE_TYPE;
}
