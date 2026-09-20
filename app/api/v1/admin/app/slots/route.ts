/**
 * The slot taxonomy, as an admin reads and extends it (f-slots t-71).
 *
 * - `GET` — every definition, retired ones included, plus the group keys in use.
 * - `POST` — add one. A slug is added and retired, never renamed.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`. No per-flow cap —
 * these are ordinary admin reads and a single-row write.
 *
 * Errors are thrown, not returned: `withAdminAuth` routes an `APIError` through
 * `handleAPIError`, which is what turns the store's `ConflictError` into the 409
 * the editor shows.
 *
 * @see lib/app/slots/definitions-admin.ts
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { createSlotDefinition, getSlotTaxonomyAdminView } from '@/lib/app/slots/definitions-admin';
import { slotDefinitionCreateSchema } from '@/lib/app/slots/validation';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const GET = withAdminAuth(async (request: NextRequest) => {
  const log = await getRouteLogger(request);
  const view = await getSlotTaxonomyAdminView();
  log.info('Slot definitions fetched', {
    seeded: view.seeded,
    definitions: view.definitions.length,
    active: view.definitions.filter((d) => d.isActive).length,
  });
  return successResponse(view);
});

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const body = await validateRequestBody(request, slotDefinitionCreateSchema);
  const { definition, sync } = await createSlotDefinition(body, session.user.id);

  log.info('Slot definition added', { slug: definition.slug, sync: sync.status });
  logAdminAction({
    userId: session.user.id,
    action: 'app_slot_definition.create',
    entityType: 'settings',
    entityId: `app_slot_definition:${definition.slug}`,
    entityName: definition.slug,
    metadata: {
      group: definition.group,
      visibility: definition.visibility,
      sensitivity: definition.sensitivity,
      sync: sync.status,
    },
    clientIp: getClientIP(request),
  });

  return successResponse({ definition, sync }, undefined, { status: 201 });
});
