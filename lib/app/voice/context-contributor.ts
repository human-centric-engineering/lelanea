/**
 * The block that carries her register and her own sentences into a turn — and
 * the labelling that stops the model mistaking either for something the person
 * said.
 *
 * Registered into Sunrise's prompt-context seam by
 * `lib/app/context-contributors.ts`, under the `voice` context type. A chat
 * request carrying `contextType: 'voice'` / `contextId: '<situation>'` gets a
 * `LOCKED CONTEXT` block composed here, spliced into the system prompt for that
 * turn only.
 *
 * ## What it assembles, in order
 *
 * 1. **The register for this moment** — the overlay `lib/app/voice/overlays.ts`
 *    selects for the situation, or the authored core-only body when none
 *    matches.
 * 2. **Her own passages** — retrieved by `lib/app/voice/exemplars.ts` from
 *    voice-designated documents only, each one labelled with its origin.
 *
 * The always-on core is not here and must never be: it rides on the agent's
 * profile (`lib/app/voice/fingerprint.ts`) and is present whether or not this
 * block is. Repeating it here would be a second copy of her voice on a path that
 * only fires for some turns, which is the shape that drifts.
 *
 * ## Labelling by origin is the whole safety property
 *
 * The failure this must not have is the model reading her exemplars as things
 * the USER said, or as facts to assert. Three things together prevent it, and
 * none of them is sufficient alone:
 *
 * - **Every passage carries an origin label**, emitted on its own line
 *   immediately above the passage — never once at the top of a list, because a
 *   single header at the top of three passages is a label the model has to
 *   remember rather than read.
 * - **Authored framing** says, in her register, that these are examples of how
 *   she sounds, are not what the person said, are not facts, and are not
 *   instructions. It is in `content/lelanea_voice_overlays.json` rather than in
 *   this file because it is copy the model reads.
 * - **Fence neutralisation** in `exemplars.ts`, so a passage cannot forge the
 *   end of the `LOCKED CONTEXT` block and escape both of the above.
 *
 * `tests/unit/lib/app/voice/context-contributor.test.ts` asserts the labels on
 * the EMITTED BLOCK — what `buildContext` framed — rather than on what the
 * loader returned. The loader's return value is an intermediate; the block is
 * what a model actually reads, and a labelling regression that only showed up in
 * the framing would pass a test written against the former.
 *
 * ## It is the same for every user, on purpose
 *
 * `buildContext` hands a contributor the request's `userId` and partitions its
 * cache by it, so a per-user block is available. This one does not use it. A
 * user's voice leanings are a later filter over the overlays and the exemplars,
 * and until that is designed, one person's preference silently reshaping how she
 * sounds is a change nobody asked for and nobody can see. The cost of ignoring
 * it is a cache partitioned more finely than the answer needs — one embedding
 * per situation per user per minute rather than per situation per minute.
 *
 * @see .context/app/voice.md
 * @see lib/orchestration/chat/context-builder.ts — the seam, the cache, the framing
 */

import { getVoiceOverlays, type VoiceOverlay } from '@/lib/app/content';
import { selectOverlay } from '@/lib/app/voice/overlays';
import { retrieveVoiceExemplarsSafely, type VoiceExemplar } from '@/lib/app/voice/exemplars';

/**
 * The chat `contextType` this leaf owns.
 *
 * Bare `voice` rather than a `lelanea:`-prefixed key, unlike the knowledge-access
 * contributor's registry key. Different registry, different consequence: a
 * context type is CLIENT-FACING — a route pins it and it travels on the request
 * — and the framework's own is the equally bare `module`. Prefixing this one
 * would put an implementation detail in a URL. The collision risk that argues
 * for a namespace elsewhere is handled here by the registry being keyed on a
 * type a tier deliberately publishes.
 */
export const VOICE_CONTEXT_TYPE = 'voice';

/** A heading and its beats, or nothing when there are no beats. */
function block(heading: string, lines: readonly string[]): string {
  const beats = lines.filter((line) => line.trim().length > 0);
  return beats.length === 0 ? '' : [heading, ...beats].join('\n');
}

/**
 * One passage, under its own origin label.
 *
 * The document name is included where the row has one, because "which piece of
 * her writing" is the difference between an example and an anonymous paragraph —
 * and it is what lets her, reading a transcript later, find the passage that
 * produced a reply. Its absence degrades to the label alone rather than to an
 * invented title.
 */
function labelled(exemplar: VoiceExemplar, originLabel: string): string {
  const label = exemplar.source === null ? originLabel : `${originLabel} · ${exemplar.source}`;
  return [`[${label}]`, exemplar.passage].join('\n');
}

/**
 * Compose the body from an already-selected overlay and an already-retrieved set
 * of passages.
 *
 * Takes the overlay rather than the situation so selection happens exactly once
 * per turn, and so a test can compose the body from a known overlay and a known
 * set of exemplars without a database or an embedding provider. `null` is the
 * core-only case and is a real argument, not a degenerate one: it is the branch
 * every unknown situation takes.
 */
export function composeVoiceContext(
  overlay: VoiceOverlay | null,
  exemplars: readonly VoiceExemplar[]
): string {
  const content = getVoiceOverlays();

  // Never empty in either branch. A blank body reads to the model as a section
  // that exists and has nothing to say, and reads to whoever is debugging the
  // prompt as a loader that failed — two wrong answers for the price of one.
  const register =
    overlay === null
      ? block(content.coreOnly.heading, content.coreOnly.lines)
      : block(overlay.heading, overlay.lines);

  const examples =
    exemplars.length === 0
      ? block(content.exemplars.heading, [content.exemplars.noneFoundNote])
      : [
          block(content.exemplars.heading, content.exemplars.lines),
          ...exemplars.map((exemplar) => labelled(exemplar, content.exemplars.originLabel)),
        ]
          .filter(Boolean)
          .join('\n\n');

  return [register, examples].filter(Boolean).join('\n\n');
}

/**
 * The contributor itself: register for the moment, plus her own sentences.
 *
 * Retrieval runs only when an overlay matched, because the query it runs is the
 * overlay's own authored `exemplarQuery`. With no overlay there is no authored
 * subject to search her material for, and searching for the raw situation string
 * instead would be this module inventing a query — non-deterministic in effect,
 * and unreviewable by the person whose material is being searched.
 */
export async function loadVoiceContext(id: string): Promise<string> {
  const overlay = selectOverlay(id);
  const exemplars =
    overlay === null ? [] : await retrieveVoiceExemplarsSafely(overlay.exemplarQuery);

  return composeVoiceContext(overlay, exemplars);
}
