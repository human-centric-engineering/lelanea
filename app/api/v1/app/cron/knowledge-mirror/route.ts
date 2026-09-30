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
 * **Once per active org at `multi`** (t-115), each inside its own org scope,
 * because each org mirrors its own documents; at `single`, the install org
 * alone. The scheduler's request carries no org: left as it was, the
 * reconcile threw at `multi`. One org's failure is recorded and the next org
 * still runs.
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
 * Response: `{ orgs }`, each org's reconcile summary. 500 when anything was
 * left undone, so Vercel's cron log shows the run as failed rather than green:
 * `details.failed` names each document (with its org), `crashed` each org whose
 * reconcile threw, and `notReached` each org the run had no time left for. 500
 * too when there was no org at all, which is a failed read, not a clean run.
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
import { isMultiTenant, listActiveOrgIds, runAsOrg } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

/** Five documents per org, each at most one embedding call. */
export const maxDuration = 60;

/**
 * No new org is started after this long. That leaves the last one started half
 * the function's time to finish in, which five embedding calls fit with room
 * to spare; it cannot bound an org already running, so a pass that hangs past
 * `maxDuration` is still cut off, as a single reconcile always could be. The
 * orgs left are named in the response and reconciled on a later run.
 */
const START_BUDGET_MS = 30_000;

/**
 * The orgs this run reconciles, in the order it starts them.
 *
 * At `single`, only the install org, as the route always did: nothing scopes a
 * read there, so a pass for any other org would read the install org's rows
 * too (and a second org is never hosted at `single`, `.context/app/database-changes.md`).
 *
 * At `multi`, every active org, starting at a different one each day. A fixed
 * order would let an org that is slow every day, a flaky embedding provider
 * say, spend the budget before the same later orgs every time.
 */
async function orgsForThisRun(): Promise<string[]> {
  if (!isMultiTenant()) return [INSTALL_ORG_ID];
  const orgIds = await listActiveOrgIds();
  if (orgIds.length === 0) return orgIds;
  const offset = Math.floor(Date.now() / 86_400_000) % orgIds.length;
  return [...orgIds.slice(offset), ...orgIds.slice(0, offset)];
}

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
    const orgIds = await orgsForThisRun();
    if (orgIds.length === 0) {
      // The install org always exists, so this is a query that told us
      // nothing, not an install with nothing to mirror: "I could not look" is
      // never reported as "I found nothing" (.context/architecture/checks.md).
      log.error('Knowledge mirror cron: found no active org to reconcile');
      return errorResponse('No organisation to mirror for', {
        code: 'MIRROR_INCOMPLETE',
        status: 500,
      });
    }

    // Each org's summary; the documents that failed, with their org; each org
    // whose reconcile threw (its error text is logged, never returned); and
    // each org the run had no time left to start.
    const orgs: { orgId: string; result: KnowledgeMirrorResult }[] = [];
    const failed: { orgId: string; sourceKey: string }[] = [];
    const crashed: string[] = [];
    const notReached: string[] = [];
    const startBy = Date.now() + START_BUDGET_MS;
    for (const orgId of orgIds) {
      if (Date.now() > startBy) {
        notReached.push(orgId);
        continue;
      }
      try {
        const result = await runAsOrg(orgId, () => reconcileKnowledgeMirror(), { source: 'job' });
        orgs.push({ orgId, result });
        failed.push(...result.failed.map((failure) => ({ orgId, sourceKey: failure.sourceKey })));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Knowledge mirror cron: an org did not reconcile', { orgId, error: message });
        crashed.push(orgId);
      }
    }

    if (failed.length + crashed.length + notReached.length > 0) {
      if (failed.length > 0) log.error('Knowledge mirror cron: some documents failed', { failed });
      if (notReached.length > 0) {
        log.error('Knowledge mirror cron: ran out of time before these orgs', { notReached });
      }
      return errorResponse('The mirror is not complete for every organisation', {
        code: 'MIRROR_INCOMPLETE',
        status: 500,
        details: { failed, crashed, notReached },
      });
    }
    return successResponse({ orgs });
  } catch (error) {
    return handleAPIError(error);
  }
}
