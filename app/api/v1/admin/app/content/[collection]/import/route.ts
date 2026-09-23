/**
 * Apply a content file (f-content-seeds t-91).
 *
 * `POST { file }` → the plan that ran. The service re-plans inside its
 * transaction against the rows as they stand and refuses (409
 * `import_refused`, the refusals listed) if that plan carries any, so an edit
 * made between the preview and this call is reconciled as it actually is.
 * Imported rows arrive as `origin: admin` revisions under the caller.
 *
 * Idempotent: a second apply of the same file plans nothing, writes nothing and
 * records no audit entry.
 *
 * The body is capped as the preview's is. Rate limiting: the `admin` section
 * tier from `proxy.ts`; a repeat is a no-op.
 *
 * @see lib/app/content/admin/keyed-import.ts
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { collectionHandlers } from '@/lib/app/content/admin/registry';
import { readImportBody } from '@/lib/app/content/admin/shared';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const POST = withAdminAuth<{ collection: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection } = await params;
    const handlers = collectionHandlers(collection);
    const { file } = await readImportBody(request);
    const plan = await handlers.apply(file, session.user.id);

    log.info('Content import applied', { collection, writesNothing: plan.writesNothing });

    if (!plan.writesNothing) {
      logAdminAction({
        userId: session.user.id,
        action: `app_content.${collection}.import`,
        entityType: 'settings',
        entityId: `app_content:${collection}`,
        metadata: {
          sections: plan.sections.map((section) => ({
            entity: section.entity,
            created: section.creates.map((item) => item.key),
            updated: section.updates.map((item) => item.key),
            removed: section.removals.map((item) => item.key),
            removalKind: section.removalKind,
            skippedRetired: section.skippedRetired,
          })),
        },
        clientIp: getClientIP(request),
      });
    }

    return successResponse({ plan });
  }
);
