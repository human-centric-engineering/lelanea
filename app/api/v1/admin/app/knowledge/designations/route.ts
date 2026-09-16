/**
 * Designations — the admin list (Admin)
 *
 * GET /api/v1/admin/app/knowledge/designations
 *
 * Every knowledge document with what it is designated: purpose, sensitivity, the
 * licensing note, and whether the agent's search tool may quote it.
 *
 * Authentication: admin. `withAdminAuth` answers 401 unauthenticated and 403 for
 * a signed-in non-admin, and also admits an `admin`-scoped API key — so the list
 * is reachable headlessly without a second auth path.
 *
 * Query parameters:
 *   - q                 optional free-text search over document name and file name
 *   - purpose           optional filter to one purpose
 *   - undesignatedOnly  default false — only documents with no purpose tag
 *   - page              default 1
 *   - limit             default 25, max 100
 *
 * ## Why a leaf route rather than the platform's document list
 *
 * `/api/v1/admin/orchestration/knowledge/documents` already lists documents with
 * their `tagIds`. It returns tag IDS, not slugs, so every caller would have to
 * fetch the tag table and join client-side to learn what a document is designated
 * — and the answer this page exists to give (*may the agent quote this?*) is a
 * rule, not a column, so computing it in a component would be a second
 * implementation of `isQuotable()`. That route is Sunrise's and stays untouched.
 *
 * ## Rate limiting: nothing to do here, and that is the design
 *
 * `proxy.ts` has already applied the `'admin'` section tier before this handler
 * runs — `RATE_LIMIT_POLICY` matches `/api/v1/admin/` as a prefix, so a new admin
 * route inherits the cap with no handler work. Handlers must never call a section
 * limiter themselves.
 *
 * @see lib/app/voice/designation-admin.ts · .context/app/voice.md
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { paginatedResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { designationAdminQuerySchema } from '@/lib/validations/app-knowledge-designation';
import { listDesignatedDocuments } from '@/lib/app/voice/designation-admin';

export const GET = withAdminAuth(async (request, _session) => {
  const log = await getRouteLogger(request);

  const query = validateQueryParams(request.nextUrl.searchParams, designationAdminQuerySchema);
  const { documents, total } = await listDesignatedDocuments(query);

  log.info('Knowledge designations listed', {
    count: documents.length,
    total,
    page: query.page,
    searched: query.q !== undefined,
    purpose: query.purpose,
    undesignatedOnly: query.undesignatedOnly,
  });

  return paginatedResponse(documents, { page: query.page, limit: query.limit, total });
});
