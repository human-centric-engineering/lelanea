/**
 * The golden set's current version and its prompts (Admin) — f-content-seeds t-92
 *
 * GET /api/v1/admin/app/voice/golden-set → the pointer, the prompts, the hash
 * a save names, and whether the version is frozen (and by how many runs).
 *
 * Authentication: admin. Rate limiting: the `admin` section tier.
 *
 * @see lib/app/voice/golden-set-editor.ts
 */

import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { getGoldenSetEditorView } from '@/lib/app/voice/golden-set-editor';

export const GET = withAdminAuth(async () => successResponse(await getGoldenSetEditorView()));
