/**
 * Another draft of a synopsis, when the person asks for one
 * (f-journey-record t-147; product description §3.16).
 *
 * The draft is the app's account, and the person may not recognise it. They
 * can ask for another, and say why ("shorter", "you missed the part about my
 * father"). The new draft replaces the old one; it is still a draft, and still
 * theirs to keep, change or discard.
 *
 * **The same call as the first draft** (`draft.ts` → `askForDraft`), written
 * from the same session, with the last draft and their steer added to the
 * prompt (`prompt.ts`). Gated and charged as a draft is (`seat.ts`). The
 * modules and notes are not drafted again: they were derived from the session,
 * not written, and a different wording changes neither.
 *
 * **Capped**, at {@link MAX_SYNOPSIS_REGENERATIONS} per draft. A try is taken
 * with a lease before the model is called (`claimRegeneration`), so a second
 * submit, at once or while the first is being written, calls nothing and is
 * told one is already being written. The cap counts calls to the model, so a
 * try is given back only when the model was never asked; a call that fails
 * still spends it, or a steer that always fails could call it without end.
 *
 * **What was deleted stays deleted.** The draft's row exists throughout, so
 * deleting an exchange meanwhile removes it in the deletion's own transaction,
 * and this finds nothing to replace.
 *
 * @see .context/app/journey-record.md — "Keeping a synopsis"
 */

import { APIError, ConflictError } from '@/lib/api/errors';
import { logger } from '@/lib/logging';
import { MAX_SYNOPSIS_REGENERATIONS, type JourneyEntry } from '@/lib/app/journey-record/entry';
import {
  claimRegeneration,
  readOwnSynopsis,
  refundRegeneration,
  releaseRegeneration,
  replaceSynopsisDraft,
} from '@/lib/app/journey-record/record';
import { askForDraft } from '@/lib/app/journey-record/synopsis/draft';
import {
  MIN_SYNOPSIS_EXCHANGES,
  readSessionLines,
  readSessionTurns,
  type SessionLine,
} from '@/lib/app/journey-record/synopsis/material';
import type { SynopsisReply } from '@/lib/app/journey-record/synopsis/prompt';
import { openSeat, type SeatRefusal } from '@/lib/app/journey-record/synopsis/seat';

/**
 * Why the seat would not draft, in words the person reads. Lelañea by name,
 * as the notes panel's refusals are.
 */
const REFUSALS: Record<SeatRefusal, string> = {
  paused: 'Lelañea isn’t writing anything new just now. Try again later.',
  ceiling_reached: 'You’ve used this month’s allowance, so Lelañea can’t write another draft yet.',
  no_agent: 'Lelañea can’t write another draft just now. Try again later.',
};

/**
 * Write another draft of one of the person's synopses, and return it.
 * Another person's synopsis answers 404, as one that never existed.
 */
export async function regenerateSynopsis(
  userId: string,
  id: string,
  steer: string | null,
  now: Date = new Date()
): Promise<JourneyEntry> {
  const stored = await readOwnSynopsis(userId, id);
  const { entry } = stored;
  if (entry.state !== 'draft') {
    throw new ConflictError('This account is already kept. Change it rather than redraft it.', {
      reason: 'not_a_draft',
    });
  }
  if (stored.regenerations >= MAX_SYNOPSIS_REGENERATIONS) {
    throw new ConflictError(
      'That’s as many drafts as Lelañea writes of one session. Change this one in your own words.',
      { reason: 'no_more_drafts' }
    );
  }

  const seat = await openSeat(userId, now);
  if ('refused' in seat) {
    throw new ConflictError(REFUSALS[seat.refused], { reason: seat.refused });
  }

  if (!(await claimRegeneration(userId, id, { regenerations: stored.regenerations, now }))) {
    throw new ConflictError('Another draft of this is already being written.', {
      reason: 'regenerating',
    });
  }
  // The lease this redraft holds: every later write is conditional on it.
  const lease = now;

  // Read before the model is asked: a failure here gives the try back.
  let lines: SessionLine[];
  try {
    const turns = await readSessionTurns(userId, stored.sessionId);
    const read = await readSessionLines(userId, turns);
    lines = read.lines;
    // Deleting an exchange removes a draft (`settleSynopsesOfDeletedExchanges`),
    // so this is a session thinned some other way: nothing to write from.
    if (read.readable < MIN_SYNOPSIS_EXCHANGES) {
      throw new ConflictError('There’s too little of this session left to write it again.', {
        reason: 'not_substantial',
      });
    }
  } catch (err) {
    await refundRegeneration(userId, id, lease);
    throw err;
  }

  let reply: SynopsisReply;
  try {
    reply = await askForDraft(userId, seat.agent, lines, {
      previous: { summary: entry.summary ?? '', body: entry.body },
      steer,
    });
  } catch (err) {
    // The model was asked, so the try is spent, as the cap counts calls; only
    // the lease is given back. A refund here would let a steer that always
    // fails call the model without end.
    await releaseRegeneration(userId, id, lease);
    // Never the steer or the reply: they are the person's words, and an account of them.
    logger.warn('Synopsis regeneration failed; the draft is unchanged', {
      userId,
      entryId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new APIError(
      'Lelañea couldn’t write another draft just now. Try again.',
      'SERVICE_UNAVAILABLE',
      503,
      { reason: 'failed' }
    );
  }

  if (!(await replaceSynopsisDraft(userId, id, reply, lease))) {
    // Removed, or its lease taken over, while it was being written.
    throw new ConflictError('This account was kept or removed while the new draft was written.', {
      reason: 'changed_meanwhile',
    });
  }

  logger.info('Synopsis regenerated', { userId, entryId: id, steered: steer !== null });
  return (await readOwnSynopsis(userId, id)).entry;
}
