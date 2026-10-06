/**
 * Keep a synopsis in my journey record (f-journey-record t-147).
 *
 * - `POST /api/v1/app/journey-record/:id/keep`: `{ seen, confirm, edit? }`.
 *   `seen` is the entry's `updatedAt` as I was shown it, so a page that is out
 *   of date keeps nothing (409 `changed_meanwhile`); `confirm` is the notes
 *   the synopsis lists that are still ticked; `edit` is
 *   the account as I want it kept (`summary`, `body`, `outcomes`). Without an
 *   edit, a draft is kept as written. With one, it is kept as changed, and so
 *   is a synopsis already kept (§12: anything in the record can be edited).
 *   What it did to each listed note comes back beside the entry.
 *
 * Another person's entry id answers 404, the same as one that never existed.
 * A double submit keeps once and answers with the kept synopsis; a different
 * change arriving while one is being saved answers 409 `busy`.
 *
 * Authentication: required. Rate limiting: the `/api/v1/**` section cap, and
 * the journey record's sub-cap on every keep, because an edit, or a keep that
 * finishes an earlier one, is read by a model and charged to the person.
 *
 * @see lib/app/journey-record/keep.ts
 */

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { withAuth } from '@/lib/auth/guards';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { keepSynopsis } from '@/lib/app/journey-record/keep';
import { JOURNEY_RECORD_OWNERSHIP } from '@/lib/app/journey-record/ownership';
import { synopsisCallKey, synopsisCallLimiter } from '@/lib/app/journey-record/rate-limit';
import { journeyEntryIdSchema, synopsisKeepSchema } from '@/lib/app/journey-record/validation';

export const POST = withAuth<{ id: string }>(
  async (request, session, { params }) => {
    const log = await getRouteLogger(request);
    const { id: raw } = await params;
    const id = validatePathParam(raw, journeyEntryIdSchema, { label: 'entry id' });
    const body = await validateRequestBody(request, synopsisKeepSchema);

    // Every keep: an edit is re-read by a model, and so is a plain keep that
    // finishes a re-read an earlier keep could not run.
    const limit = synopsisCallLimiter.check(synopsisCallKey(session.user.id));
    if (!limit.success) return createRateLimitResponse(limit);

    const kept = await keepSynopsis(session.user.id, id, body);

    // What happened, never what was said.
    log.info('Synopsis kept by the person it is about', {
      userId: session.user.id,
      entryId: id,
      edited: body.edit !== undefined,
      // Each listed note's outcome, never its slot or its reading.
      notes: kept.notes.map((note) => note.outcome),
      notesUnread: kept.notesUnread,
    });

    return successResponse(kept);
  },
  { ownership: JOURNEY_RECORD_OWNERSHIP }
);
