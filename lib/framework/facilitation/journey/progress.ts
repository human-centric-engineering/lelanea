/**
 * `recordNodeProgress` (#168) — the seam that writes `UserNodeState.progress`.
 *
 * The column is declared module-owned and opaque to the engine ("shape owned by the
 * node's module, opaque to the engine", `prisma/schema/framework-facilitation.prisma`)
 * — and until now no module could reach it. `applyEvent` writes only the lifecycle
 * projection; `TransitionRequest` carries no payload; `JourneyEvent` is written
 * inside `applyEvent`'s own transaction with no leaf-reachable entry point. So the
 * one field the framework set aside *for* a module was the one field a module could
 * not write, and Daybreak's first leaf added a bespoke scalar-list column to its own
 * run table for a concept the framework already models.
 *
 * The shape it exists for: **a beat that must happen exactly once per node** —
 * showing someone the chart of their own week for the first time, presenting a gap
 * analysis. Re-firing one replays a moment the person has already had, so the fact
 * has to be recorded, and it has to survive a reload.
 *
 * ## The five decisions behind the signature
 *
 * 1. **Merge, not replace — and merged by the database, not by us.** "Patch" is what
 *    a moment ledger needs: add `chartShown` without knowing, or clobbering, what
 *    else is in there. The obvious implementation is read-modify-write, and it is
 *    wrong: two beats landing together each read the same `progress`, and the second
 *    write silently drops the first — the *lost update*, in the one field whose
 *    entire job is "this must not happen twice". Postgres merges `jsonb` in a single
 *    statement (`COALESCE(progress,'{}') || patch`), so there is no read to lose and
 *    no row to lock. That is why this reaches for raw SQL rather than
 *    `prisma.userNodeState.update`.
 *
 *    The merge is **shallow**, as `||` is: a nested object in `patch` replaces the
 *    one it lands on rather than merging into it. Keep ledger keys flat.
 *
 * 2. **It refuses to create the row.** A `UserNodeState` that does not exist means
 *    the node was never entered, and creating one here would require inventing a
 *    `status` — the field `applyEvent` is the sole writer of, and which the engine
 *    derives from the graph. Writing one out of band would corrupt the projection to
 *    record a beat about a node the person has not reached. Enter the node, then
 *    record against it.
 *
 * 3. **Keyed by the natural key, not by `journeyId`.** The issue proposed
 *    `recordNodeProgress(journeyId, nodeKey, patch)`. Taking the `JourneyKey` the
 *    rest of the family takes ({@link createJourney}, `applyJourneyTransition`,
 *    every read query) buys a property a bare `journeyId` cannot: the subject is
 *    named in the argument that is *access-checked*, and the `journeyId` is then
 *    resolved **from** it. There is no way to address a row the guard did not
 *    authorise, because the caller never supplies the row's key. A
 *    `journeyId`-first signature would have to read the journey back just to learn
 *    whose it is — the same lookup, with a mismatch case to get wrong.
 *
 * 4. **Guarded by {@link canWrite}** — the pinned self-or-admin-support grant, not
 *    `canRead`. `canRead` is documented as widening `own → team → all` when Sunrise
 *    #367's ownership resolver lands; that widening is about reading a cohort.
 *    Guarding a write on it would hand every future cohort-reader the right to write
 *    these rows with no diff to this file. Same reasoning as `createJourney`
 *    (decision 1 there); see `shared/access.ts`.
 *
 * 5. **A structured refusal, not `null`.** The rest of the family returns `null` for
 *    "nothing to do", which is right when the caller's next move is to stop. It is
 *    wrong here: the failure this seam guards against is a beat firing twice, so a
 *    write that silently did not happen leaves the beat firing *forever*, and the
 *    two reasons it can fail want different fixes (start the journey / enter the
 *    node). It mirrors `applyEvent`'s `ok`-discriminated result rather than
 *    inventing a third convention for the same domain.
 *
 * ## Why `TransitionRequest` did NOT also gain a `progress` field
 *
 * The issue offered that as the alternative for "the beat coincides with a
 * transition", and it is deliberately not taken. It would thread a payload through
 * `applyJourneyTransition` → `applyEvent` → the engine transaction, giving the
 * framework two ways to write one field and putting module-owned data inside the
 * pure engine (F11) to buy atomicity with the transition.
 *
 * That atomicity is worth less than it looks, because **this seam is idempotent**:
 * merging the same patch twice is the same as merging it once. A leaf whose
 * `recordNodeProgress` fails after a committed `complete` retries it, and a leaf
 * whose `complete` fails after a committed progress write has recorded a true fact
 * about a node the person did reach. Neither window produces the harm the field
 * exists to prevent. If a real case needs one transaction, it is additive and can be
 * argued then.
 */

import type { Prisma, UserNodeState } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { ForbiddenError } from '@/lib/api/errors';
import { canWrite, type JourneyViewer, type AccessScope } from '@/lib/framework/shared/access';
import type { JourneyKey } from '@/lib/framework/facilitation/journey/queries';

/** Why a progress write was refused — structured so the caller can act on it (F11). */
export interface ProgressRejection {
  code: 'journey_not_started' | 'node_not_entered';
  message: string;
}

/** The outcome: the updated projection, or a structured refusal with no write. */
export type RecordNodeProgressResult =
  { ok: true; nodeState: UserNodeState } | { ok: false; rejection: ProgressRejection };

/**
 * Merge `patch` into the module-owned `progress` payload of one node of one journey.
 *
 * Shallow-merged by the database in a single statement, so concurrent writers cannot
 * lose each other's keys, and idempotent — merging the same patch twice is the same
 * as merging it once. Nothing else on the row is touched: `status`, `timesCompleted`
 * and the timestamps remain `applyEvent`'s alone.
 *
 * A key set to `null` is stored as JSON `null` (a tombstone), not removed —
 * `jsonb ||` cannot delete. Read it as "recorded, and empty".
 *
 * @throws {ForbiddenError} when `viewer` may not write for `key.userId`.
 */
export async function recordNodeProgress(
  viewer: JourneyViewer,
  key: JourneyKey,
  nodeKey: string,
  patch: Prisma.InputJsonObject,
  scope?: AccessScope
): Promise<RecordNodeProgressResult> {
  if (!(await canWrite(viewer, key.userId, scope))) {
    throw new ForbiddenError('Not permitted to record progress on this journey');
  }

  // Resolved from the guarded natural key — see decision 3. `findUnique` rather than
  // the `canRead`-guarded `getJourney` because the write grant above is the stricter
  // of the two and has already been checked; re-checking through the read seam would
  // read as if `canRead` were what authorises this.
  const journey = await prisma.userJourney.findUnique({
    where: {
      userId_graphSlug_contextKey: {
        userId: key.userId,
        graphSlug: key.graphSlug,
        contextKey: key.contextKey ?? '', // '' is the default, context-free journey (X3)
      },
    },
    select: { id: true },
  });
  if (journey === null) {
    return refuse('journey_not_started', `No journey for map "${key.graphSlug}" has been started.`);
  }

  // The merge, then the read-back, in one transaction.
  //
  // The merge itself needs no transaction — `||` on `jsonb` is a top-level merge
  // with the right-hand side winning per key, `COALESCE` makes the first write work
  // against the `NULL` the column starts as, and one statement has no
  // read-modify-write to race. The transaction is for the **read-back**: between a
  // committed `UPDATE` and a separate `findUniqueOrThrow`, the row can disappear
  // (a journey cascade from `eraseUser`, an admin delete), and the read would then
  // throw Prisma `P2025` out of a function whose result type says the only outcomes
  // are `ok` or a `rejection`. Pairing them removes the window instead of adding a
  // catch that would have to invent an outcome for "written, then erased".
  //
  // The patch is bound as a text parameter and cast, not interpolated — Prisma's
  // tagged template parameterises `${…}`, and a JS object bound directly is not a
  // type the driver can send.
  return executeTransaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE "framework_user_node_state"
         SET "progress" = COALESCE("progress", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
       WHERE "journeyId" = ${journey.id} AND "nodeKey" = ${nodeKey}
    `;
    if (updated === 0) {
      return refuse(
        'node_not_entered',
        `Node "${nodeKey}" has no state on this journey to record against.`
      );
    }

    // Read back through the typed client rather than `RETURNING *` — the same shape
    // `applyEvent` uses after its own conditional update, and it keeps the row a
    // Prisma-typed `UserNodeState` instead of an asserted raw result.
    return {
      ok: true,
      nodeState: await tx.userNodeState.findUniqueOrThrow({
        where: { journeyId_nodeKey: { journeyId: journey.id, nodeKey } },
      }),
    };
  });
}

function refuse(code: ProgressRejection['code'], message: string): RecordNodeProgressResult {
  return { ok: false, rejection: { code, message } };
}
