/**
 * Start the golden set's next version (Admin) — f-content-seeds t-92
 *
 * POST /api/v1/admin/app/voice/golden-set/versions
 *
 * Body: `{ revision }` — the pointer revision read. Copies the current
 * version's prompts into the next version's dataset and points the install at
 * it. The old version, its cases and its comparisons stay as they were; the
 * new one is editable until something runs it. This is the remedy the freeze
 * names (`HB10`).
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
import { goldenSetNewVersionSchema } from '@/lib/validations/app-voice-content';
import { startNewGoldenSetVersion } from '@/lib/app/voice/golden-set-editor';

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const { revision } = await validateRequestBody(request, goldenSetNewVersionSchema);
  const outcome = await startNewGoldenSetVersion(revision, session.user.id);

  log.info('Golden set version started', outcome);
  logAdminAction({
    userId: session.user.id,
    action: 'app_voice_golden_set.new_version',
    entityType: 'settings',
    entityId: 'app_voice_golden_set',
    entityName: 'Voice golden set',
    changes: { version: { from: outcome.from, to: outcome.to } },
    metadata: { revision: outcome.revision, contentHash: outcome.contentHash },
    clientIp: getClientIP(request),
  });
  return successResponse(outcome, undefined, { status: 201 });
});
