/**
 * Designations — one document (Admin)
 *
 * GET   /api/v1/admin/app/knowledge/designations/:documentId
 * PATCH /api/v1/admin/app/knowledge/designations/:documentId
 *
 * The write that decides whether the agent may quote a document. `purpose:
 * 'voice'` takes it off the tool path from the next resolve onwards; `null`
 * clears an answer rather than setting one; an omitted key changes nothing.
 *
 * Authentication: admin.
 *
 * ## Audited, because this is an access-control change wearing a label
 *
 * Re-designating a document from `voice` to `knowledge` widens what an agent can
 * retrieve and quote, which is the same class of act as granting a tag — and
 * `logAdminAction` is where every other such change in this install is recorded.
 * The licensing note's TEXT is deliberately not in the audit metadata or the log:
 * it is free text an admin typed and may name a third party, and the fact that it
 * changed is the operational fact.
 *
 * @see lib/app/voice/designation-admin.ts
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { cuidSchema } from '@/lib/validations/common';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { designationUpdateSchema } from '@/lib/validations/app-knowledge-designation';
import { getDesignation, setDesignation } from '@/lib/app/voice/designation-admin';
import { isQuotable } from '@/lib/app/voice/designation';

export const GET = withAdminAuth<{ documentId: string }>(async (request, _session, { params }) => {
  const log = await getRouteLogger(request);
  const { documentId: raw } = await params;
  const documentId = validatePathParam(raw, cuidSchema, { label: 'document id' });

  const designation = await getDesignation(documentId);
  if (!designation) throw new NotFoundError(`Document ${documentId} not found`);

  log.info('Designation fetched', { documentId });
  return successResponse({ designation: { ...designation, quotable: isQuotable(designation) } });
});

export const PATCH = withAdminAuth<{ documentId: string }>(async (request, session, { params }) => {
  const clientIp = getClientIP(request);
  const log = await getRouteLogger(request);

  const { documentId: raw } = await params;
  const documentId = validatePathParam(raw, cuidSchema, { label: 'document id' });

  const body = await validateRequestBody(request, designationUpdateSchema);
  const designation = await setDesignation(documentId, body, session.user.id);
  const quotable = isQuotable(designation);

  log.info('Designation set', {
    documentId,
    purpose: designation.purpose,
    sensitivity: designation.sensitivity,
    // Whether a note exists, never the note. See the header.
    licensed: designation.licensing !== null,
    quotable,
    adminId: session.user.id,
  });

  logAdminAction({
    userId: session.user.id,
    action: 'app_knowledge_designation.update',
    entityType: 'knowledge_document',
    entityId: documentId,
    metadata: {
      purpose: designation.purpose,
      sensitivity: designation.sensitivity,
      licensingChanged: body.licensing !== undefined,
      quotable,
    },
    clientIp,
  });

  return successResponse({ designation: { ...designation, quotable } });
});
