/**
 * A conversation is deleted, and everything its turns left behind goes with it
 * (f-memory t-128; product description §3.19, §12 "Deletion is real").
 *
 * Sunrise deletes conversations on four paths: the person's own
 * `DELETE /api/v1/chat/conversations/:id` (her agent is `public`, seed 007),
 * the admin per-thread delete, the admin bulk clear, and retention
 * (`enforceRetentionPolicies`). Each deletes the conversation row and nothing
 * else, and its messages cascade. What our turns wrote does not: the turn
 * record, its ledger rows, and the note versions it wrote. A note written from
 * a deleted conversation would still be read into the next prompt.
 *
 * This takes, per turn, what deleting its exchange takes (`delete-exchange.ts`)
 * once the messages are already gone: the turn record (its ledger rows cascade)
 * and the note versions it wrote, each made a placeholder, a coined heading
 * moving off once nothing under it is left. The conversation row, its summary
 * and title, and the person's own vectors in the memory index all went with
 * the conversation already, by Sunrise's delete and the FK cascades.
 *
 * ## Why after the delete, and found by the turn's dangling conversation id
 *
 * `app_turn.conversationId` carries no foreign key, on purpose. A cascading one
 * would take the turn row **and its ledger with it** on every path, including
 * the ones that call nothing of ours, and the ledger is the only link from a
 * note version to the exchange that wrote it (`app_turn_slot_write`). The note
 * versions would then survive, unwiped and unfindable. Without the key, a turn
 * whose conversation is gone is itself the record of what still needs
 * forgetting, and {@link sweepDeletedConversations} finds it whichever path
 * deleted the conversation.
 *
 * So there are two callers. The person's own delete runs it at once: the
 * Sunrise route calls {@link onConversationsDeleted} once the row is gone, a
 * Lelañea edit to a Sunrise file (divergence row in
 * `.context/app/divergences.md`), asked for upstream as a seam every path would
 * call. Every other path is caught by the sweep, an app job on the maintenance
 * tick (`lib/app/jobs.ts`).
 *
 * ## What it leaves, and why
 *
 * Rows that hold none of the person's words and link to none: journey events
 * and node progress (`JourneyEvent`, `UserNodeState`) record that a step
 * happened, not what was said in it. `AiUserMemory` is out of reach: no seat is
 * advertised `write_user_memory` (`smoke:app-misuse` asserts it is refused).
 * Notes with no turn behind them (onboarding answers, corrections) have no
 * exchange to be deleted with. Spend is Sunrise's `ai_cost_log`, which keeps
 * its rows when a conversation goes (`onDelete: SetNull`), so nothing here
 * lowers what anyone has spent against a ceiling.
 *
 * @see lib/app/memory/delete-exchange.ts — one exchange, from the person's panel
 * @see lib/app/slots/wipe.ts — the placeholder write
 */

import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { logger } from '@/lib/logging';
import { requireOrgId, runAsSystem } from '@/lib/tenancy/context';
import { stillAnswering } from '@/lib/app/memory/delete-exchange';
import { coinedSlugs, forgetCachedContext, wipeTurnWrites } from '@/lib/app/slots/wipe';

/** What forgetting did. */
export interface ForgottenConversations {
  /** Turn records deleted, their ledger rows with them. */
  turns: number;
  /** Note versions made placeholders. Counted, never the words. */
  versions: number;
  /**
   * Turns left for now because they are still being answered. The sweep comes
   * back for them once they settle or go stale.
   */
  deferred: number;
  /** Turns whose forgetting failed this time. Logged; the next sweep tries again. */
  failed: number;
}

/** How many deleted conversations one sweep takes. */
export const SWEEP_BATCH = 100;

/** After this many failures, a conversation is left out of the sweep. */
export const MAX_SWEEP_ATTEMPTS = 3;

/**
 * Deleted conversations whose forgetting failed, and how often. In process
 * memory, like the job clock: a restart gives each three more tries. Without
 * it, a conversation that always fails would hold its batch slot every run,
 * and the sweep would stop reaching anyone else's.
 */
const sweepFailures = new Map<string, number>();

/** For tests: forget every recorded failure. */
export function __resetSweepFailuresForTests(): void {
  sweepFailures.clear();
}

/**
 * Forget what our turns in these conversations left behind, for the ones that
 * no longer exist. A conversation that still exists is never touched, so a
 * caller passing a live id (or a delete that rolled back) changes nothing.
 * Idempotent: a second run finds no turns.
 *
 * `userId` narrows it to one person's turns, for the route, which knows whose
 * conversation it deleted. The sweep passes none: it runs for the org.
 */
export async function forgetDeletedConversations(
  conversationIds: string[],
  options: { userId?: string } = {}
): Promise<ForgottenConversations> {
  const ids = [...new Set(conversationIds)];
  const none: ForgottenConversations = { turns: 0, versions: 0, deferred: 0, failed: 0 };
  if (ids.length === 0) return none;

  // Read past row-level security, deliberately. Everything below rests on
  // "this conversation is gone", and under an org's policy a live conversation
  // that scope cannot see would look gone too. So this is the one check that
  // must see every thread, and it fails closed.
  const live = await runAsSystem('a deleted conversation is gone, not merely hidden (t-128)', () =>
    prisma.aiConversation.findMany({ where: { id: { in: ids } }, select: { id: true } })
  );
  const liveIds = new Set(live.map((row) => row.id));
  const gone = ids.filter((id) => !liveIds.has(id));
  if (gone.length === 0) return none;

  const turns = await prisma.appTurn.findMany({
    where: {
      conversationId: { in: gone },
      ...(options.userId ? { userId: options.userId } : {}),
    },
    select: {
      id: true,
      userId: true,
      conversationId: true,
      status: true,
      startedAt: true,
      slotWrites: { select: { slotSlug: true, version: true } },
    },
  });
  if (turns.length === 0) return none;

  // A turn still being answered may yet write a note; deleting its record now
  // would lose the ledger row that write is about to add. Leave it for the
  // sweep, which comes back once it settles or goes stale.
  const answering = await stillAnswering();
  const ready = turns.filter((turn) => !answering(turn));
  const result = { ...none, deferred: turns.length - ready.length };

  // One transaction per conversation, so a failure is counted against the
  // conversation that caused it and holds up nothing else (#2's give-up keys on
  // it). A conversation has one owner; the key carries the person anyway.
  const groups = new Map<string, typeof ready>();
  for (const turn of ready) {
    const key = `${turn.userId}\u0000${turn.conversationId}`;
    const group = groups.get(key) ?? [];
    group.push(turn);
    groups.set(key, group);
  }
  const coined = await coinedSlugs([
    ...new Set(ready.flatMap((turn) => turn.slotWrites.map((write) => write.slotSlug))),
  ]);
  for (const owned of groups.values()) {
    const { userId, conversationId } = owned[0];
    try {
      const writes = owned.flatMap((turn) => turn.slotWrites);
      const removedAt = new Date();
      const done = await executeTransaction(async (tx) => {
        const versions = await wipeTurnWrites(tx, { userId, writes, coined, removedAt });
        // Only turns still pointing at this deleted conversation. A failed turn
        // retried under the same id since it was read has been claimed again,
        // which resets its conversation (`claimTurn`); deleting its record now
        // would take the ledger row the new attempt writes, and leave that
        // version unwiped and unfindable.
        const deleted = await tx.appTurn.deleteMany({
          where: {
            id: { in: owned.map((turn) => turn.id) },
            userId,
            conversationId: { in: [conversationId ?? ''] },
          },
        });
        return { turns: deleted.count, versions };
      });
      result.turns += done.turns;
      result.versions += done.versions;
      if (conversationId) sweepFailures.delete(conversationId);
      forgetCachedContext(userId);
    } catch (err) {
      result.failed += owned.length;
      const attempts = conversationId ? (sweepFailures.get(conversationId) ?? 0) + 1 : 0;
      if (conversationId) sweepFailures.set(conversationId, attempts);
      logger.error('Could not forget what a deleted conversation left behind', {
        conversationId,
        turns: owned.length,
        attempts,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempts === MAX_SWEEP_ATTEMPTS) {
        // Its notes stay readable until someone looks: say which, once.
        logger.warn('Gave up forgetting a deleted conversation until the next restart', {
          conversationId,
          attempts,
        });
      }
    }
  }
  return result;
}

/**
 * Find conversations in this org that are gone but still have our turns
 * pointing at them, and forget what those turns left behind. The catch-all for
 * every path that deletes a conversation without telling us: retention, the
 * admin deletes, and the person's own delete if its call failed. Runs per org,
 * a batch per run, as an app job.
 */
export async function sweepDeletedConversations(
  batchSize: number = SWEEP_BATCH
): Promise<ForgottenConversations> {
  // Its outcome is folded into the tick's log line (`AppJob.run`), so it is
  // returned rather than logged here.
  return forgetDeletedConversations(await findDeletedConversations(batchSize));
}

/**
 * The ids of conversations in this org that are gone but still have our turns
 * pointing at them, up to `batchSize`, leaving out any that have failed
 * {@link MAX_SWEEP_ATTEMPTS} times. Candidates only: the existence check in
 * {@link forgetDeletedConversations} is what decides. Exported so the smoke can
 * prove the SQL without forgetting anyone else's.
 */
export async function findDeletedConversations(batchSize: number = SWEEP_BATCH): Promise<string[]> {
  const orgId = requireOrgId();
  const given = [...sweepFailures]
    .filter(([, attempts]) => attempts >= MAX_SWEEP_ATTEMPTS)
    .map(([id]) => id);
  const rows = await prisma.$queryRaw<Array<{ conversationId: string }>>`
    SELECT DISTINCT t."conversationId"
      FROM app_turn t
      LEFT JOIN ai_conversation c ON c.id = t."conversationId"
     WHERE t."orgId" = ${orgId}
       AND t."conversationId" IS NOT NULL
       AND c.id IS NULL
       AND t."conversationId" <> ALL(${given}::text[])
     LIMIT ${batchSize}
  `;
  return rows.map((row) => row.conversationId);
}

/** What a deleting path tells us. */
export interface ConversationsDeleted {
  conversationIds: string[];
  /** Whose conversations they were, when the caller knows. */
  userId: string | null;
}

/**
 * Called by a path that has just deleted conversations: forget what they left
 * behind, now rather than at the next sweep.
 *
 * **Never throws.** The conversation is already deleted when this runs, so a
 * failure here is not the caller's to retry: it is logged, and the sweep
 * forgets what is left within its interval.
 */
export async function onConversationsDeleted(event: ConversationsDeleted): Promise<void> {
  try {
    await forgetDeletedConversations(event.conversationIds, {
      ...(event.userId ? { userId: event.userId } : {}),
    });
  } catch (err) {
    logger.error('Could not forget what a deleted conversation left behind; the sweep will', {
      conversations: event.conversationIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
