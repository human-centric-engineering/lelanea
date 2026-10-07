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
 *   them (`ai_message_embedding`), and so do the person's own vectors in the
 *   memory index (`memory-index.ts`, t-129).
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
 * - **Its session's synopsis, if it was only a draft** (owner ruling, 6 Oct
 *   2026, at t-147). A kept synopsis is flagged instead, so the person can
 *   change or remove their account themselves
 *   (`settleSynopsesOfDeletedExchanges`, `journey-record/record.ts`).
 * - **The recaps that looked back on its session** (f-recap t-151; owner
 *   ruling, 7 Oct 2026). A recap is a stored assistant message the model reads
 *   as history, and it may repeat what the person said in the session it looked
 *   back on. Each goes as an exchange does, its reply as its window, in the
 *   same transaction (`recap-lookback.ts` says which).
 * - **The person's cached context blocks**, as a removal does.
 *
 * The mechanism, shared with the other deletions of the person's turns, is
 * `delete-turns.ts`.
 *
 * ## The stopgap write
 *
 * Wiping a version writes Daybreak's `framework_slot_value` directly. It is the
 * same write t-78's removal makes, under the same owner ruling and the same
 * divergence row (`.context/app/divergences.md`), and it goes when Daybreak
 * ships a per-value removal (daybreak#286).
 *
 * @see lib/app/slots/wipe.ts — the placeholder write
 * @see lib/app/memory/delete-turns.ts — the mechanism
 * @see .context/app/slots.md — "Deleting an exchange"
 */

import { executeTransaction } from '@/lib/db/utils';
import { NotFoundError } from '@/lib/api/errors';
import { forgetCachedContext } from '@/lib/app/slots/wipe';
import { settleSynopsesOfDeletedExchanges } from '@/lib/app/journey-record/record';
import { readRecapsLookingBackOn } from '@/lib/app/conversation/recap-lookback';
import { isRecapTurnId } from '@/lib/app/conversation/opening-id';
import { applyTurnDeletion, planTurnDeletion, readOwnedTurns } from '@/lib/app/memory/delete-turns';

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
  /** Recaps that looked back on the exchanges' sessions, taken with them (t-151). */
  recaps: number;
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
 * - **A turn still being answered** gets a 409 (`planTurnDeletion`), and so
 *   does a recap that has to go with them while it is still being answered.
 */
export async function deleteExchanges(input: ExchangeDeletion): Promise<DeletedExchanges> {
  const ids = [...new Set(input.exchangeIds)];
  const turns = await readOwnedTurns(input.userId, ids);
  if (turns.length !== ids.length) {
    throw new NotFoundError('That part of the conversation could not be found.');
  }
  // The recaps that looked back on these sessions may repeat what was said in
  // them (t-151). A recap asked for is deleted as asked, and takes no other: a
  // recap is drawn from the person's words, never from an earlier recap.
  const asked = new Set(ids);
  const spoken = turns.filter((turn) => !isRecapTurnId(turn.turnId));
  const recaps = (
    await readRecapsLookingBackOn(
      input.userId,
      spoken.map((turn) => turn.sessionId)
    )
  ).filter((recap) => !asked.has(recap.id));
  const plan = await planTurnDeletion(input.userId, [...turns, ...recaps]);

  const removedAt = new Date();
  const result = await executeTransaction(async (tx) => {
    const applied = await applyTurnDeletion(tx, plan, removedAt);
    // The exchanges' sessions' synopses (t-147): a draft goes, a kept one is
    // flagged. Not a recap's own session, even for a recap asked for: a
    // synopsis is never drafted from a recap (`synopsis/material.ts`).
    await settleSynopsesOfDeletedExchanges(tx, {
      userId: input.userId,
      sessionIds: spoken.map((turn) => turn.sessionId),
      at: removedAt,
    });
    return applied;
  });

  forgetCachedContext(input.userId);
  return {
    // Every record deleted was asked for or one of the recaps.
    exchanges: Math.max(0, result.turns - recaps.length),
    messages: result.messages,
    versions: result.versions,
    recaps: recaps.length,
  };
}
