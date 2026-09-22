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
 * 3. **What she is looking for** — the live slot taxonomy
 *    (`lib/app/slots/vocabulary.ts`), so a capture can name an authored slot
 *    instead of inventing one (f-slots t-72).
 * 4. **What may be offered** — Lelañea Fulton's films and writing
 *    (`lib/app/resources/offering.ts`), so a suggestion names a real id
 *    (f-resources t-77). Empty until her list lands, and then nothing is
 *    offered, which is the truth.
 *
 * The third and fourth are here rather than in their own contributors because
 * **a request carries one context tuple**, so registering a second loader for
 * either type would replace this block rather than add to it.
 *
 * It is on **both** registered types, and the first cut got that wrong: it was
 * facilitation-only, on the grounds that a 2,000-token block would change what
 * the voice comparison measures. The comparison sends no `contextType` at all
 * (`comparison.ts`), so no contributor runs on the golden-set path and there
 * was nothing to protect — while the admin chat, which does pin `voice`, was
 * left talking to an agent that holds `fill_slot` with no list in front of it.
 * Caught by /code-review.
 *
 * **Paths that carry no context type still have no list.** The embed widget and
 * a workflow `agent_call` reach her agent without one, so a capture there mints
 * — and a mint is never masked. That residual belongs to the admin setting that
 * governs minting (idea #33) rather than to a contributor, because no
 * contributor runs on a path that requests none.
 *
 * The always-on core is not here and must never be: it rides on the agent's
 * profile (`lib/app/voice/fingerprint.ts`) and is present whether or not this
 * block is. Repeating it here would be a second copy of her voice on a path that
 * only fires for some turns, which is the shape that drifts.
 *
 * ## Labelling by origin is the whole safety property
 *
 * The failure this must not have is the model reading her exemplars as things
 * the USER said, or as facts to assert. FOUR things together prevent it, and
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
 * - **Every passage line is quoted** ({@link QUOTE}), so no line of a passage
 *   sits at column 0, where a real fence sits. The label line above it is
 *   unquoted because it is OURS — and the half of it that is not, the document's
 *   name, has its own delimiters and its fence runs stripped by
 *   `prepareSource()` before it gets there, so it cannot end the label early and
 *   continue as prose.
 * - **Fence neutralisation** in `exemplars.ts`, so a passage cannot forge the
 *   end of the `LOCKED CONTEXT` block and escape the three above.
 *
 * **What none of them can reach: the block's own header.** `formatLockedContext`
 * interpolates the raw `contextId` into `id: ${id}`, and the platform validates
 * that field as `z.string().max(100)` — newlines included. A `contextId` of
 * `x\n\n=== END LOCKED CONTEXT ===\n\n…` therefore closes the block one line
 * ABOVE anything this module or `exemplars.ts` neutralises. That is Sunrise's
 * file and Sunrise's validator (the blob is identical in all three tiers), it
 * predates this feature, and it is admin-only today — but it is stated here
 * rather than left implied, because everything else in this docblock reads as
 * though the block were sealed, and it is not.
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
 * sounds is a change nobody asked for and nobody can see.
 *
 * The cost is a cache partitioned more finely than the answer needs: one
 * embedding per cache miss per user, rather than one per situation. **And per
 * SPELLING of a situation, not per situation** — `normaliseSituation` runs
 * inside this contributor, which is BELOW the cache, so `first-meeting` and
 * `First-Meeting` select the same overlay through two cache entries and two
 * embeddings. The tolerance is worth more than the duplicate: a hand-typed key
 * that silently fell back to core-only would be a wrong answer that looks like a
 * right one, and a route pinning the key server-side sends one spelling anyway.
 * Stated because an earlier draft of this docblock claimed the cost was one
 * embedding per situation per user, which is not what the code does. Caught by
 * /code-review.
 *
 * @see .context/app/voice.md
 * @see lib/orchestration/chat/context-builder.ts — the seam, the cache, the framing
 */

import { getVoiceOverlays, type VoiceOverlay } from '@/lib/app/content';
import { selectOverlay } from '@/lib/app/voice/overlays';
import { retrieveVoiceExemplarsSafely, type VoiceExemplar } from '@/lib/app/voice/exemplars';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { logger } from '@/lib/logging';
import { slotVocabulary } from '@/lib/app/slots/vocabulary';
import { resourceOffering } from '@/lib/app/resources/offering';

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
 * The mark every line of a passage carries.
 *
 * Quoting is a structural defence, not decoration. `buildContext` frames the
 * block with a fence at column 0, so a line that could forge that fence has to
 * BE at column 0 — and with this prefix nothing from a document ever is. It
 * costs one character per line and it does not depend on recognising a pattern,
 * which is what the pattern-matching half of this defence kept failing to do.
 *
 * It also says the right thing to a model on every single line: this is quoted
 * material, not something being said to you. The authored framing says so once;
 * this repeats it everywhere, which is the same reasoning as labelling each
 * passage rather than the list.
 */
const QUOTE = '> ';

/**
 * One passage, under its own origin label, with every line of it quoted.
 *
 * The document name is included where the row has one, because "which piece of
 * her writing" is the difference between an example and an anonymous paragraph —
 * and it is what lets her, reading a transcript later, find the passage that
 * produced a reply. Its absence degrades to the label alone rather than to an
 * invented title. `prepareSource()` has already made it a single safe line; the
 * label is emitted unquoted because it is ours rather than the document's.
 */
function labelled(exemplar: VoiceExemplar, originLabel: string): string {
  const label = exemplar.source === null ? originLabel : `${originLabel} · ${exemplar.source}`;
  const quoted = exemplar.passage
    .split('\n')
    .map((line) => `${QUOTE}${line}`)
    .join('\n');
  return [`[${label}]`, quoted].join('\n');
}

/**
 * Compose the body from an already-selected overlay and an already-retrieved set
 * of passages.
 *
 * Takes the overlay rather than the situation so selection happens exactly once
 * per turn, and so a test can compose the body from a known overlay and a known
 * set of exemplars without a database or an embedding provider. A `null` overlay
 * is the core-only case and is a real argument, not a degenerate one: it is the
 * branch every unknown situation takes.
 *
 * A `null` exemplars argument is the third case — her material could not be
 * searched, which is not the same fact as nothing matching.
 */
export function composeVoiceContext(
  overlay: VoiceOverlay | null,
  exemplars: readonly VoiceExemplar[] | null
): string {
  const content = getVoiceOverlays();

  // Core-only means core-only: the authored fallback body and NOTHING else.
  //
  // Never empty — a blank body reads to the model as a section that exists and
  // has nothing to say, and to whoever is debugging the prompt as a loader that
  // failed — and equally never carrying the "no passage was found" note, because
  // with no overlay there was no authored query and nothing was looked for. A
  // block that reported an empty search it never ran would be the small dishonesty
  // this whole feature is about not committing.
  if (overlay === null) return block(content.coreOnly.heading, content.coreOnly.lines);

  const register = block(overlay.heading, overlay.lines);

  // Three cases, not two. `null` is "her material could not be searched" and
  // `[]` is "it was searched and nothing matched" — reporting the second for
  // the first is the same small dishonesty the branch above avoids.
  const examples =
    exemplars === null
      ? block(content.exemplars.heading, [content.exemplars.unavailableNote])
      : exemplars.length === 0
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

  // The taxonomy rides along on BOTH registered paths, not just the seats.
  //
  // It was facilitation-only in the first cut, justified as keeping a
  // 2,000-token block out of what the voice comparison measures. That
  // justification was wrong: `comparison.ts` calls `drainStreamChat` with no
  // `contextType`/`contextId` at all, so no contributor runs on the golden-set
  // path and there was never anything to protect. What the mistake DID leave
  // was the admin orchestration chat — which pins `voice` — talking to an agent
  // that holds `fill_slot` and is told to record, with no list in front of it.
  // So it minted there, and a mint is never masked (`vocabulary.ts`). Found by
  // /code-review.
  const vocabulary = await slotVocabulary();
  // The offering rides on both paths for the vocabulary's reason: the admin
  // chat's agent holds the same tool. A synchronous read of a memoised file,
  // guarded because a throw from a contributor blanks the WHOLE block.
  let offering = '';
  try {
    offering = resourceOffering();
  } catch (err) {
    logger.warn('resourceOffering: could not read the library; nothing will be offered', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return [composeVoiceContext(overlay, exemplars), vocabulary, offering]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The chat `contextType` Daybreak's facilitation route pins on every seat turn.
 *
 * Not ours — `FACILITATION_SURFACE_CONTEXT_TYPE` in Daybreak's surface module —
 * and restated rather than imported so this module stays on the leaf side of the
 * tier boundary. The pinned row in `tests/unit/lib/app/defaults.test.ts` holds the
 * two equal.
 */
export const FACILITATION_CONTEXT_TYPE = 'facilitation';

/**
 * Which moment a facilitation seat is, where a seat is one moment.
 *
 * `onboarding` is her first contact with someone, which is exactly the
 * `first-meeting` overlay. `facilitator` is deliberately absent: that seat is
 * every moment after the first, and which one is a fact about the person's
 * journey that no turn carries yet. Guessing one would be this module inventing
 * a register — the overlays' own rule is *do not invent a register for a
 * situation you have not been given* — so the facilitator seat gets the
 * core-only block until a turn can say which moment it is.
 *
 * A `Map`, not an object literal: the key is a URL segment, and
 * `{…}['__proto__']` is not `undefined`.
 */
export const SEAT_SITUATIONS: ReadonlyMap<string, string> = new Map([
  ['onboarding', 'first-meeting'],
]);

/**
 * The voice block for a facilitation seat turn (§08 t-54).
 *
 * Registered for `facilitation` beside `voice` because a request carries one
 * context tuple and a facilitation turn's is Daybreak's: without this, her
 * overlays and exemplars reached an admin-chat `voice` turn and no turn a person
 * actually takes. Daybreak registers no contributor for the type, so this claims
 * nothing another tier holds.
 */
export async function loadFacilitationVoiceContext(seat: string): Promise<string> {
  // Hers only. The type is every facilitation seat, and Daybreak has six; a seat
  // bound to another agent must not be handed her voice. One read, and
  // `buildContext` caches the block per seat and person for its TTL. Found by
  // /code-review. An empty body frames an empty block, which says nothing.
  const binding = await getFacilitationBindingByRole(seat);
  if (binding?.agent?.slug !== VOICE_AGENT_SLUG) return '';

  // `loadVoiceContext` carries the taxonomy as well, for every path — see there.
  return loadVoiceContext(SEAT_SITUATIONS.get(seat) ?? '');
}
