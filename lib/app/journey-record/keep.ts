/**
 * Keeping a synopsis: approve it as written, or change it first, or change it
 * after (f-journey-record t-147; product description §3.16, §12).
 *
 * A draft is only the app's opinion of what happened. Nothing enters the
 * record over the person's head, and keeping is also their strongest lever
 * over what the app believes about them: the draft lists the visible notes its
 * session wrote, and keeping says which of those are right.
 *
 * ## What keeping does to the notes
 *
 * Owner rulings 2 and 3 at planning, and the ruling at t-147 on how an edit
 * reaches the notes (journal on `f-journey-record`).
 *
 * - **Approve**: every listed note still ticked is confirmed, in
 *   `correctNote`'s shape: a new version holding the same reading,
 *   `user_confirmed` at confidence 10. One already confirmed that way is left
 *   alone, so keeping twice writes nothing twice.
 * - **Edit**: the changed account is re-read against each ticked note
 *   (`synopsis/reread.ts`). A note it says something different about is
 *   corrected to what it says; one it agrees with, or does not speak to, is
 *   confirmed as on approve. The person ticked it, and the edit did not
 *   contradict it.
 * - **An unticked note is left exactly as it was.**
 * - **Only a note still as the session left it is touched.** A ticked note
 *   whose current version is not the one listed has moved on since (a later
 *   session, the person's own correction, a removal), and confirming the
 *   newer reading would confirm something the account never listed.
 * - **Hidden, special-category, withheld, removed and retired notes are never
 *   touched.** They are never listed either (`material.ts`), but a slot can be
 *   reclassified after drafting, so this asks again: the notes panel's read
 *   (`getNotes`) must offer the note as correctable, and `correctNote` refuses
 *   on its own terms beside it.
 *
 * **An edit whose re-read cannot run is still kept.** The text is the
 * person's, so a paused install, a spent ceiling, an empty seat or a failed
 * call never stops them keeping it. Their notes are then left alone, since
 * confirming them would confirm what the edit may contradict, and the response
 * says the notes were not read.
 *
 * ## Changing a kept synopsis
 *
 * §12: anything in the record can be edited. The entry routes refuse a
 * synopsis, so a change to a kept one comes here and the notes follow the text
 * the same way. After keeping, a synopsis lists only the notes it confirmed, at
 * the versions it left them, so a later change re-reads exactly those.
 *
 * ## Once
 *
 * The keep is one conditional write (`claimSynopsisKeep`), made before any
 * note is touched. It takes a lease on the synopsis and records what its notes
 * are owed. Of two submits, one matches and one matches nothing; the loser
 * finds the synopsis already kept with that text, and answers with it having
 * written nothing. A different change arriving while one is settling meets the
 * lease and is told to try again; it never races the first one's notes.
 *
 * **Finished, never forgotten.** The notes are settled after the keep is
 * claimed, in writes of their own, so a failure between the two leaves a kept
 * synopsis whose notes are still owed. That is recorded (`notesPending`), and
 * the next keep of it, even one changing nothing, finishes the work: confirming
 * the ticked notes, or re-reading the kept text first when that is what was
 * owed. A note confirmed before the failure has moved on by then, and is no
 * longer listed.
 *
 * @see .context/app/journey-record.md — "Keeping a synopsis"
 */

import { APIError, ConflictError } from '@/lib/api/errors';
import { logger } from '@/lib/logging';
import { getSlotHeads, SLOT_SOURCE_TYPE } from '@/lib/framework/data-slots';
import type { Note } from '@/lib/app/slots/notes-view';
import { CORRECTION_CONFIDENCE, correctNote, getNotes } from '@/lib/app/slots/notes';
import type { JourneyEntry, JourneyNoteRef } from '@/lib/app/journey-record/entry';
import {
  claimSynopsisKeep,
  finishSynopsisKeep,
  readOwnSynopsis,
  releaseSynopsisKeep,
  type SynopsisText,
} from '@/lib/app/journey-record/record';
import { openSeat, type SeatRefusal } from '@/lib/app/journey-record/synopsis/seat';
import { rereadNotes, type RereadResult } from '@/lib/app/journey-record/synopsis/reread';

/** Stored against a note keeping confirmed, where the notes panel prints how it was made. */
export const KEPT_CONFIRMATION_NOTE =
  'The person confirmed this when they kept the account of a session.';

/** Stored against a note an edited account corrected. */
export const KEPT_CORRECTION_NOTE =
  'The person’s account of a session, as they kept it, says this instead.';

/** What the person sends to keep a synopsis. */
export interface SynopsisKeep {
  /**
   * The entry's `updatedAt` as the person was shown it. Keeping is
   * conditional on it, so a stale page can never keep a draft the person did
   * not read (one redrafted since in another tab, say).
   */
  seen: Date;
  /** The listed notes still ticked. Anything here the synopsis does not list is ignored. */
  confirm: JourneyNoteRef[];
  /** Their changes to the account. Absent: kept as written. */
  edit?: SynopsisText;
}

/** What keeping did to one note the synopsis lists. */
export type KeptNoteOutcome =
  | 'confirmed'
  | 'corrected'
  /** Already confirmed by the person at this version: nothing to write. */
  | 'already_confirmed'
  | 'unticked'
  /** Its current version is not the one listed: it has moved on since. */
  | 'moved_on'
  /** Hidden, special-category, withheld, removed or retired now. */
  | 'not_confirmable'
  /** The edit could not be read against it, so it was left alone. */
  | 'unread';

export interface KeptSynopsis {
  entry: JourneyEntry;
  /** One per listed note. Empty when nothing was written: a double submit. */
  notes: { slotSlug: string; outcome: KeptNoteOutcome }[];
  /** Why an edit was not read against the notes. Null when it was, or nothing needed reading. */
  notesUnread: SeatRefusal | 'failed' | null;
}

const sameRef = (a: JourneyNoteRef, b: JourneyNoteRef): boolean =>
  a.slotSlug === b.slotSlug && a.version === b.version;

function sameText(entry: JourneyEntry, text: SynopsisText): boolean {
  return (
    entry.summary === text.summary &&
    entry.body === text.body &&
    JSON.stringify(entry.outcomes) === JSON.stringify(text.outcomes)
  );
}

/**
 * Whether keeping may write to this note: one the panel would let the person
 * correct (`correctable` already excludes removed, retired and special-category
 * notes), holding words rather than the special-category sentinel.
 */
function confirmable(note: Note): boolean {
  return note.correctable && !note.withheld;
}

/** The person confirmed it at full confidence already: writing it again would add nothing. */
function alreadyConfirmed(note: Note): boolean {
  return (
    note.sourceType === SLOT_SOURCE_TYPE.user_confirmed && note.confidence === CORRECTION_CONFIDENCE
  );
}

/**
 * Read the edited account against the ticked notes, or say why it was not.
 * Gated and charged as a draft is.
 */
async function reread(
  userId: string,
  text: SynopsisText,
  notes: readonly Note[],
  now: Date
): Promise<{ readings: Map<string, RereadResult> } | { unread: SeatRefusal | 'failed' }> {
  try {
    // Inside the try: a read error deciding whether to ask is a re-read that
    // could not run, not a keep that failed.
    const seat = await openSeat(userId, now);
    if ('refused' in seat) return { unread: seat.refused };
    const readings = await rereadNotes(
      userId,
      seat.agent,
      text,
      notes.map((note) => ({ slotSlug: note.slotSlug, asking: note.asking, value: note.value }))
    );
    return { readings };
  } catch (err) {
    // Never the account or the readings: they are the person's words.
    logger.warn('Synopsis re-read failed; its notes were left alone', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { unread: 'failed' };
  }
}

/**
 * Write what keeping does to each listed note, and say what it did. Called
 * once the keep is claimed, so only one submit ever reaches here.
 */
async function settleNotes(
  userId: string,
  listed: readonly JourneyNoteRef[],
  ticked: readonly JourneyNoteRef[],
  text: SynopsisText | null,
  now: Date
): Promise<{
  outcomes: KeptSynopsis['notes'];
  kept: JourneyNoteRef[];
  notesUnread: KeptSynopsis['notesUnread'];
}> {
  if (ticked.length === 0) {
    return {
      outcomes: listed.map((ref) => ({ slotSlug: ref.slotSlug, outcome: 'unticked' as const })),
      kept: [],
      notesUnread: null,
    };
  }

  const { notes } = await getNotes(userId);
  const bySlug = new Map(notes.map((note) => [note.slotSlug, note]));
  const actionable = ticked.flatMap((ref) => {
    const note = bySlug.get(ref.slotSlug);
    return note && note.version === ref.version && confirmable(note) ? [note] : [];
  });

  let readings: Map<string, RereadResult> | null = null;
  let notesUnread: KeptSynopsis['notesUnread'] = null;
  if (text && actionable.length > 0) {
    const read = await reread(userId, text, actionable, now);
    if ('unread' in read) notesUnread = read.unread;
    else readings = read.readings;
  }

  const outcomes: KeptSynopsis['notes'] = [];
  const kept: JourneyNoteRef[] = [];
  for (const ref of listed) {
    const outcome = await settleNote(userId, ref, {
      ticked: ticked.some((other) => sameRef(other, ref)),
      note: bySlug.get(ref.slotSlug),
      reading: readings?.get(ref.slotSlug) ?? null,
      unread: notesUnread !== null,
    });
    outcomes.push({ slotSlug: ref.slotSlug, outcome: outcome.outcome });
    if (outcome.ref) kept.push(outcome.ref);
  }
  return { outcomes, kept, notesUnread };
}

/** One note's part in keeping, and the reference the kept synopsis lists for it after. */
async function settleNote(
  userId: string,
  ref: JourneyNoteRef,
  at: { ticked: boolean; note: Note | undefined; reading: RereadResult | null; unread: boolean }
): Promise<{ outcome: KeptNoteOutcome; ref: JourneyNoteRef | null }> {
  if (!at.ticked) return { outcome: 'unticked', ref: null };
  const note = at.note;
  if (!note || !confirmable(note)) return { outcome: 'not_confirmable', ref: null };
  if (note.version !== ref.version) return { outcome: 'moved_on', ref: null };
  // Left listed at the version it is, so a later change can read it again.
  if (at.unread) return { outcome: 'unread', ref };

  const differs = at.reading?.verdict === 'differs' ? at.reading.value : null;
  if (differs === null && alreadyConfirmed(note)) return { outcome: 'already_confirmed', ref };
  // Read again just before writing: a re-read can take minutes, and a turn
  // may have written a newer reading meanwhile, which this must not bury.
  const [head] = await getSlotHeads(userId, { slotSlugs: [note.slotSlug] });
  if (head?.version !== ref.version) return { outcome: 'moved_on', ref: null };
  try {
    const written = await correctNote({
      userId,
      slotSlug: note.slotSlug,
      value: differs ?? note.value,
      reasoningNote: differs === null ? KEPT_CONFIRMATION_NOTE : KEPT_CORRECTION_NOTE,
    });
    return {
      outcome: differs === null ? 'confirmed' : 'corrected',
      ref: { slotSlug: written.slotSlug, version: written.version },
    };
  } catch (err) {
    // Anything but `correctNote`'s own refusals (gone, retired, special
    // category) is a failure, not a verdict: it fails the keep, which leaves
    // the notes owed for the next one rather than dropping this one's tick.
    if (!(err instanceof APIError)) throw err;
    logger.warn('A note could not be confirmed on keeping', {
      userId,
      slotSlug: note.slotSlug,
      error: err instanceof Error ? err.message : String(err),
    });
    return { outcome: 'not_confirmable', ref: null };
  }
}

/**
 * Keep one of the person's synopses, or change one they have kept, and settle
 * its notes. Another person's synopsis answers 404, as one that never existed.
 */
export async function keepSynopsis(
  userId: string,
  id: string,
  input: SynopsisKeep,
  now: Date = new Date()
): Promise<KeptSynopsis> {
  const stored = await readOwnSynopsis(userId, id, now);
  const { entry } = stored;
  const edit = input.edit && !sameText(entry, input.edit) ? input.edit : null;

  // Kept already, nothing to change and nothing owed: a second submit of the
  // same keep. A keep that failed half way still owes its notes, and this one
  // finishes it.
  if (entry.state === 'kept' && !edit && stored.notesPending === null) {
    return { entry, notes: [], notesUnread: null };
  }

  const listed = entry.notes;
  const ticked = listed.filter((ref) => input.confirm.some((other) => sameRef(other, ref)));
  // Owed a re-read when the text changed, now or in a keep that never read it.
  const pending = edit || stored.notesPending === 'reread' ? 'reread' : 'confirm';

  const claimed = await claimSynopsisKeep(userId, id, {
    from: entry.state,
    // What the person was shown, not what this request read: a page that is
    // out of date matches nothing.
    updatedAt: input.seen,
    now,
    text: edit,
    // What it lists until its notes are settled: what was ticked, as listed.
    notes: ticked,
    pending,
  });
  if (!claimed) {
    // Someone else's submit got there first. If it kept what this one asks
    // for, this is a double submit, and its answer is the kept synopsis.
    const current = await readOwnSynopsis(userId, id, now);
    if (current.entry.state === 'kept' && (!input.edit || sameText(current.entry, input.edit))) {
      return { entry: current.entry, notes: [], notesUnread: null };
    }
    if (current.busy) {
      throw new ConflictError('This account is being saved. Try again in a moment.', {
        reason: 'busy',
      });
    }
    throw new ConflictError('This account changed while you were keeping it. Look again.', {
      reason: 'changed_meanwhile',
    });
  }

  const kept = edit ?? {
    summary: entry.summary ?? '',
    body: entry.body,
    outcomes: entry.outcomes,
  };
  let settled: Awaited<ReturnType<typeof settleNotes>>;
  try {
    settled = await settleNotes(userId, listed, ticked, pending === 'reread' ? kept : null, now);
  } catch (err) {
    // The text is kept and what its notes are owed is recorded; giving the
    // lease back lets the next keep finish them at once.
    await releaseSynopsisKeep(userId, id, now).catch(() => undefined);
    throw err;
  }
  let finished: boolean;
  try {
    finished = await finishSynopsisKeep(userId, id, {
      lease: now,
      notes: settled.kept,
      // An edit that could not be read is still owed its re-read.
      pending: settled.notesUnread ? 'reread' : null,
    });
  } catch (err) {
    await releaseSynopsisKeep(userId, id, now).catch(() => undefined);
    throw err;
  }
  if (!finished) {
    // Outlived its lease and was taken over: the keep that took it settles the
    // notes from what this one left them, so nothing is lost, but it is worth
    // knowing a keep ran that long.
    logger.warn('A synopsis keep outlived its lease', { userId, entryId: id });
  }
  const { entry: after } = await readOwnSynopsis(userId, id);
  return { entry: after, notes: settled.outcomes, notesUnread: settled.notesUnread };
}
