/**
 * The leaning bounds (Admin) — f-leanings t-138
 *
 * PUT /api/v1/admin/app/voice/overlays/set/leanings
 *
 * Body: `leanings` (every dial's furthest stop each way and whether the AI may
 * suggest moving it, plus the switch for all of them) and the `revision` read.
 * A bound that would hold a dial away from rest is refused 400. The bounds are
 * on the overlay set, so a save that changes them is a new revision of it and
 * returns it to `draft`; one that changes nothing writes nothing and records no
 * audit entry. 409 when the revision has moved.
 *
 * Nobody's stored leaning is rewritten: the leanings store clamps on read.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier. Audited with
 * the before and after.
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';
import { overlaySetLeaningsSaveSchema } from '@/lib/validations/app-voice-content';
import { updateLeaningBounds } from '@/lib/app/voice/overlays-admin';

export const PUT = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const { leanings, revision } = await validateRequestBody(request, overlaySetLeaningsSaveSchema);
  const outcome = await updateLeaningBounds(leanings, revision, session.user.id);

  log.info('Leaning bounds saved', { changed: outcome.changed, revision: outcome.revision });
  if (outcome.changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_voice_overlay_set.leanings_update',
      entityType: 'settings',
      entityId: 'app_voice_overlay_set',
      entityName: 'Voice overlays — the leaning bounds',
      changes: outcome.changes,
      metadata: { revision: outcome.revision, status: outcome.status },
      clientIp: getClientIP(request),
    });
  }
  return successResponse(outcome);
});
