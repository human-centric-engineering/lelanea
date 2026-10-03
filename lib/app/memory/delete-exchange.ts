/**
 * A person deletes an exchange, and everything it left behind goes with it
 * (f-memory t-127; product description §3.19, §12 "Deletion is real").
 *
 * Removing a note (t-78) takes the note, but not what the person said. The
 * exchange it came from is still in the conversation, and the AI can still read
 * it. Owner ruling 4 (3 Oct 2026, journal on `f-memory`): after a removal, the
 * app offers to delete that exchange too, and the person decides.
 *
 * ## What an exchange is
 *
 * One turn, as the turn ledger (`app_turn`) records it: the person's message
 * and **every row the platform persisted answering it**. A turn that calls a
 * tool is stored as several assistant passes and tool results, not as one reply
 * (`readTurnReply` in `turn-record.ts` says why), and a `fill_slot` result can
 * echo the person's words back. So the exchange is the turn's window in its
 * conversation, from the person's message up to the next one, every role
 * included.
 *
 * ## What it takes
 *
 * - **Every message in that window.** Sunrise's reply embeddings cascade with
 *   them (`ai_message_embedding`), and so will this feature's index.
 * - **The turn record**, and its ledger rows with it (`app_turn_slot_write`
 *   cascades). No dollar lives on a turn record: the meter sums Sunrise's
 *   `ai_cost_log`, which keeps the turn's cost (`metering.ts`), so deleting an
 *   exchange can't lower what anyone has spent against a ceiling.
 * - **The note versions that turn wrote**, each becoming a placeholder
 *   (`wipe.ts`). Only those versions (owner ruling, 3 Oct 2026, at planning):
 *   earlier and later readings came from other exchanges and stay. A heading the
 *   AI coined moves to an opaque slug only once **no** version under it is left
 *   unwiped. While another exchange's reading is still filed there, the heading
 *   is what that reading is filed under, and renaming part of a chain would
 *   leave the old slug with no head, so its next capture would collide at
 *   version 1.
 * - **What the conversation row kept of them.** Sunrise folds a long
 *   conversation's oldest messages into a stored `summary`, pinned at
 *   `summaryUpToMessageId`, and puts that summary in the prompt in their place.
 *   If a deleted message sits inside the summarised prefix, or *is* the pin,
 *   the summary still carries its words. Sunrise carries a summary forward even
 *   when its pin is gone (`streaming-handler.ts`). So the summary and its pin
 *   are cleared, and the next turn that needs one summarises what is left. The
 *   cost: a summary of messages older than the 200 the platform loads is lost
 *   with it. The words of a deleted exchange outrank that. The conversation's
 *   `title` is the first 80 characters of its first message, so it is cleared
 *   when that message goes.
 * - **The person's cached context blocks**, as a removal does.
 *
 * ## The stopgap write
 *
 * Wiping a version writes Daybreak's `framework_slot_value` directly. It is the
 * same write t-78's removal makes, under the same owner ruling and the same
 * divergence row (`.context/app/divergences.md`), and it goes when Daybreak
 * ships a per-value removal (daybreak#286).
 *
 * @see lib/app/slots/wipe.ts — the placeholder write
 * @see .context/app/slots.md — "Deleting an exchange"
 */

import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { listSlotDefinitions } from '@/lib/framework/data-slots';
import { staleClaimMs, turnWindowStart } from '@/lib/app/agent/turn-record';
import { getAgentDeadlines } from '@/lib/app/agent/settings';
import {
  NOT_YET_REMOVED,
  forgetCachedContext,
  opaqueRemovedSlug,
  placeholderFields,
} from '@/lib/app/slots/wipe';

export interface ExchangeDeletion {
  userId: string;
  /** `app_turn.id` — the record's own id, never the client's turn id. */
  exchangeIds: string[];
}

/** What a deletion did. The panel re-reads the page rather than patching a row. */
export interface DeletedExchanges {
  exchanges: number;
  messages: number;
  /** Note versions made placeholders. Logged, never sent: see the route. */
  versions: number;
}

/** The turns asked about, the person's own, with what locates their messages. */
type OwnedTurn = Awaited<ReturnType<typeof readOwnedTurns>>[number];

function readOwnedTurns(userId: string, ids: string[]) {
  return prisma.appTurn.findMany({
    where: { id: { in: ids }, userId },
    select: {
      id: true,
      userId: true,
      turnId: true,
      status: true,
      startedAt: true,
      conversationId: true,
      userMessageId: true,
      slotWrites: { select: { slotSlug: true, version: true } },
    },
  });
}

interface WindowMessage {
  id: string;
  conversationId: string;
  createdAt: Date;
}

/**
 * Every message in one turn's window: from where the turn began up to, and not
 * including, the next message the person sent in that conversation. The latest
 * turn has no next message, so its window is open.
 */
async function messagesOf(turn: OwnedTurn): Promise<WindowMessage[]> {
  if (!turn.conversationId) return [];
  const owned = { conversationId: turn.conversationId, conversation: { userId: turn.userId } };
  const since = await turnWindowStart(turn);
  const next = await prisma.aiMessage.findFirst({
    where: {
      ...owned,
      role: 'user',
      createdAt: { gt: since },
      ...(turn.userMessageId ? { id: { not: turn.userMessageId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const rows = await prisma.aiMessage.findMany({
    where: {
      ...owned,
      createdAt: { gte: since, ...(next ? { lt: next.createdAt } : {}) },
    },
    select: { id: true, conversationId: true, createdAt: true },
  });
  return rows;
}

/** What to clear on one conversation row, once these of its messages are gone. */
interface ConversationClearing {
  conversationId: string;
  summary: boolean;
  title: boolean;
}

/**
 * Whether a conversation's stored summary or title holds words from the
 * messages being deleted. See the header for why each is cleared.
 */
async function clearingsFor(
  userId: string,
  deleted: WindowMessage[]
): Promise<ConversationClearing[]> {
  const byConversation = new Map<string, WindowMessage[]>();
  for (const row of deleted) {
    byConversation.set(row.conversationId, [
      ...(byConversation.get(row.conversationId) ?? []),
      row,
    ]);
  }
  const clearings: ConversationClearing[] = [];
  for (const [conversationId, rows] of byConversation) {
    const conversation = await prisma.aiConversation.findFirst({
      where: { id: conversationId, userId },
      select: { summary: true, summaryUpToMessageId: true },
    });
    if (!conversation) continue;
    const ids = new Set(rows.map((row) => row.id));
    const oldestDeleted = Math.min(...rows.map((row) => row.createdAt.getTime()));

    let summary = false;
    if (conversation.summary !== null || conversation.summaryUpToMessageId !== null) {
      const pin = conversation.summaryUpToMessageId
        ? await prisma.aiMessage.findFirst({
            where: { id: conversation.summaryUpToMessageId, conversationId },
            select: { id: true, createdAt: true },
          })
        : null;
      // No pin, a pin already gone, the pin itself, or anything at or before it.
      summary = !pin || ids.has(pin.id) || oldestDeleted <= pin.createdAt.getTime();
    }

    const first = await prisma.aiMessage.findFirst({
      where: { conversationId, conversation: { userId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const title = first !== null && ids.has(first.id);

    if (summary || title) clearings.push({ conversationId, summary, title });
  }
  return clearings;
}

/**
 * Delete the given exchanges, the person's own, with everything derived from
 * them, in one transaction.
 *
 * Two refusals:
 * - **Any id that is not one of this person's turns** gets a 404, the same 404
 *   for an id that exists and belongs to someone else as for one that does not,
 *   so the route can't be used to learn that a turn exists. Nothing is deleted
 *   when any id fails: a partial delete of what the person asked for would leave
 *   them thinking it was all gone.
 * - **A turn still being answered** gets a 409. Its window is still filling, so
 *   deleting it now would leave the reply's last passes behind. The refusal
 *   names its remedy (`HB10`): wait, and ask again. A claim left `running` past
 *   `staleClaimMs()` is abandoned, not being answered, and is deleted.
 */
export async function deleteExchanges(input: ExchangeDeletion): Promise<DeletedExchanges> {
  const ids = [...new Set(input.exchangeIds)];
  const turns = await readOwnedTurns(input.userId, ids);
  if (turns.length !== ids.length) {
    throw new NotFoundError('That part of the conversation could not be found.');
  }
  // A claim still `running` past `staleClaimMs()` was abandoned — its process
  // died — and its window will not fill any further; the turn path reclaims it
  // by the same test. Refusing it would make that exchange undeletable.
  const staleAfterMs = staleClaimMs((await getAgentDeadlines()).turnDeadlineMs);
  const now = Date.now();
  const answering = (turn: OwnedTurn): boolean =>
    turn.status === 'running' && now - turn.startedAt.getTime() <= staleAfterMs;
  if (turns.some(answering)) {
    throw new ConflictError(
      'Lelañea is still answering that. Try again in a moment, once the reply has finished.',
      { reason: 'still_answering' }
    );
  }

  const deletedMessages = (await Promise.all(turns.map(messagesOf))).flat();
  const messageIds = deletedMessages.map((row) => row.id);
  const clearings = await clearingsFor(input.userId, deletedMessages);

  // Which versions, slug by slug.
  const bySlug = new Map<string, number[]>();
  for (const write of turns.flatMap((turn) => turn.slotWrites)) {
    bySlug.set(write.slotSlug, [...(bySlug.get(write.slotSlug) ?? []), write.version]);
  }
  const slugs = [...bySlug.keys()];
  const coined = await coinedSlugs(slugs);

  const removedAt = new Date();
  const result = await executeTransaction(async (tx) => {
    let versions = 0;
    for (const [slotSlug, written] of bySlug) {
      // STOPGAP — direct write to Daybreak's `framework_slot_value`. Owner
      // ruling, 3 Oct 2026; divergence row in `.context/app/divergences.md`.
      // Replace with Daybreak's per-value removal when it ships (daybreak#286).
      const wiped = await tx.slotValue.updateMany({
        where: {
          userId: input.userId,
          slotSlug,
          version: { in: written },
          ...NOT_YET_REMOVED,
        },
        data: placeholderFields(removedAt),
      });
      versions += wiped.count;

      if (wiped.count > 0 && coined.has(slotSlug)) {
        const left = await tx.slotValue.count({
          where: { userId: input.userId, slotSlug, ...NOT_YET_REMOVED },
        });
        if (left === 0) {
          // Nothing of the note is left under the heading the AI coined, so the
          // heading goes too, as it does on a removal (t-78).
          const renamedTo = opaqueRemovedSlug();
          await tx.slotValue.updateMany({
            where: { userId: input.userId, slotSlug },
            data: { slotSlug: renamedTo },
          });
          await tx.appTurnSlotWrite.updateMany({
            where: { slotSlug, turn: { userId: input.userId } },
            data: { slotSlug: renamedTo },
          });
        }
      }
    }

    const messages = messageIds.length
      ? await tx.aiMessage.deleteMany({
          where: { id: { in: messageIds }, conversation: { userId: input.userId } },
        })
      : { count: 0 };
    for (const clearing of clearings) {
      await tx.aiConversation.updateMany({
        where: { id: clearing.conversationId, userId: input.userId },
        data: {
          ...(clearing.summary ? { summary: null, summaryUpToMessageId: null } : {}),
          ...(clearing.title ? { title: null } : {}),
        },
      });
    }
    const exchanges = await tx.appTurn.deleteMany({
      where: { id: { in: ids }, userId: input.userId },
    });

    return { exchanges: exchanges.count, messages: messages.count, versions };
  });

  forgetCachedContext(input.userId);
  return result;
}

/**
 * The slugs here that the AI coined: no definition in either tier. A taxonomy
 * slug is an admin's wording and stays whatever happens to the readings under it.
 */
async function coinedSlugs(slugs: string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const framework = await listSlotDefinitions();
  const ours = await prisma.appSlotDefinition.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true },
  });
  const defined = new Set([...framework.map((d) => d.slug), ...ours.map((d) => d.slug)]);
  return new Set(slugs.filter((slug) => !defined.has(slug)));
}
