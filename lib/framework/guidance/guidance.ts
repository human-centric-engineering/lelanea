/**
 * Guidance service (f-guidance t-1, spec §5.4) — the orchestration face the capability family
 * (t-2/t-3) consumes. It composes the impure assembler (`assemble.ts`) with the pure engine
 * (`computeAvailability`) and the pure ranking/synopsis cores, so a capability is a thin wrapper
 * over one of these calls. No capabilities here yet (t-2/t-3); no LLM ever (guidance is
 * deterministic — agents narrate its outputs).
 *
 * Every entry point returns `null` for "nothing to guide" (no published map / journey not
 * started) and propagates `ForbiddenError` from the `canRead`-guarded reads — the capability
 * turns those into a structured result. `applyJourneyTransition` additionally ORIGINATES a
 * `ForbiddenError` from its own `canWrite` guard, before any read runs (#242).
 */

import { canWrite, type JourneyViewer, type AccessScope } from '@/lib/framework/shared/access';
import { ForbiddenError } from '@/lib/api/errors';
import type { JourneyKey } from '@/lib/framework/facilitation/journey/queries';
import {
  computeAvailability,
  type AvailabilityResult,
} from '@/lib/framework/facilitation/engine/availability';
import {
  applyEvent,
  type ApplyEventResult,
  type TransitionKind,
} from '@/lib/framework/facilitation/engine/apply-event';
import { getJourneyTimeline } from '@/lib/framework/facilitation/journey/queries';
import { getPublishedMapVersion } from '@/lib/framework/facilitation/map/version-service';
import { enrichMovesWithRelated } from '@/lib/framework/facilitation/overlays/related';
import { maybeEmitModuleCompleted } from '@/lib/framework/engagement/module-completion';
import { assembleJourneyContext, type JourneyContext } from '@/lib/framework/guidance/assemble';
import {
  rankMoves,
  suggestFocus,
  type RankedMove,
  type FocusSuggestion,
} from '@/lib/framework/guidance/ranking';
import {
  buildProgressSynopsis,
  type ProgressSynopsis,
  type BuildSynopsisOptions,
} from '@/lib/framework/guidance/synopsis';

/** The full guidance picture for one journey: engine eligibility + ranked advice. */
export interface Guidance {
  context: JourneyContext;
  availability: AvailabilityResult;
  /** The engine's `validMoves`, ranked wisest-first with reasons (F12). */
  moves: readonly RankedMove[];
}

/**
 * Load the full guidance picture: assemble the inputs, compute availability (the engine's
 * "what is possible"), and rank the eligible moves ("what is wise"). `null` when there is
 * nothing to guide.
 */
export async function loadGuidance(
  viewer: JourneyViewer,
  key: JourneyKey,
  scope?: AccessScope
): Promise<Guidance | null> {
  const context = await assembleJourneyContext(viewer, key, scope);
  if (context === null) return null;

  const availability = computeAvailability(context.availabilityInput);
  const ranked = rankMoves({
    graph: context.availabilityInput.graph,
    availability,
    slotHeads: context.slotHeads,
    now: context.now.instant,
  });

  // Advisory "related places" overlay (f-overlays, F9): fill each move's `related` slot from node
  // similarity, STRICTLY downstream of the (already-computed) availability — it decorates moves and
  // never feeds eligibility. Keyed on the current published version; empty when nothing is embedded.
  // (The version is re-read here rather than threaded from `assemble`; a republish+re-embed landing
  // between the two reads could key `related` to the newer version — harmless, since `related` is
  // advisory and a nodeKey absent from the narrated graph is simply not surfaced.)
  const version = await getPublishedMapVersion(key.graphSlug);
  const moves =
    version === null ? ranked : await enrichMovesWithRelated(key.graphSlug, version, ranked);

  return { context, availability, moves };
}

/** The linger-vs-move recommendation over the ranked moves, or `null` when nothing to guide. */
export async function loadFocusSuggestion(
  viewer: JourneyViewer,
  key: JourneyKey,
  scope?: AccessScope
): Promise<FocusSuggestion | null> {
  const guidance = await loadGuidance(viewer, key, scope);
  if (guidance === null) return null;
  return suggestFocus(guidance.moves);
}

/**
 * The deterministic progress digest for one journey (node-state projection + timeline), or
 * `null` when the journey has not started. Assembles the journey context (for the node states)
 * and reads the `canRead`-guarded timeline.
 */
export async function loadProgressSynopsis(
  viewer: JourneyViewer,
  key: JourneyKey,
  scope?: AccessScope,
  options?: BuildSynopsisOptions
): Promise<ProgressSynopsis | null> {
  const context = await assembleJourneyContext(viewer, key, scope);
  if (context === null) return null;

  const timeline = await getJourneyTimeline(
    viewer,
    { journeyId: context.journey.id, subject: key.userId },
    { order: 'desc' },
    scope
  );
  return buildProgressSynopsis(context.nodeStates, timeline, options);
}

/** The transition a caller asks the engine to make. */
export interface TransitionRequest {
  nodeKey: string;
  kind: TransitionKind;
}

/**
 * Ask the engine to apply a journey transition (the sole write path for journey
 * *lifecycle* state). Assembles the same read context and hands it to `applyEvent`, which
 * validates the move and — on success — writes the event + projection in one transaction,
 * or returns a `Rejection` (with the node's lock reasons) that never touches the DB.
 * `null` when the journey has not started (nothing to transition).
 *
 * ## Two guards, deliberately (#242)
 *
 * This needs **both**, because it genuinely does both things:
 *
 * - the **read** is `canRead`, applied by {@link assembleJourneyContext} — the transition
 *   cannot be validated without loading the graph, node states and slots for the subject;
 * - the **write** is {@link canWrite}, applied here.
 *
 * Until #242 the write borrowed the read's authorization, which was fine only by
 * coincidence: `canRead` is documented as delegating to Sunrise #367's ownership resolver
 * once it lands, widening `own → team → all`. That widening is about *reading* a cohort.
 * The day it is wired, every viewer who could merely read a cohort's journeys would have
 * silently gained the right to drive state transitions for those subjects — writing
 * `UserNodeState` projections and appending `JourneyEvent` rows on their behalf, with no
 * diff to this file and no test in the suite failing. `canWrite` pins the write grant to
 * self-or-admin-support, so widening it becomes a visible edit to `shared/access.ts`.
 *
 * **This changes nothing today.** The two predicates are value-identical until #367 lands,
 * so no caller's behaviour moves; the point is that the widening can no longer reach here
 * by omission. That is also why the test for it is structural rather than behavioural —
 * no input can distinguish the two.
 *
 * **The guard runs BEFORE the assembler**, which is not where the issue proposed it ("an
 * explicit `canWrite` check on the write half, before `applyEvent` is called"). Placing it
 * after would let a viewer who may not write still trigger six reads — the published
 * graph, the journey, node states, slot heads, `now` and the module list — before being
 * refused. Nothing is lost by checking first: `canWrite` *composes* `canRead`, so anything
 * it admits the assembler would admit too. This also matches the sibling write seams
 * (`createJourney`, `recordNodeProgress`), which both refuse before touching the database.
 *
 * **A cost that arrives with #367, recorded now so it is a decision and not a
 * surprise.** An accepted transition evaluates `canRead` three times: once inside
 * `canWrite` here, then again in `getJourney` and `getNodeStates` inside the assembler.
 * That is free today — the predicate is two string comparisons. Once #367 makes it an
 * async, DB-backed resolver it is three round-trips per write, two of them inside the
 * assembler's `Promise.all`. The fix then is to thread the decision through the assembler
 * rather than to drop this guard; dropping it is what reopens the widening hole. Whoever
 * wires #367 should read the `canWrite` note in `shared/access.ts` first — the
 * upstream-asks ledger row for #367 says so too.
 *
 * @throws {ForbiddenError} when `viewer` may not write for `key.userId`.
 */
export async function applyJourneyTransition(
  viewer: JourneyViewer,
  key: JourneyKey,
  move: TransitionRequest,
  scope?: AccessScope
): Promise<ApplyEventResult | null> {
  if (!(await canWrite(viewer, key.userId, scope))) {
    throw new ForbiddenError('Not permitted to transition this journey');
  }

  const context = await assembleJourneyContext(viewer, key, scope);
  if (context === null) return null;

  const result = await applyEvent({
    ...context.availabilityInput,
    transition: {
      userId: key.userId,
      journeyId: context.journey.id,
      nodeKey: move.nodeKey,
      kind: move.kind,
    },
  });

  // module.completed detection (f-engagement-analytics t-3, spec §4.3): after a *committed*
  // `complete` on a node that belongs to a module, check whether that finished the whole
  // module for this user and, if so, emit `module.completed`. Fire-and-forget and
  // non-throwing — the pure engine (`applyEvent`) stays untouched (F11); the derived,
  // whole-module fact is computed here in the transition caller, after the write commits.
  if (result.ok && move.kind === 'complete') {
    const node = context.availabilityInput.graph.node(move.nodeKey);
    if (node?.moduleSlug !== undefined) {
      void maybeEmitModuleCompleted({
        userId: key.userId,
        moduleSlug: node.moduleSlug,
        journeyId: context.journey.id,
        graph: context.availabilityInput.graph,
      });
    }
  }

  return result;
}
