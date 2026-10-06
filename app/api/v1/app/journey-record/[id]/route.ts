/**
 * One entry in my journey record (f-journey-record t-145).
 *
 * - `PATCH /api/v1/app/journey-record/:id`: `{ body?, summary?,
 *   withheldFromAgent? }`, a change to one of my own entries. A synopsis
 *   answers 409: it is changed by keeping it (t-147), never edited here.
 * - `DELETE /api/v1/app/journey-record/:id`: remove any entry, own or
 *   synopsis, kept or draft, words and all (§12).
 *
 * Another person's entry id answers 404, the same as one that never existed.
 *
 * Authentication: required. Rate limiting: the `/api/v1/**` section cap.
 *
 * @see lib/app/journey-record/record.ts
 */

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { withAuth } from '@/lib/auth/guards';
import { editOwnEntry, removeJourneyEntry } from '@/lib/app/journey-record/record';
import { JOURNEY_RECORD_OWNERSHIP } from '@/lib/app/journey-record/ownership';
import { journeyEntryIdSchema, ownEntryEditSchema } from '@/lib/app/journey-record/validation';

export const PATCH = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const { id: raw } = await params;
  const id = validatePathParam(raw, journeyEntryIdSchema, { label: 'entry id' });
  const edit = await validateRequestBody(request, ownEntryEditSchema);
  const entry = await editOwnEntry(session.user.id, id, edit);

  // Which fields changed, never what to.
  log.info('Own journey entry changed', {
    userId: session.user.id,
    entryId: id,
    fields: Object.entries(edit).flatMap(([field, value]) => (value === undefined ? [] : [field])),
  });

  return successResponse(entry);
}, JOURNEY_RECORD_OWNERSHIP);

export const DELETE = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const { id: raw } = await params;
  const id = validatePathParam(raw, journeyEntryIdSchema, { label: 'entry id' });
  const removed = await removeJourneyEntry(session.user.id, id);

  log.info('Journey entry removed by the person it is about', {
    userId: session.user.id,
    entryId: id,
    kind: removed.kind,
  });

  return successResponse(removed);
}, JOURNEY_RECORD_OWNERSHIP);
