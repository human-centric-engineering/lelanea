/**
 * Every revision of one overlay, newest first (Admin) — f-content-seeds t-92
 *
 * GET /api/v1/admin/app/voice/overlays/situations/:situation/history
 *
 * Authentication: admin. Rate limiting: the `admin` section tier.
 */

import { successResponse } from '@/lib/api/responses';
import { validatePathParam } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { situationKeySchema } from '@/lib/validations/app-voice-content';
import { listOverlayHistory } from '@/lib/app/voice/overlays-admin';

export const GET = withAdminAuth<{ situation: string }>(async (_request, _session, { params }) => {
  const situation = validatePathParam((await params).situation, situationKeySchema, {
    label: 'situation',
  });
  return successResponse({ revisions: await listOverlayHistory(situation) });
});
