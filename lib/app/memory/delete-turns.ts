/**
 * The core every deletion of the person's turns runs through: one exchange or
 * several (`delete-exchange.ts`, f-memory t-127), the recap that looked back on
 * them (f-recap t-151), and a whole session (f-forget-session t-153).
 *
 * Split from the exchanges route's deletion so that a caller resolving its own
 * turns server-side is not bound by that route's cap on the ids a request may
 * name. What a deletion takes, and why, is `delete-exchange.ts`'s header; this
 * file is the mechanism, in two halves:
 *
 * - {@link planTurnDeletion} reads, outside any transaction, everything the
 *   deletion will touch: each turn's window of messages, what the conversation
 *   rows kept of them, and the note versions the turns wrote. It refuses a turn
 *   still being answered.
 * - {@link applyTurnDeletion} writes all of it inside the caller's
 *   transaction, so the caller can settle what else the deletion owes (a
 *   synopsis, a journey entry) in the same one.
 *
 * The caller forgets the person's cached context once its transaction commits
 * (`forgetCachedContext`): a context block rebuilt from a rolled-back deletion
 * would be no worse than the one it replaced, but one cached before the commit
 * could outlive it.
 *
 * @see lib/app/memory/delete-exchange.ts — what an exchange deletion takes
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import type { executeTransaction } from '@/lib/db/utils';
import { ConflictError } from '@/lib/api/errors';
import { openingWindowStart, staleClaimMs, turnWindowStart } from '@/lib/app/agent/turn-record';
import { OPENING_TURN_ID_PREFIX, RECAP_TURN_ID_PREFIX } from '@/lib/app/conversation/opening-id';
import { getAgentDeadlines } from '@/lib/app/agent/settings';
import { coinedSlugs, wipeTurnWrites, type TurnWrite } from '@/lib/app/slots/wipe';
import { clearStoredSearchResults } from '@/lib/app/memory/stored-results';

type Tx = Parameters<Parameters<typeof executeTransaction>[0]>[0];

/** What locates a turn's messages and its note versions. */
export const OWNED_TURN_SELECT = {
  id: true,
  userId: true,
  turnId: true,
  status: true,
  startedAt: true,
  conversationId: true,
  userMessageId: true,
  sessionId: true,
  slotWrites: { select: { slotSlug: true, version: true } },
} satisfies Prisma.AppTurnSelect;

/** A turn of the person's, as a deletion reads it. */
export type OwnedTurn = Prisma.AppTurnGetPayload<{ select: typeof OWNED_TURN_SELECT }>;

/** The person's own turns among these ids. An id that is not theirs is simply absent. */
export function readOwnedTurns(userId: string, ids: string[]): Promise<OwnedTurn[]> {
  return prisma.appTurn.findMany({
    where: { id: { in: ids }, userId },
    select: OWNED_TURN_SELECT,
  });
}

/**
 * Whether a turn is still being answered, as of now. A claim still `running`
 * past `staleClaimMs()` was abandoned (its process died) and its window will
 * not fill any further; the turn path reclaims it by the same test. Counting it
 * as answering would make that exchange undeletable.
 */
export async function stillAnswering(): Promise<
  (turn: { status: string; startedAt: Date }) => boolean
> {
  const staleAfterMs = staleClaimMs((await getAgentDeadlines()).turnDeadlineMs);
  const now = Date.now();
  return (turn) => turn.status === 'running' && now - turn.startedAt.getTime() <= staleAfterMs;
}

interface WindowMessage {
  id: string;
  conversationId: string;
  createdAt: Date;
}

/**
 * Every message in one turn's window: from where the turn began up to, and not
 * including, whichever comes first of the next message the person sent in that
 * conversation and the window of the next turn the agent opened there. The
 * latest turn has neither, so its window is open. A turn the agent opened (a
 * recap) has no message of the person's, so its window begins at its claim and
 * holds its reply (`turnWindowStart`).
 *
 * The next opened turn ends it because nothing of the person's comes between
 * two recaps when they arrive and say nothing: bounded by their next message
 * alone, deleting the first recap took the second's reply and left its turn
 * behind, replying with nothing (found building t-156).
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
  const opened = await prisma.appTurn.findFirst({
    where: {
      userId: turn.userId,
      conversationId: turn.conversationId,
      startedAt: { gt: turn.startedAt },
      OR: [
        { turnId: { startsWith: OPENING_TURN_ID_PREFIX } },
        { turnId: { startsWith: RECAP_TURN_ID_PREFIX } },
      ],
    },
    orderBy: { startedAt: 'asc' },
    select: { startedAt: true },
  });
  const ends = [
    ...(next ? [next.createdAt] : []),
    // Its window reaches back a grace before its claim. Never so far that this
    // window would close before it opens: then the claim itself bounds it.
    ...(opened
      ? [
          openingWindowStart(opened.startedAt).getTime() > since.getTime()
            ? openingWindowStart(opened.startedAt)
            : opened.startedAt,
        ]
      : []),
  ];
  const end = ends.length > 0 ? new Date(Math.min(...ends.map((at) => at.getTime()))) : null;
  return prisma.aiMessage.findMany({
    where: {
      ...owned,
      createdAt: { gte: since, ...(end ? { lt: end } : {}) },
    },
    select: { id: true, conversationId: true, createdAt: true },
  });
}

/** What to clear on one conversation row, once these of its messages are gone. */
interface ConversationClearing {
  conversationId: string;
  summary: boolean;
  title: boolean;
}

/**
 * Whether a conversation's stored summary or title holds words from the
 * messages being deleted. See `delete-exchange.ts` for why each is cleared.
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

/** Everything a deletion of these turns will write, read before its transaction. */
export interface TurnDeletionPlan {
  userId: string;
  turnIds: string[];
  messageIds: string[];
  clearings: ConversationClearing[];
  writes: TurnWrite[];
  coined: Set<string>;
}

/**
 * Read what deleting these turns, all the person's own, will take.
 *
 * Refuses with a 409 when any of them is still being answered: its window is
 * still filling, so deleting it now would leave the reply's last passes behind.
 * The refusal names its remedy (`HB10`): wait, and ask again. A claim left
 * `running` past `staleClaimMs()` is abandoned, not being answered, and is
 * deleted.
 */
export async function planTurnDeletion(
  userId: string,
  turns: readonly OwnedTurn[]
): Promise<TurnDeletionPlan> {
  const answering = await stillAnswering();
  if (turns.some(answering)) {
    throw new ConflictError(
      'Lelañea is still answering that. Try again in a moment, once the reply has finished.',
      { reason: 'still_answering' }
    );
  }

  const windows = (await Promise.all(turns.map(messagesOf))).flat();
  // Two turns' windows never overlap, but a message is deleted once either way.
  const deleted = [...new Map(windows.map((row) => [row.id, row])).values()];
  const clearings = await clearingsFor(userId, deleted);

  const writes = turns.flatMap((turn) => turn.slotWrites);
  const coined = await coinedSlugs([...new Set(writes.map((write) => write.slotSlug))]);

  return {
    userId,
    turnIds: [...new Set(turns.map((turn) => turn.id))],
    messageIds: deleted.map((row) => row.id),
    clearings,
    writes,
    coined,
  };
}

/** What a deletion did. */
export interface AppliedTurnDeletion {
  turns: number;
  messages: number;
  /** Note versions made placeholders. */
  versions: number;
}

/**
 * Delete what {@link planTurnDeletion} read, inside the caller's transaction:
 * the note versions the turns wrote (made placeholders), their messages, what
 * the conversation rows kept of those, the turn records, and any memory search
 * result that may hold a copy of the words (t-130). Every write is keyed on the
 * person as well as the ids.
 */
export async function applyTurnDeletion(
  tx: Tx,
  plan: TurnDeletionPlan,
  removedAt: Date
): Promise<AppliedTurnDeletion> {
  const { userId } = plan;
  const versions = await wipeTurnWrites(tx, {
    userId,
    writes: plan.writes,
    coined: plan.coined,
    removedAt,
  });

  const messages = plan.messageIds.length
    ? await tx.aiMessage.deleteMany({
        where: { id: { in: plan.messageIds }, conversation: { userId } },
      })
    : { count: 0 };
  for (const clearing of plan.clearings) {
    await tx.aiConversation.updateMany({
      where: { id: clearing.conversationId, userId },
      data: {
        ...(clearing.summary ? { summary: null, summaryUpToMessageId: null } : {}),
        ...(clearing.title ? { title: null } : {}),
      },
    });
  }
  const turns = await tx.appTurn.deleteMany({
    where: { id: { in: plan.turnIds }, userId },
  });
  // A memory search elsewhere may hold a copy of these words (t-130).
  await clearStoredSearchResults(tx, { userId });

  return { turns: turns.count, messages: messages.count, versions };
}
