/**
 * Every revision of the overlay set's framing, newest first (Admin) — t-92
 *
 * GET /api/v1/admin/app/voice/overlays/set/history
 *
 * Authentication: admin. Rate limiting: the `admin` section tier.
 */

import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { listOverlaySetHistory } from '@/lib/app/voice/overlays-admin';

export const GET = withAdminAuth(async () =>
  successResponse({ revisions: await listOverlaySetHistory() })
);
