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
import { requireOrgId } from '@/lib/tenancy/context';
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
}

/** How many deleted conversations one sweep takes. */
export const SWEEP_BATCH = 100;

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
  const none: ForgottenConversations = { turns: 0, versions: 0, deferred: 0 };
  if (ids.length === 0) return none;

  const live = await prisma.aiConversation.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
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

  const byUser = new Map<string, typeof ready>();
  for (const turn of ready) {
    byUser.set(turn.userId, [...(byUser.get(turn.userId) ?? []), turn]);
  }
  for (const [userId, owned] of byUser) {
    const writes = owned.flatMap((turn) => turn.slotWrites);
    const coined = await coinedSlugs([...new Set(writes.map((write) => write.slotSlug))]);
    const removedAt = new Date();
    const done = await executeTransaction(async (tx) => {
      const versions = await wipeTurnWrites(tx, { userId, writes, coined, removedAt });
      const deleted = await tx.appTurn.deleteMany({
        where: { id: { in: owned.map((turn) => turn.id) }, userId },
      });
      return { turns: deleted.count, versions };
    });
    result.turns += done.turns;
    result.versions += done.versions;
    forgetCachedContext(userId);
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
  const orgId = requireOrgId();
  const rows = await prisma.$queryRaw<Array<{ conversationId: string }>>`
    SELECT DISTINCT t."conversationId"
      FROM app_turn t
      LEFT JOIN ai_conversation c ON c.id = t."conversationId"
     WHERE t."orgId" = ${orgId}
       AND t."conversationId" IS NOT NULL
       AND c.id IS NULL
     LIMIT ${batchSize}
  `;
  const result = await forgetDeletedConversations(rows.map((row) => row.conversationId));
  if (result.turns > 0 || result.deferred > 0) {
    logger.info('Forgot what deleted conversations left behind', {
      orgId,
      conversations: rows.length,
      ...result,
    });
  }
  return result;
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
