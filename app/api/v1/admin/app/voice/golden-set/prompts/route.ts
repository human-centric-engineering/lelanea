/**
 * Add a prompt to the golden set (Admin) — f-content-seeds t-92
 *
 * POST /api/v1/admin/app/voice/golden-set/prompts
 *
 * Body: the key, the kind, what it tests, the prompt, and the `contentHash`
 * read. Added at the end. 409 when the version is frozen (with the remedy),
 * when the hash has moved, or when the key is taken.
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
import { goldenPromptCreateSchema } from '@/lib/validations/app-voice-content';
import { createGoldenPrompt } from '@/lib/app/voice/golden-set-editor';

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const { contentHash, ...prompt } = await validateRequestBody(request, goldenPromptCreateSchema);
  const outcome = await createGoldenPrompt(prompt, contentHash);

  log.info('Golden set prompt created', { key: prompt.key, version: outcome.version });
  logAdminAction({
    userId: session.user.id,
    action: 'app_voice_golden_set.prompt.create',
    entityType: 'settings',
    entityId: `app_voice_golden_set:v${outcome.version}:${prompt.key}`,
    entityName: prompt.key,
    changes: outcome.changes,
    metadata: { version: outcome.version, contentHash: outcome.contentHash },
    clientIp: getClientIP(request),
  });
  return successResponse(outcome, undefined, { status: 201 });
});
