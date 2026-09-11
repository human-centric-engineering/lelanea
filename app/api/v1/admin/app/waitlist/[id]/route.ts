/**
 * Waitlist — take someone off the list, or put them back (Admin)
 *
 * PATCH /api/v1/admin/app/waitlist/:id
 *
 * Authentication: admin, as for the list and the export.
 *
 * Request body: `{ "removed": true }` to take them off, `{ "removed": false }` to
 * put them back. Responds with the updated entry, 404 for an id nothing matches,
 * 400 for a body that is neither.
 *
 * ## Why PATCH and not DELETE
 *
 * `DELETE` is the obvious verb and it is the wrong one here. Nothing is deleted:
 * the row survives holding the person's email, their name and what they said
 * they wanted, and all that moves is `removedAt`. On this surface that
 * distinction decides a GDPR answer — removal is a product state, erasure is
 * `eraseUser()` and hard-deletes the row — so a verb that claims a deletion is a
 * verb that will eventually be read as having performed one.
 *
 * It also makes the restore symmetrical. One route, one schema, one state to
 * reach, rather than `DELETE` plus an invented `POST …/restore`.
 *
 * ## The state to reach, not a toggle
 *
 * The body says what the entry should BE. A toggle would leave two admins acting
 * on the same row in the same minute with whichever state arrived last, and a
 * double-clicked button would undo itself. `{ removed: true }` twice is the same
 * as once.
 *
 * ## Rate limiting
 *
 * Nothing here. `proxy.ts` applied the `admin` section tier before the handler
 * ran (`/api/v1/admin/` is a prefix match, so a new admin route inherits it),
 * and flipping one column on one row is not the expensive act the export's
 * per-flow sub-cap exists for.
 *
 * ## The log line
 *
 * The entry id and which way it moved — not the address, and not the answers.
 * It uses the same logger as the list and the export
 * (`_shared/route-logger.ts`), which leaves the request URL off. Note what that
 * does and does not cover here: the id is in the PATH, so `endpoint` carries it,
 * and that is fine — an entry id is an opaque cuid we generated, not personal
 * data a stranger typed. What the shared logger keeps out is the query string,
 * where the search term lives.
 *
 * @see lib/app/waitlist/admin.ts · .context/app/waitlist.md
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { cuidSchema } from '@/lib/validations/common';
import { waitlistRemovalSchema } from '@/lib/validations/app-waitlist';
import { setWaitlistEntryRemoved } from '@/lib/app/waitlist/admin';
import { getWaitlistRouteLogger } from '@/app/api/v1/admin/app/waitlist/_shared/route-logger';

export const PATCH = withAdminAuth<{ id: string }>(async (request, _session, { params }) => {
  const log = await getWaitlistRouteLogger(request);

  // Next.js 16: `params` is a promise.
  const { id: rawId } = await params;
  const id = validatePathParam(rawId, cuidSchema, { label: 'waitlist entry id' });

  const { removed } = await validateRequestBody(request, waitlistRemovalSchema);

  const entry = await setWaitlistEntryRemoved(id, removed);

  if (!entry) {
    // A 404 rather than a cheerful 200: an admin who clicked Remove on a row that
    // had already gone needs to know the click did nothing.
    throw new NotFoundError('Waitlist entry not found');
  }

  log.info(removed ? 'Waitlist entry removed' : 'Waitlist entry restored', {
    entryId: id,
    removed,
  });

  return successResponse(entry);
});
