/**
 * Apply a taxonomy file (f-slots t-71).
 *
 * `POST { mode, file }` → the plan that ran, and what the re-sync did.
 *
 * **The plan in the response is the one that was applied, not the one that was
 * previewed.** The store re-plans inside its transaction against the rows as
 * they stand, so a definition someone edited between the preview and this call
 * is reconciled as it actually is rather than against a snapshot. The page shows
 * what came back, which is what makes that honest rather than silent.
 *
 * Idempotent, by construction: every write is driven by
 * `changedDefinitionFields()`, so a second apply of the same file plans nothing.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`. No per-flow cap —
 * see the preview route's note; the work is bounded by the taxonomy's size, and
 * a repeat is a no-op.
 *
 * @see lib/app/slots/definitions-admin.ts
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { applyTaxonomyUpload, planWritesNothing } from '@/lib/app/slots/definitions-admin';
import { slotTaxonomyUploadSchema } from '@/lib/app/slots/validation';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const { mode, file } = await validateRequestBody(request, slotTaxonomyUploadSchema);
  const { plan, sync } = await applyTaxonomyUpload(file, mode, session.user.id);

  log.info('Slot taxonomy upload applied', {
    mode,
    creates: plan.creates.length,
    updates: plan.updates.length,
    retirements: plan.retirements.length,
    sync: sync.status,
  });

  // A re-applied file wrote nothing and appended no history, so there is no
  // change to record — the same rule the single-definition routes follow.
  if (!planWritesNothing(plan)) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_slot_definition.upload',
      entityType: 'settings',
      entityId: 'app_slot_definition',
      metadata: {
        mode,
        created: plan.creates.map((c) => c.slug),
        updated: plan.updates.map((u) => u.slug),
        // The slugs an admin is most likely to come back asking about, so they
        // are named rather than counted.
        retired: plan.retirements.map((r) => r.slug),
        skippedRetired: plan.skippedRetired,
        sync: sync.status,
      },
      clientIp: getClientIP(request),
    });
  }

  return successResponse({ plan, sync });
});
