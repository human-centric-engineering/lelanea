/**
 * Sign one overlay off (Admin) — f-content-seeds t-92
 *
 * POST /api/v1/admin/app/voice/overlays/situations/:situation/sign-off
 *
 * Body: `{ revision }` — the revision the admin read. 409 if it has moved, so
 * nobody signs off words they did not see. The sign-off is itself a revision,
 * and the audit log records who gave it.
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
import { voiceSignOffSchema, situationKeySchema } from '@/lib/validations/app-voice-content';
import { signOffOverlay } from '@/lib/app/voice/overlays-admin';

export const POST = withAdminAuth<{ situation: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const situation = validatePathParam((await params).situation, situationKeySchema, {
      label: 'situation',
    });
    const { revision } = await validateRequestBody(request, voiceSignOffSchema);
    const outcome = await signOffOverlay(situation, revision, session.user.id);

    log.info('Voice overlay signed off', { revision: outcome.revision, changed: outcome.changed });
    if (outcome.changed.length > 0) {
      logAdminAction({
        userId: session.user.id,
        action: 'app_voice_overlay.sign_off',
        entityType: 'settings',
        entityId: `app_voice_overlay:${situation}`,
        entityName: situation,
        metadata: { revisionRead: revision, revision: outcome.revision },
        clientIp: getClientIP(request),
      });
    }
    return successResponse(outcome);
  }
);
