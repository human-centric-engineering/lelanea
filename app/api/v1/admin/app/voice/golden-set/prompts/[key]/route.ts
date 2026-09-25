/**
 * One golden-set prompt (Admin) — f-content-seeds t-92
 *
 * PUT /api/v1/admin/app/voice/golden-set/prompts/:key
 *   Body: kind, what it tests, the prompt, and the `contentHash` read.
 *
 * DELETE /api/v1/admin/app/voice/golden-set/prompts/:key?contentHash=…
 *
 * Both are refused 409 while the version has been run — its answers are only
 * readable beside the questions that produced them — with the remedy named:
 * start a new version. Also refused when the hash has moved, or when the change
 * would leave a kind of moment with no prompt.
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
import {
  contentHashQuerySchema,
  goldenPromptSaveSchema,
  promptKeySchema,
} from '@/lib/validations/app-voice-content';
import { deleteGoldenPrompt, updateGoldenPrompt } from '@/lib/app/voice/golden-set-editor';

type Params = { key: string };

export const PUT = withAdminAuth<Params>(async (request: NextRequest, session, { params }) => {
  const log = await getRouteLogger(request);
  const key = validatePathParam((await params).key, promptKeySchema, { label: 'prompt key' });
  const { contentHash, ...edit } = await validateRequestBody(request, goldenPromptSaveSchema);
  const outcome = await updateGoldenPrompt(key, edit, contentHash);

  log.info('Golden set prompt saved', { key, changed: outcome.changed });
  if (outcome.changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_voice_golden_set.prompt.update',
      entityType: 'settings',
      entityId: `app_voice_golden_set:v${outcome.version}:${key}`,
      entityName: key,
      changes: outcome.changes,
      metadata: { version: outcome.version, contentHash: outcome.contentHash },
      clientIp: getClientIP(request),
    });
  }
  return successResponse(outcome);
});

export const DELETE = withAdminAuth<Params>(async (request: NextRequest, session, { params }) => {
  const log = await getRouteLogger(request);
  const key = validatePathParam((await params).key, promptKeySchema, { label: 'prompt key' });
  const contentHash = validatePathParam(
    request.nextUrl.searchParams.get('contentHash') ?? '',
    contentHashQuerySchema,
    { label: 'contentHash', field: 'contentHash' }
  );
  const outcome = await deleteGoldenPrompt(key, contentHash);

  log.info('Golden set prompt removed', { key, version: outcome.version });
  logAdminAction({
    userId: session.user.id,
    action: 'app_voice_golden_set.prompt.remove',
    entityType: 'settings',
    entityId: `app_voice_golden_set:v${outcome.version}:${key}`,
    entityName: key,
    changes: outcome.changes,
    metadata: { version: outcome.version, contentHash: outcome.contentHash },
    clientIp: getClientIP(request),
  });
  return successResponse(outcome);
});
