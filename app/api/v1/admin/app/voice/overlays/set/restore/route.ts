/**
 * Restore the overlay set's framing to an earlier revision (Admin) — f-content-seeds t-92
 *
 * POST /api/v1/admin/app/voice/overlays/set/restore
 *
 * Body: `{ revision, revisionRead }`. The words of `revision` are saved as a
 * NEW revision, back in `draft`; nothing is rewound. 409 when `revisionRead`
 * has moved.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier. Audited.
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';
import { voiceRestoreSchema } from '@/lib/validations/app-voice-content';
import { restoreOverlaySetRevision } from '@/lib/app/voice/overlays-admin';

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const { revision, revisionRead } = await validateRequestBody(request, voiceRestoreSchema);
  const outcome = await restoreOverlaySetRevision(revision, revisionRead, session.user.id);

  log.info('Voice overlay revision restored', { revision, changed: outcome.changed });
  if (outcome.changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_voice_overlay_set.restore',
      entityType: 'settings',
      entityId: 'app_voice_overlay_set',
      entityName: 'Voice overlays — the set’s framing',
      changes: outcome.changes,
      metadata: { restoredFrom: revision, revision: outcome.revision },
      clientIp: getClientIP(request),
    });
  }
  return successResponse(outcome);
});
