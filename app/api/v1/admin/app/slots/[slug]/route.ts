/**
 * One slot definition's wording (f-slots t-71).
 *
 * `PUT` rewords it. **The slug is in the path and is not writable** — it is the
 * identity a captured `framework_slot_value.slotSlug` points at, so renaming one
 * would orphan every answer already given under it. `slotDefinitionSaveSchema`
 * is a `strictObject` with no `slug` key, so a body carrying one is refused 400
 * rather than quietly ignored: an admin who thought they were renaming a slot
 * should be told they were not.
 *
 * There is no `DELETE`. Retirement is `PUT ./active`, and it never removes a row.
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
import { updateSlotDefinition } from '@/lib/app/slots/definitions-admin';
import { slotDefinitionSaveSchema, slotSlugSchema } from '@/lib/app/slots/validation';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const PUT = withAdminAuth<{ slug: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const slug = validatePathParam((await params).slug, slotSlugSchema, {
      label: 'slot slug',
      field: 'slug',
    });
    const { version, ...update } = await validateRequestBody(request, slotDefinitionSaveSchema);
    const { definition, changed, changes, sync } = await updateSlotDefinition(
      slug,
      update,
      version,
      session.user.id
    );

    log.info('Slot definition saved', {
      slug,
      changed,
      version: definition.version,
      sync: sync.status,
    });

    // A save that changed nothing wrote no revision and bumped no version, so
    // there is nothing to audit either — an entry here would report an edit the
    // history has no record of.
    if (changed.length > 0) {
      logAdminAction({
        userId: session.user.id,
        action: 'app_slot_definition.update',
        entityType: 'settings',
        entityId: `app_slot_definition:${slug}`,
        entityName: slug,
        changes,
        metadata: { version: definition.version, sync: sync.status },
        clientIp: getClientIP(request),
      });
    }

    return successResponse({ definition, changed, sync });
  }
);
