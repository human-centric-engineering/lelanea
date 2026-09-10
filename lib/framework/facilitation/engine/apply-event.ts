/**
 * `applyEvent` (f-engine t-3) — the **sole writer** of journey *lifecycle* state
 * (spec §5.3, F11): node `status`, `timesCompleted`, the timestamps, and the event
 * log. Agents and APIs *request* a transition; the engine is the only thing that
 * mutates that state, and only through a validated transition.
 *
 * The one field on `UserNodeState` it does **not** own is `progress` — the schema
 * declares that payload module-owned and opaque to the engine, and #168 gave it its
 * own writer (`journey/progress.ts`). A module records its own facts there without
 * going through a transition; nothing it writes can reach the fields above.
 *
 * Contract:
 * - **Entry requires availability** (decision 7): an `enter` is validated against the
 *   same `computeAvailability` the read side uses, so a hallucinated
 *   `enter('locked-thing')` is **rejected with a structured reason** (the node's own
 *   lock reasons), not obeyed. A `complete` requires the node to be currently `active`
 *   (you must have entered it).
 * - **Once/repeatable semantics** (F6): a `once` node closes on completion; a
 *   `repeatable` node increments `timesCompleted` and reopens (its cooldown, if any,
 *   is an edge condition the read side already enforces).
 * - **One transaction** (F10): every accepted transition appends the immutable
 *   `JourneyEvent` (source of truth) **and** writes the `UserNodeState` projection in
 *   a single `executeTransaction`, mirroring `appendSlotValue`. The event carries
 *   `userId` on every row (decision 5 — the erasure path). **Race-safe without retry:**
 *   an `enter` upserts to `active` (idempotent — re-entering yields the same state);
 *   a `complete` uses an **atomic conditional update** (`active → completed` in one
 *   `updateMany WHERE status='active'`), so two racing completes can't double-increment
 *   `timesCompleted` — the loser matches 0 rows and is refused, no write.
 *
 * Scope (decision 8): this is the validated *library* writer. The agent-facing
 * capabilities that call it (`enter_module` / `complete_node`, and the assembler that
 * loads the graph + state + slots + liveness + `canRead`-guards the reads) are
 * `f-guidance` / `f-facilitation-agents`. This ships the writer + its proof (units +
 * a real-DB smoke), the `getSlotHeads`-before-`f-slot-capture` pattern. The read
 * inputs (graph, node-states, slots, module-liveness, `now`) are the caller's, exactly
 * as `computeAvailability` takes them; only the write is the engine's.
 */

import type { JourneyEvent, Prisma, UserNodeState } from '@prisma/client';
import { executeTransaction } from '@/lib/db/utils';
import {
  NODE_STATE_STATUS,
  JOURNEY_EVENT_TYPE,
} from '@/lib/framework/facilitation/journey/vocabulary';
import type { GraphStore } from '@/lib/framework/facilitation/engine/graph-store';
import type { ModuleLiveness } from '@/lib/framework/modules/liveness';
import type { SlotReadingView } from '@/lib/framework/facilitation/engine/conditions';
import {
  computeAvailability,
  type JourneyNodeState,
  type LockReason,
} from '@/lib/framework/facilitation/engine/availability';

/** The `JourneyEvent.type` values the engine writes — the shared, client-safe
 *  vocabulary (`JOURNEY_EVENT_TYPE`), re-exported under the engine's local name so
 *  its existing consumers are unchanged. One source, so the client replay reducer
 *  and this writer can't drift. */
export const ENGINE_EVENT_TYPE = JOURNEY_EVENT_TYPE;

/** A requested transition against one node of a journey. */
export type TransitionKind = 'enter' | 'complete';
export interface Transition {
  /** The journey owner (the `JourneyEvent.userId` erasure key). */
  userId: string;
  /** The journey being walked (`UserJourney.id`). */
  journeyId: string;
  /** The node the transition acts on. */
  nodeKey: string;
  kind: TransitionKind;
  /** Optional event payload stored on the `JourneyEvent`. */
  payload?: Prisma.InputJsonValue;
}

/** Inputs to {@link applyEvent}: the transition plus the read context (the caller's,
 *  like {@link computeAvailability}). */
export interface ApplyEventInput {
  transition: Transition;
  graph: GraphStore;
  nodeStates: readonly JourneyNodeState[];
  slots: readonly SlotReadingView[];
  moduleLiveness: ReadonlyMap<string, ModuleLiveness>;
  now: Date;
}

/** Why a transition was refused — structured so the caller can narrate it (F11). */
export interface Rejection {
  code: 'unknown_node' | 'not_available' | 'not_active';
  message: string;
  /** The node's lock reasons, for a `not_available` refusal. */
  lockReasons?: readonly LockReason[];
}

/** The outcome: the written projection + event, or a structured rejection with no write. */
export type ApplyEventResult =
  { ok: true; nodeState: UserNodeState; event: JourneyEvent } | { ok: false; rejection: Rejection };

/** The projection fields a transition sets (create + update share them). */
interface ProjectionFields {
  status: string;
  timesCompleted: number;
  firstEnteredAt: Date;
  lastActiveAt: Date;
  completedAt: Date | null;
}

/**
 * Validate a requested transition and, if legal, write it (event + projection) in one
 * transaction. Rejections happen **before** any write, so a refused transition never
 * touches the database.
 */
export async function applyEvent(input: ApplyEventInput): Promise<ApplyEventResult> {
  const { transition, graph, now } = input;
  const { nodeKey, journeyId } = transition;

  const node = graph.node(nodeKey);
  if (node === undefined) {
    return refuse('unknown_node', `No node "${nodeKey}" in the published map.`);
  }

  // `enter` is gated here on the caller's snapshot (a fast refusal without opening a
  // transaction). `complete` is gated **authoritatively inside the transaction** by a
  // conditional update (below) — its snapshot could be stale in either direction, and
  // the active→completed transition must be race-safe.
  if (transition.kind === 'enter') {
    const availability = computeAvailability({
      graph,
      nodeStates: input.nodeStates,
      slots: input.slots,
      moduleLiveness: input.moduleLiveness,
      now,
    });
    const verdict = availability.perNode.get(nodeKey);
    if (verdict === undefined || !verdict.available) {
      return {
        ok: false,
        rejection: {
          code: 'not_available',
          message: `Node "${nodeKey}" is not available to enter.`,
          lockReasons: verdict?.lockReasons ?? [],
        },
      };
    }
  }

  return executeTransaction(async (tx) => {
    let nodeState: UserNodeState;

    if (transition.kind === 'complete') {
      // Optimistic concurrency: only a row that is *still* `active` transitions to
      // `completed`, evaluated atomically by the DB. Two racing completes therefore
      // can't double-increment — the loser matches 0 rows. And a `complete` never
      // *creates* a row: completing a node with no active projection is refused, not
      // papered over (the `@@unique`-on-create backstop does not cover an update).
      const updated = await tx.userNodeState.updateMany({
        where: { journeyId, nodeKey, status: NODE_STATE_STATUS.active },
        data: {
          status: NODE_STATE_STATUS.completed,
          timesCompleted: { increment: 1 }, // once closes at 1; repeatable counts up
          lastActiveAt: now,
          completedAt: now,
        },
      });
      if (updated.count === 0) {
        return refuse('not_active', `Node "${nodeKey}" is not active; enter it before completing.`);
      }
      nodeState = await tx.userNodeState.findUniqueOrThrow({
        where: { journeyId_nodeKey: { journeyId, nodeKey } },
      });
    } else {
      // enter — upsert to active, preserving first-arrival + any prior completion off
      // the freshly-read row. Re-entering is idempotent (status stays active).
      const current = await tx.userNodeState.findUnique({
        where: { journeyId_nodeKey: { journeyId, nodeKey } },
      });
      nodeState = await tx.userNodeState.upsert({
        where: { journeyId_nodeKey: { journeyId, nodeKey } },
        create: { journeyId, nodeKey, ...enterProjection(current, now) },
        update: enterProjection(current, now),
      });
    }

    const event = await tx.journeyEvent.create({
      data: {
        userId: transition.userId,
        journeyId,
        nodeKey,
        moduleSlug: node.moduleSlug ?? null,
        type:
          transition.kind === 'enter'
            ? ENGINE_EVENT_TYPE.nodeEntered
            : ENGINE_EVENT_TYPE.nodeCompleted,
        occurredAt: now,
        ...(transition.payload !== undefined ? { payload: transition.payload } : {}),
      },
    });

    return { ok: true, nodeState, event };
  });
}

/** The projection fields an `enter` sets — active, preserving first-arrival + any
 *  prior completion from the committed row. (`complete` uses an atomic conditional
 *  update instead, so it needs no field computation here.) */
function enterProjection(current: UserNodeState | null, now: Date): ProjectionFields {
  return {
    status: NODE_STATE_STATUS.active,
    timesCompleted: current?.timesCompleted ?? 0,
    firstEnteredAt: current?.firstEnteredAt ?? now,
    lastActiveAt: now,
    completedAt: current?.completedAt ?? null,
  };
}

function refuse(code: Rejection['code'], message: string): ApplyEventResult {
  return { ok: false, rejection: { code, message } };
}
