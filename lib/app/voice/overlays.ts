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
 * ## The vocabulary lives in the authored file
 *
 * `content/lelanea_voice_overlays.json` holds the situations, and this module
 * reads them through `getVoiceOverlays()`. Adding a fifth situation is an edit
 * to that file and nothing else. There is no TypeScript list of situation keys
 * here to fall out of step with it, and no string literal of her words anywhere
 * in this module — the same rule the content seam and its ESLint boundary exist
 * to hold.
 *
 * Nothing here reads a database or looks anything up, transitively included:
 * the only import is the content accessor, which parses a bundled JSON file.
 *
 * @see .context/app/voice.md
 * @see lib/app/voice/context-contributor.ts — what composes the block
 */

import { getVoiceOverlays, type VoiceOverlay } from '@/lib/app/content';

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
 * The overlay for this situation, or `null` when none matches.
 *
 * `null` rather than a default overlay: "no overlay" and "the overlay that
 * happens to be first" are different facts, and the caller has to be able to say
 * which one it is looking at. Returning a default here would make the core-only
 * fallback unreachable and the assertion that proves it fires meaningless.
 */
export function selectOverlay(situation: string): VoiceOverlay | null {
  const key = normaliseSituation(situation);
  if (key === '') return null;
  return getVoiceOverlays().overlays.find((overlay) => overlay.situation === key) ?? null;
}

/**
 * Every situation this build knows how to shade, in authored order.
 *
 * Exported for the surfaces that have to name them — a route pinning a
 * `contextId`, her review path in t-28, a test asserting the file and the
 * selector agree — so none of them grows its own copy of the vocabulary.
 */
export function knownSituations(): string[] {
  return getVoiceOverlays().overlays.map((overlay) => overlay.situation);
}
