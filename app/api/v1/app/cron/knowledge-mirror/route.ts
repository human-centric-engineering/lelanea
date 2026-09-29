/**
 * Knowledge mirror — scheduled reconcile
 *
 * GET /api/v1/app/cron/knowledge-mirror — brings the knowledge-base mirror of
 * her foundational documents into step with the rows (f-content-seeds t-90).
 *
 * **Why a cron route.** Production is where the mirror has to exist, and
 * nothing else puts it there. A migration cannot embed, and production seeds
 * only when asked. The platform's maintenance tick is not called on Vercel, and
 * it runs app jobs after answering, where a frozen function can cut them off.
 * This route is scheduled by `vercel.json` and awaits the reconcile, so the
 * function stays alive until the work is done. Edits do not wait for it: the
 * documents write service mirrors after every write. The cron is the first
 * mirror on a database that has one, and the retry for a failed ingest.
 *
 * **Once per active org** (t-115), each inside its own org scope through
 * `forEachOrg`, because each org mirrors its own documents. The scheduler's
 * request carries no org: left as it was, the reconcile served the install
 * org at `single` and threw at `multi`. One org's failure is recorded and the
 * next org still runs.
 *
 * Authentication: `Authorization: Bearer <CRON_SECRET>`, which is what Vercel
 * Cron sends when the project has `CRON_SECRET` set. Not an admin session: the
 * caller is the scheduler. With no secret configured, the route refuses every
 * request (503), because a route that does work on an unauthenticated GET
 * would let anyone spend embedding calls on demand. It still spends them only
 * when text has changed.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap in `proxy.ts`.
 *
 * Response: `{ orgs }`, each org's reconcile summary. 500 when any document
 * failed, or any org did not finish, naming the org and the document (or the
 * org alone), so Vercel's cron log shows the run as failed rather than green.
 */

import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { handleAPIError } from '@/lib/api/errors';
import {
  reconcileKnowledgeMirror,
  type KnowledgeMirrorResult,
} from '@/lib/app/content/knowledge-mirror';
import { forEachOrg } from '@/lib/tenancy/context';

/**
 * One org's pass: its summary, or that it did not finish. The error text is
 * logged and never returned, as for a document that failed.
 */
type OrgMirrorRun = { orgId: string } & ({ result: KnowledgeMirrorResult } | { crashed: true });

/** Five documents per org, each at most one embedding call. Well inside a minute. */
export const maxDuration = 60;

/** Long enough that a guessed or placeholder value is refused outright. */
const cronSecretSchema = z.string().min(16);

/** Constant-time comparison, so response time says nothing about the secret. */
function isAuthorised(header: string | null, secret: string): boolean {
  if (!header) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function GET(request: NextRequest): Promise<Response> {
  const log = await getRouteLogger(request);

  // Read per request, not at module scope, so a secret set or rotated in the
  // environment takes effect without a rebuild.
  const secret = cronSecretSchema.safeParse(process.env.CRON_SECRET);
  if (!secret.success) {
    log.error('Knowledge mirror cron called but CRON_SECRET is not set (16+ characters)');
    return errorResponse('Scheduled jobs are not configured', {
      code: 'NOT_CONFIGURED',
      status: 503,
    });
  }
  if (!isAuthorised(request.headers.get('authorization'), secret.data)) {
    return errorResponse('Unauthorized', { code: 'UNAUTHORIZED', status: 401 });
  }

  try {
    const orgs: OrgMirrorRun[] = [];
    await forEachOrg(async (orgId) => {
      try {
        orgs.push({ orgId, result: await reconcileKnowledgeMirror() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Knowledge mirror cron: an org did not reconcile', { orgId, error: message });
        orgs.push({ orgId, crashed: true });
      }
    });

    const failed = orgs.flatMap((run) =>
      'crashed' in run
        ? [{ orgId: run.orgId }]
        : run.result.failed.map((failure) => ({ orgId: run.orgId, sourceKey: failure.sourceKey }))
    );
    if (failed.length > 0) {
      log.error('Knowledge mirror cron: some documents failed', { failed });
      return errorResponse('Some documents could not be mirrored', {
        code: 'MIRROR_INCOMPLETE',
        status: 500,
        details: { failed },
      });
    }
    return successResponse({ orgs });
  } catch (error) {
    return handleAPIError(error);
  }
}
