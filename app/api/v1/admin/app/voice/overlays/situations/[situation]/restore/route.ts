/**
 * Restore one overlay to an earlier revision (Admin) — f-content-seeds t-92
 *
 * POST /api/v1/admin/app/voice/overlays/situations/:situation/restore
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
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';
import { voiceRestoreSchema, situationKeySchema } from '@/lib/validations/app-voice-content';
import { restoreOverlayRevision } from '@/lib/app/voice/overlays-admin';

export const POST = withAdminAuth<{ situation: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const situation = validatePathParam((await params).situation, situationKeySchema, {
      label: 'situation',
    });
    const { revision, revisionRead } = await validateRequestBody(request, voiceRestoreSchema);
    const outcome = await restoreOverlayRevision(
      situation,
      revision,
      revisionRead,
      session.user.id
    );

    log.info('Voice overlay revision restored', { revision, changed: outcome.changed });
    if (outcome.changed.length > 0) {
      logAdminAction({
        userId: session.user.id,
        action: 'app_voice_overlay.restore',
        entityType: 'settings',
        entityId: `app_voice_overlay:${situation}`,
        entityName: situation,
        changes: outcome.changes,
        metadata: { restoredFrom: revision, revision: outcome.revision },
        clientIp: getClientIP(request),
      });
    }
    return successResponse(outcome);
  }
);
