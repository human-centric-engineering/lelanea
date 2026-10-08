/**
 * A person deletes a whole session, and everything it left behind goes with it
 * (f-forget-session t-153; product description §3.19, §12 "Deletion is real").
 *
 * Deleting one exchange at a time (`delete-exchange.ts`) is the wrong unit for
 * someone who regrets a whole sitting. This takes every turn stamped with the
 * session (`app_turn.sessionId`, f-recap t-141), on both seats, through the same
 * core (`delete-turns.ts`), so it takes everything an exchange deletion takes:
 * each turn's window of messages, the turn records, the note versions they
 * wrote, what the conversation rows kept of them, stored search results and
 * the person's vectors. With them, in the same transaction:
 *
 * - **The recaps that looked back on the session** (t-151), whatever they drew
 *   on. The session's own recap, which looked back on the one before, is one
 *   of its turns and goes with them.
 * - **Its account** (owner ruling 1, 7 Oct 2026, journal on
 *   `f-forget-session`). With `removeAccount`, a kept account is removed with
 *   the session. Without it, a kept account stays and is flagged as written
 *   from something since deleted, as for one exchange (t-147). A draft always
 *   goes: nobody kept it, and it may quote the session.
 *
 * ## What stays
 *
 * - **The session's rows in `framework_journey_event`.** They hold an ordinal
 *   and a link, never words, and the stream is insert-only: a sitting that
 *   happened still happened.
 * - **The person's own entries.** They carry no session.
 * - **Notes with no turn behind them** (onboarding answers, corrections): they
 *   have no exchange in the session to be deleted with.
 *
 * ## The current session can be deleted
 *
 * Its next turn is stamped with it as before, since the session row stays.
 * Nothing else needs saying to it:
 *
 * - **The recap.** With the session's recap gone and nothing said in it, the
 *   recap is owed again (`recap.ts`), so the next load offers a fresh one from
 *   what is left, as after any recap deletion.
 * - **When it closes.** A session is closed lazily at its last activity
 *   (`boundary.ts`). With its turns gone that is its own start, so the next
 *   arrival twelve hours after the session *began* closes it and opens another.
 *   That is the same rule a sitting with no turns has always had.
 * - **Its account.** Drafting skips a session with too few exchanges
 *   (`synopsis/draft.ts`), so an emptied session drafts nothing when it closes.
 *
 * ## One transaction, however long the session
 *
 * No batching. Deleting in batches would leave a session half deleted when a
 * batch failed, and the person told it was gone, which is the outcome §12
 * exists to prevent. A sitting is bounded by how fast a person can take turns
 * before going quiet for twelve hours, so its rows are hundreds, not hundreds
 * of thousands, well inside one statement's parameters. The transaction gets a longer timeout than the
 * default to cover the per-heading writes a long session's notes need.
 *
 * ## Refusals
 *
 * - **A session that is not the person's** gets a 404, the same 404 as one that
 *   does not exist, so the route cannot be used to learn that a session exists.
 * - **A turn still being answered** gets a 409 that says to wait
 *   (`planTurnDeletion`), and nothing is deleted. That includes the session's
 *   own recap, and a later one that looked back on it.
 *
 * A turn claimed after this reads the session's turns is not taken: it began
 * after the person asked, so it is not part of what they asked to delete.
 *
 * @see lib/app/memory/delete-turns.ts — the mechanism
 * @see lib/app/memory/delete-exchange.ts — one exchange, and what it takes
 * @see .context/app/slots.md — "Deleting a session"
 */

import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { NotFoundError } from '@/lib/api/errors';
import { forgetCachedContext } from '@/lib/app/slots/wipe';
import { readSessionsById } from '@/lib/app/sessions/store';
import { settleSynopsesOfDeletedExchanges } from '@/lib/app/journey-record/record';
import { readRecapsLookingBackOn } from '@/lib/app/conversation/recap-lookback';
import {
  OWNED_TURN_SELECT,
  applyTurnDeletion,
  planTurnDeletion,
} from '@/lib/app/memory/delete-turns';

/** How long the deletion's transaction may run: a long session wipes many headings. */
export const SESSION_DELETION_TIMEOUT_MS = 30_000;

export interface SessionDeletion {
  userId: string;
  /** The `session.started` row's id. */
  sessionId: string;
  /** Remove the session's kept account too. Unticked, it is flagged instead. */
  removeAccount: boolean;
}

/** What became of the session's account. */
export type SessionAccountOutcome =
  /** It had none, or only a draft, which always goes. */
  | 'none'
  /** The kept account was removed with it. */
  | 'removed'
  /** The kept account stays, flagged as written from something since deleted. */
  | 'flagged';

/** What a deletion did. */
export interface DeletedSession {
  /** The session's turns, its own recap among them. */
  exchanges: number;
  messages: number;
  /** Note versions made placeholders. Logged, never sent: see the route. */
  versions: number;
  /** Later recaps that looked back on it, taken with it. */
  recaps: number;
  account: SessionAccountOutcome;
}

/**
 * Delete one of the person's sessions, with everything derived from it, in one
 * transaction.
 */
export async function deleteSession(input: SessionDeletion): Promise<DeletedSession> {
  const { userId, sessionId } = input;
  const sessions = await readSessionsById(userId, [sessionId]);
  if (!sessions.has(sessionId)) {
    throw new NotFoundError('That session could not be found.');
  }

  const turns = await prisma.appTurn.findMany({
    where: { userId, sessionId },
    select: OWNED_TURN_SELECT,
  });
  const own = new Set(turns.map((turn) => turn.id));
  // The recaps that looked back on it. Its own recap looked back on the one
  // before, and is one of its turns already.
  const recaps = (await readRecapsLookingBackOn(userId, [sessionId])).filter(
    (recap) => !own.has(recap.id)
  );
  const plan = await planTurnDeletion(userId, [...turns, ...recaps]);

  const removedAt = new Date();
  const result = await executeTransaction(
    async (tx) => {
      const applied = await applyTurnDeletion(tx, plan, removedAt);
      let account: SessionAccountOutcome = 'none';
      if (input.removeAccount) {
        // The account's vector cascades with its row.
        const kept = await tx.appJourneyEntry.deleteMany({
          where: { userId, kind: 'synopsis', sessionId, state: 'kept' },
        });
        if (kept.count > 0) account = 'removed';
      }
      // A draft goes, and a kept account still here is flagged, unless an
      // earlier deletion already flagged it.
      await settleSynopsesOfDeletedExchanges(tx, {
        userId,
        sessionIds: [sessionId],
        at: removedAt,
      });
      if (account === 'none') {
        const stays = await tx.appJourneyEntry.count({
          where: { userId, kind: 'synopsis', sessionId, state: 'kept' },
        });
        if (stays > 0) account = 'flagged';
      }
      return { ...applied, account };
    },
    { timeout: SESSION_DELETION_TIMEOUT_MS }
  );

  forgetCachedContext(userId);
  return {
    exchanges: Math.max(0, result.turns - recaps.length),
    messages: result.messages,
    versions: result.versions,
    recaps: recaps.length,
    account: result.account,
  };
}
