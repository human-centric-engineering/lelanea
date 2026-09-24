/**
 * The three routes a keep-by-default file round-trip needs — export, preview,
 * apply — built once (f-content-seeds t-92).
 *
 * The voice overlays, the golden set and the crisis resources each expose the
 * same three, with the same body cap, the same audit shape and the same
 * `removeAbsent` flag, so each route file is one line naming its service. The
 * t-91 collections keep their own `[collection]` routes, which remove what a
 * file omits until t-100 gives them the same choice.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`. A repeated apply is a
 * no-op and records no audit entry.
 *
 * @see lib/app/content/admin/shared.ts — `readImportRequest`, the plan shape
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { readImportRequest, type ContentImportPlan } from '@/lib/app/content/admin/shared';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

/** What each factory returns: a route handler, as `withAdminAuth` builds one. */
type AdminRoute = (request: NextRequest) => Promise<Response>;

/**
 * `GET` — the stored rows as a JSON attachment in the seed's own shape. No
 * per-flow cap: published material, no personal data. `no-store`, because it
 * is a snapshot.
 */
export function fileExportRoute(
  what: string,
  exportFile: () => Promise<unknown>,
  filename: (now: Date) => string
): AdminRoute {
  return withAdminAuth(async (request: NextRequest) => {
    const log = await getRouteLogger(request);
    const file = await exportFile();
    const name = filename(new Date());
    log.info('Admin file exported', { what, filename: name });
    return new Response(JSON.stringify(file, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}

/** `POST { file, removeAbsent? }` → the plan. Writes nothing. */
export function filePreviewRoute(
  what: string,
  preview: (file: unknown, removeAbsent: boolean) => Promise<ContentImportPlan>
): AdminRoute {
  return withAdminAuth(async (request: NextRequest) => {
    const log = await getRouteLogger(request);
    const { file, removeAbsent } = await readImportRequest(request);
    const plan = await preview(file, removeAbsent);
    log.info('Admin file import previewed', {
      what,
      removeAbsent,
      writesNothing: plan.writesNothing,
    });
    return successResponse({ plan });
  });
}

export interface FileImportOutcome {
  plan: ContentImportPlan;
  /** Whatever the audit entry should carry beyond the plan: removed words, say. */
  audit?: Record<string, unknown>;
}

/**
 * `POST { file, removeAbsent? }` → the plan that ran. The service re-plans in
 * its transaction and refuses (409 `import_refused`) if that plan carries any
 * refusal, so an edit made between preview and apply is met as it stands.
 */
export function fileImportRoute(
  audit: { action: string; entityId: string; entityName: string },
  apply: (file: unknown, removeAbsent: boolean, editorId: string) => Promise<FileImportOutcome>
): AdminRoute {
  return withAdminAuth(async (request: NextRequest, session) => {
    const log = await getRouteLogger(request);
    const { file, removeAbsent } = await readImportRequest(request);
    const { plan, audit: extra } = await apply(file, removeAbsent, session.user.id);

    log.info('Admin file import applied', {
      action: audit.action,
      removeAbsent,
      writesNothing: plan.writesNothing,
    });
    if (!plan.writesNothing) {
      logAdminAction({
        userId: session.user.id,
        action: audit.action,
        entityType: 'settings',
        entityId: audit.entityId,
        entityName: audit.entityName,
        metadata: {
          removeAbsent,
          sections: plan.sections.map((section) => ({
            entity: section.entity,
            created: section.creates.map((item) => item.key),
            updated: section.updates.map((item) => ({
              key: item.key,
              changedFields: item.changedFields,
            })),
            removed: section.removals.map((item) => item.key),
            kept: section.kept ?? [],
          })),
          ...extra,
        },
        clientIp: getClientIP(request),
      });
    }
    return successResponse({ plan });
  });
}
