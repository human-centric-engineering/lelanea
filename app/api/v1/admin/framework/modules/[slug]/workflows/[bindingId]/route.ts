/**
 * Framework module workflow bindings — update + unbind a single binding
 * (f-module-bindings t-3).
 *
 * PATCH  /api/v1/admin/framework/modules/:slug/workflows/:bindingId — toggle the
 *        `enabled` flag and/or replace `inputTemplate` (`inputTemplate: null` clears).
 *        A PATCH that writes `inputTemplate` must send the `version` it read as `If-Match`:
 *        428 without one, 412 `STALE_RECORD` once the template moved on (an erasure
 *        included), nothing written (Hub t-151; the service's header has the why).
 * DELETE /api/v1/admin/framework/modules/:slug/workflows/:bindingId — unbind.
 *
 * Admin-only; framework-tier path. The binding must belong to the named module (else
 * 404). Rate limiting is automatic via `proxy.ts`; mutations are audited in the
 * service. Changing the *event* or *workflow* is an unbind + rebind, not a PATCH.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { requireIfMatch } from '@/lib/api/record-version';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import {
  updateWorkflowBinding,
  unbindWorkflow,
} from '@/lib/framework/modules/workflow-bindings/service';
import {
  parseModuleSlug,
  parseWorkflowBindingId,
  updateWorkflowBindingBodySchema,
} from '@/lib/framework/modules/workflow-bindings/api-schemas';

export const PATCH = withAdminAuth<{ slug: string; bindingId: string }>(
  async (request, session, { params }) => {
    const clientIp = getClientIP(request);
    const log = await getRouteLogger(request);
    const { slug: rawSlug, bindingId: rawBindingId } = await params;
    const slug = parseModuleSlug(rawSlug);
    const bindingId = parseWorkflowBindingId(rawBindingId);

    const body = await validateRequestBody(request, updateWorkflowBindingBodySchema);
    // Only a template write is versioned: `enabled` is nothing erasure scrubs.
    const loadedAt = body.inputTemplate !== undefined ? requireIfMatch(request) : undefined;

    const binding = await updateWorkflowBinding({
      moduleSlug: slug,
      bindingId,
      enabled: body.enabled,
      inputTemplate: body.inputTemplate,
      loadedAt,
      userId: session.user.id,
      clientIp,
    });

    log.info('Framework module workflow binding updated', {
      slug,
      bindingId,
      adminId: session.user.id,
    });
    return successResponse(binding);
  }
);

export const DELETE = withAdminAuth<{ slug: string; bindingId: string }>(
  async (request, session, { params }) => {
    const clientIp = getClientIP(request);
    const log = await getRouteLogger(request);
    const { slug: rawSlug, bindingId: rawBindingId } = await params;
    const slug = parseModuleSlug(rawSlug);
    const bindingId = parseWorkflowBindingId(rawBindingId);

    await unbindWorkflow({ moduleSlug: slug, bindingId, userId: session.user.id, clientIp });

    log.info('Framework module workflow unbound', { slug, bindingId, adminId: session.user.id });
    return successResponse({ id: bindingId, unbound: true });
  }
);
