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
 * told one is already being written. A call that fails gives its try back.
 *
 * **What was deleted stays deleted.** An exchange deleted while the model was
 * writing removes the draft it was written from (`lostExchanges`), as deleting
 * one removes a stored draft.
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
  removeSynopsisDraft,
  replaceSynopsisDraft,
} from '@/lib/app/journey-record/record';
import { askForDraft } from '@/lib/app/journey-record/synopsis/draft';
import {
  lostExchanges,
  MIN_SYNOPSIS_EXCHANGES,
  readSessionLines,
  readSessionTurns,
  type SessionTurn,
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

  let reply: SynopsisReply;
  let turns: SessionTurn[];
  try {
    turns = await readSessionTurns(userId, stored.sessionId);
    const { readable, lines } = await readSessionLines(userId, turns);
    // Deleting an exchange removes a draft (`settleSynopsesOfDeletedExchanges`),
    // so this is a session thinned some other way: nothing to write from.
    if (readable < MIN_SYNOPSIS_EXCHANGES) {
      await refundRegeneration(userId, id, lease);
      throw new ConflictError('There’s too little of this session left to write it again.', {
        reason: 'not_substantial',
      });
    }
    reply = await askForDraft(userId, seat.agent, lines, {
      previous: { summary: entry.summary ?? '', body: entry.body },
      steer,
    });
  } catch (err) {
    if (err instanceof APIError) throw err;
    await refundRegeneration(userId, id, lease);
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
  // An exchange deleted while the model was writing: the draft may quote it.
  if (await lostExchanges(userId, stored.sessionId, turns)) {
    await removeSynopsisDraft(userId, stored.sessionId);
    throw new ConflictError(
      'Part of this session was deleted while the new draft was written, so it was not kept.',
      { reason: 'changed_meanwhile' }
    );
  }
  logger.info('Synopsis regenerated', { userId, entryId: id, steered: steer !== null });
  return (await readOwnSynopsis(userId, id)).entry;
}
