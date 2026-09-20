/**
 * Retiring and restoring one slot definition (f-slots t-71).
 *
 * `PUT { version, isActive }`. Both directions on one route, because they are
 * one field change and the lock is the same — and because a `DELETE` here would
 * be a lie: nothing is ever deleted at either tier. The row stays, the provider
 * withholds it, the framework sync deactivates its projection, and every answer
 * captured under the slug keeps resolving to the wording it was captured under.
 *
 * Its own route rather than a field on the reword above, so that saving a
 * reworded description can never retire a slot by a stray key, and so the two
 * produce different audit actions.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 *
 * @see lib/app/slots/definitions-admin.ts
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { setSlotDefinitionActive } from '@/lib/app/slots/definitions-admin';
import { slotDefinitionActiveSchema, slotSlugSchema } from '@/lib/app/slots/validation';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const PUT = withAdminAuth<{ slug: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const slug = validatePathParam((await params).slug, slotSlugSchema, {
      label: 'slot slug',
      field: 'slug',
    });
    const { version, isActive } = await validateRequestBody(request, slotDefinitionActiveSchema);
    const result = await setSlotDefinitionActive(slug, isActive, version, session.user.id);

    log.info(isActive ? 'Slot definition restored' : 'Slot definition retired', {
      slug,
      changed: result.changed,
      version: result.definition.version,
      sync: result.sync.status,
    });

    // Already in that state: no revision, no version bump, nothing to record.
    if (result.changed.length > 0) {
      logAdminAction({
        userId: session.user.id,
        action: isActive ? 'app_slot_definition.restore' : 'app_slot_definition.retire',
        entityType: 'settings',
        entityId: `app_slot_definition:${slug}`,
        entityName: slug,
        changes: result.changes,
        metadata: { version: result.definition.version, sync: result.sync.status },
        clientIp: getClientIP(request),
      });
    }

    return successResponse({
      definition: result.definition,
      changed: result.changed,
      sync: result.sync,
    });
  }
);
