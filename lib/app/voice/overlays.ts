/**
 * Which register the moment calls for — the fingerprint's second layer.
 *
 * The core (`lib/app/voice/fingerprint.ts`) makes her sound consistent. It
 * cannot make her sound *specific*: the register of a first hello and the
 * register of someone in grief are not the same register, and a core that tried
 * to hold both would have to say something vague enough to cover them, which is
 * how a voice stops being a voice.
 *
 * So an overlay is a small set of beats that SHADE the core for one situation.
 * It never softens the core and it never restates it — anything true of every
 * turn belongs in the core file, and a line that appeared in both would be a
 * second copy of her voice with nothing keeping the two in step.
 *
 * ## Selection is a lookup, deliberately
 *
 * The situation arrives as a chat request's `contextId` — a string a route pins
 * server-side — and selection is an exact match on it after trimming and
 * lower-casing. No fuzzy matching, no nearest-neighbour, no "closest overlay":
 * the register a person meets must not depend on a similarity score, and the
 * same situation must produce the same overlay on every turn, in every
 * environment, forever. Deterministic is the requirement, not an optimisation.
 *
 * An unknown situation selects NOTHING and the contributor falls back to
 * core-only. That is the safe direction — the core is the invariant, so falling
 * back to it can only ever under-shade — and it is also why the fallback emits
 * an explicit authored body rather than an empty string: a blank block is
 * indistinguishable from a broken loader, both to the model and to whoever is
 * reading the prompt trying to work out what happened.
 *
 * ## The vocabulary lives in the rows
 *
 * `app_voice_overlay` holds the situations, and this module reads them through
 * `getVoiceOverlays()` (t-88 — until then they came from a bundled file).
 * Adding a fifth situation is a row, and nothing else. There is no TypeScript
 * list of situation keys here to fall out of step with the table, and no
 * string literal of her words anywhere in this module — the same rule the
 * content seam and its ESLint boundary exist to hold.
 *
 * **Selection is still an exact match and nothing else.** The read is now a
 * database read, so these functions are async; what they do with what comes
 * back is unchanged. Nothing here looks anything up by similarity.
 *
 * @see .context/app/voice.md
 * @see lib/app/voice/context-contributor.ts — what composes the block
 */

import { getVoiceOverlays } from '@/lib/app/content/voice-overlay-store';
import type { VoiceOverlay, VoiceOverlays } from '@/lib/app/content';

/**
 * Normalise a situation key as it arrived over the wire.
 *
 * Trim and lower-case, and nothing else. `contextId` is client-supplied on the
 * admin chat path (`z.string().max(100)`), so it can carry stray whitespace or
 * a capital from a hand-typed URL; neither should decide which register a person
 * meets. Everything beyond that — punctuation, an unknown key, an empty string —
 * is left to fail the lookup and fall back, because a normaliser that tried to
 * *repair* a key would be the fuzzy matching this module exists not to do.
 */
export function normaliseSituation(situation: string): string {
  return situation.trim().toLowerCase();
}

/**
 * The overlay for this situation in an already-read set, or `null` when none
 * matches.
 *
 * `null` rather than a default overlay: "no overlay" and "the overlay that
 * happens to be first" are different facts, and the caller has to be able to say
 * which one it is looking at. Returning a default here would make the core-only
 * fallback unreachable and the assertion that proves it fires meaningless.
 */
export function selectOverlayFrom(content: VoiceOverlays, situation: string): VoiceOverlay | null {
  const key = normaliseSituation(situation);
  if (key === '') return null;
  return content.overlays.find((overlay) => overlay.situation === key) ?? null;
}

/**
 * The same selection, reading the set itself.
 *
 * For a caller that wants one overlay and nothing else. A caller that also
 * needs the set's other blocks — `context-contributor.ts` needs `coreOnly` and
 * `exemplars` on the same turn — reads once and uses
 * {@link selectOverlayFrom}, rather than paying for a second read of the same
 * rows.
 */
export async function selectOverlay(situation: string): Promise<VoiceOverlay | null> {
  // Before the read, not after: an empty key matches nothing, and asking the
  // database to confirm that is a query every core-only turn would pay for.
  if (normaliseSituation(situation) === '') return null;
  return selectOverlayFrom(await getVoiceOverlays(), situation);
}

/**
 * Every situation this build knows how to shade, in authored order.
 *
 * Exported for the surfaces that have to name them — a route pinning a
 * `contextId`, her review path in t-28, a test asserting the file and the
 * selector agree — so none of them grows its own copy of the vocabulary.
 */
export async function knownSituations(): Promise<string[]> {
  const { overlays } = await getVoiceOverlays();
  return overlays.map((overlay) => overlay.situation);
}
