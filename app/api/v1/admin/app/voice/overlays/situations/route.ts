/**
 * Add a situation to her register overlays (Admin) — f-content-seeds t-92
 *
 * POST /api/v1/admin/app/voice/overlays/situations
 *
 * Body: the key, once, and the words. Added at the end of the order, as a
 * draft. Adding a situation is adding a row: the selector reads the table, so
 * the new key is selectable on the next turn that asks for it. 409 when the key
 * is taken.
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
import { overlayCreateSchema } from '@/lib/validations/app-voice-content';
import { createOverlay } from '@/lib/app/voice/overlays-admin';

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const body = await validateRequestBody(request, overlayCreateSchema);
  const created = await createOverlay(body, session.user.id);

  log.info('Voice overlay created', created);
  logAdminAction({
    userId: session.user.id,
    action: 'app_voice_overlay.create',
    entityType: 'settings',
    entityId: `app_voice_overlay:${created.situation}`,
    entityName: created.situation,
    changes: { overlay: { from: null, to: body } },
    metadata: created,
    clientIp: getClientIP(request),
  });
  return successResponse(created, undefined, { status: 201 });
});
