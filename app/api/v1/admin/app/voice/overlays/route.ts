/**
 * Her register overlays as stored (Admin) — f-content-seeds t-92
 *
 * GET /api/v1/admin/app/voice/overlays → the set's framing, every overlay with
 * its status and revision, the contexts that select each, and whether the rows
 * can be served at all.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 *
 * @see lib/app/voice/overlays-admin.ts
 */

import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { getOverlaysAdminView } from '@/lib/app/voice/overlays-admin';

export const GET = withAdminAuth(async () => successResponse(await getOverlaysAdminView()));
