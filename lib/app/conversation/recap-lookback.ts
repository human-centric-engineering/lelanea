/**
 * The recaps that looked back on a session (f-recap t-151; §12 "Deletion is
 * real").
 *
 * A recap (`recap.ts`) is a stored assistant message in the facilitator
 * conversation, and the model reads it as history. With no kept account of the
 * session it looked back on, it is written from the person's own words in that
 * session and may repeat them ("last time you said…"). So deleting an exchange
 * the recap drew on has to take the recap, or the deleted words stay in what
 * the AI reads. Owner ruling, 7 Oct 2026 (journal on `f-forget-session`,
 * ruling 3).
 *
 * A recap's turn is keyed on the session it opened (`recapTurnId`), not the one
 * it looked back on. That one is named by its account (`app_turn.recap.since`:
 * when the session looked back on began), so this reads the sessions' starts
 * and matches them.
 *
 * ## Which recaps
 *
 * - **Every recap whose account looks back on one of the sessions**, whatever
 *   it drew on. One drawn from the kept account of the session goes too, even
 *   though deleting an exchange only flags that account (t-147): the account
 *   may quote the deleted exchange, and so may a recap written from it. The
 *   flag stops the next recap drawing on it (`readKeptSynopsisOfSession`); this
 *   takes the one already written.
 * - **Only those drawn from the kept account**, when it is the account itself
 *   being removed (`drewOn: 'synopsis'`). A recap written from the person's
 *   words never read it.
 * - **A recap with no account it can read**, if it was claimed after the
 *   earliest of the sessions began. Its account is written as its run begins
 *   and is logged when it cannot be; with none, nothing says what it looked
 *   back on. Taking a recap that did not need to go costs the AI's opening
 *   words, never the person's; keeping one that quoted a deletion breaks §12.
 *
 * A crisis or safety turn is never a recap, so this cannot reach one.
 *
 * ## The recaps given a note
 *
 * A recap is also given the notes captured since the session it looked back
 * on, and may say them back. So removing a note takes every recap whose
 * account lists its heading (f-recap t-156; owner ruling, 7 Oct 2026, journal
 * on `f-recap`): {@link readRecapsGivenNote}. Keeping the recap and scrubbing
 * only the heading was rejected, because the recap is the AI restating the
 * note, not the person's own conversation.
 *
 * @see lib/app/memory/delete-exchange.ts — the deletion that takes them
 * @see lib/app/memory/delete-session.ts — a whole session's
 * @see lib/app/journey-record/record.ts — `removeJourneyEntry`
 * @see lib/app/journey-record/keep.ts — changing a kept account
 * @see lib/app/slots/delete-note.ts — removing a note
 */

import { prisma } from '@/lib/db/client';
import { RECAP_TURN_ID_PREFIX } from '@/lib/app/conversation/opening-id';
import {
  parseRecapAccount,
  recapNoteHeading,
  type RecapAccount,
} from '@/lib/app/conversation/recap-account';
import { OWNED_TURN_SELECT, type OwnedTurn } from '@/lib/app/memory/delete-turns';

/** Every recap turn of the person's, with the account it keeps. */
function readRecapTurns(userId: string) {
  return prisma.appTurn.findMany({
    where: { userId, turnId: { startsWith: RECAP_TURN_ID_PREFIX } },
    select: { ...OWNED_TURN_SELECT, recap: true },
  });
}

/**
 * The person's recap turns that were given the note under `slotSlug`: every one
 * whose account lists its heading. A recap with no account it can read is taken
 * if it was claimed after `firstCapturedAt`, when the note's first version was
 * captured: before that it could not have been given it, and after it nothing
 * says it was not. Wrongly taking one costs the AI's opening words; wrongly
 * keeping one breaks §12.
 *
 * Read with the heading as the note had it **before** removal, since a heading
 * the AI coined moves to an opaque slug as the note goes.
 */
export async function readRecapsGivenNote(
  userId: string,
  slotSlug: string,
  firstCapturedAt: Date
): Promise<OwnedTurn[]> {
  const heading = recapNoteHeading(slotSlug);
  const recaps = await readRecapTurns(userId);
  return recaps
    .filter((turn) => {
      const account = parseRecapAccount(turn.recap);
      if (account === null) return turn.startedAt.getTime() > firstCapturedAt.getTime();
      return account.notes.includes(heading);
    })
    .map(({ recap: _recap, ...turn }) => turn);
}

export interface RecapLookback {
  /** Only recaps drawn from this. Omitted: every recap, whatever it drew on. */
  drewOn?: RecapAccount['source'];
}

/**
 * The person's recap turns that looked back on any of these sessions (each the
 * id of its `session.started` row). Read for this person only: a session id
 * that is not theirs finds no start, so it reaches nothing.
 */
export async function readRecapsLookingBackOn(
  userId: string,
  sessionIds: readonly (string | null)[],
  options: RecapLookback = {}
): Promise<OwnedTurn[]> {
  const ids = [...new Set(sessionIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return [];
  const starts = await prisma.journeyEvent.findMany({
    where: { id: { in: ids }, userId },
    select: { occurredAt: true },
  });
  if (starts.length === 0) return [];
  const began = new Set(starts.map((start) => start.occurredAt.getTime()));
  const earliest = Math.min(...began);

  const recaps = await readRecapTurns(userId);
  return recaps
    .filter((turn) => {
      const account = parseRecapAccount(turn.recap);
      if (account === null) return turn.startedAt.getTime() > earliest;
      return (
        began.has(Date.parse(account.since)) &&
        (options.drewOn === undefined || account.source === options.drewOn)
      );
    })
    .map(({ recap: _recap, ...turn }) => turn);
}
