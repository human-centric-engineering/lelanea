/**
 * One register overlay (Admin) — f-content-seeds t-92
 *
 * PUT /api/v1/admin/app/voice/overlays/situations/:situation
 *   Body: the words and the `revision` read. Its key and place are not
 *   writable. A change returns it to `draft`; no change writes nothing.
 *
 * DELETE /api/v1/admin/app/voice/overlays/situations/:situation?revision=N
 *   Removes it and closes the gap in the order. Not refused because something
 *   selects it — a context whose situation has gone falls back to the core-only
 *   block — but the page names those contexts before confirming, and the audit
 *   entry records them with the removed words. The last overlay is refused.
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
import { ValidationError } from '@/lib/api/errors';
import { overlaySaveSchema, situationKeySchema } from '@/lib/validations/app-voice-content';
import { deleteOverlay, updateOverlay } from '@/lib/app/voice/overlays-admin';

type Params = { situation: string };

export const PUT = withAdminAuth<Params>(async (request: NextRequest, session, { params }) => {
  const log = await getRouteLogger(request);
  const situation = validatePathParam((await params).situation, situationKeySchema, {
    label: 'situation',
  });
  const { revision, ...edit } = await validateRequestBody(request, overlaySaveSchema);
  const outcome = await updateOverlay(situation, edit, revision, session.user.id);

  log.info('Voice overlay saved', { situation, changed: outcome.changed });
  if (outcome.changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_voice_overlay.update',
      entityType: 'settings',
      entityId: `app_voice_overlay:${situation}`,
      entityName: situation,
      changes: outcome.changes,
      metadata: { revision: outcome.revision, status: outcome.status },
      clientIp: getClientIP(request),
    });
  }
  return successResponse(outcome);
});

export const DELETE = withAdminAuth<Params>(async (request: NextRequest, session, { params }) => {
  const log = await getRouteLogger(request);
  const situation = validatePathParam((await params).situation, situationKeySchema, {
    label: 'situation',
  });
  const raw = request.nextUrl.searchParams.get('revision');
  const revision = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!(Number.isInteger(revision) && revision > 0)) {
    throw new ValidationError('Say which revision you are removing: ?revision=<the one you read>.');
  }
  const outcome = await deleteOverlay(situation, revision, session.user.id);

  log.info('Voice overlay removed', { situation, renumbered: outcome.renumbered });
  logAdminAction({
    userId: session.user.id,
    action: 'app_voice_overlay.remove',
    entityType: 'settings',
    entityId: `app_voice_overlay:${situation}`,
    entityName: situation,
    changes: { overlay: { from: outcome.removed, to: null } },
    metadata: { selectedBy: outcome.selectedBy, renumbered: outcome.renumbered },
    clientIp: getClientIP(request),
  });
  return successResponse({ removed: situation, selectedBy: outcome.selectedBy });
});
