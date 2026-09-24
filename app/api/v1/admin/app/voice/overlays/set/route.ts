/**
 * The overlay set's framing (Admin) — f-content-seeds t-92
 *
 * PUT /api/v1/admin/app/voice/overlays/set
 *
 * Body: `exemplars`, `coreOnly` and the `revision` read. Both blocks reach the
 * model on voice turns, so a save that changes either returns the set to
 * `draft`; one that changes nothing writes nothing and records no audit entry.
 * 409 when the revision has moved.
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
import { overlaySetSaveSchema } from '@/lib/validations/app-voice-content';
import { updateOverlaySet } from '@/lib/app/voice/overlays-admin';

export const PUT = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const { revision, ...edit } = await validateRequestBody(request, overlaySetSaveSchema);
  const outcome = await updateOverlaySet(edit, revision, session.user.id);

  log.info('Voice overlay set saved', { changed: outcome.changed, revision: outcome.revision });
  if (outcome.changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_voice_overlay_set.update',
      entityType: 'settings',
      entityId: 'app_voice_overlay_set',
      entityName: 'Voice overlays — the set’s framing',
      changes: outcome.changes,
      metadata: { revision: outcome.revision, status: outcome.status },
      clientIp: getClientIP(request),
    });
  }
  return successResponse(outcome);
});
