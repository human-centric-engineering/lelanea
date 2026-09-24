/**
 * One content item (f-content-seeds t-91).
 *
 * `PUT` saves it: the entity's editable fields plus the `revision` (or
 * `updatedAt`) the admin read. A save that changes nothing writes nothing and
 * records no audit entry. **The id is in the path and is never writable**: a
 * document id is its API path and the gate's key, a resource id is what past
 * suggestions name, and the journey's ids are the roster's.
 *
 * `DELETE ?revision=N` removes it, where removal means something: a question is
 * deleted (the rest re-numbered), a resource is RETIRED (never deleted, so past
 * suggestions still resolve), a key's words are deleted (not `default`'s). A
 * document a surface renders is refused with its readers named.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 *
 * @see lib/app/content/admin/registry.ts
 */

import type { NextRequest } from 'next/server';

import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { CONTENT_ID_PATTERN, entityHandlers } from '@/lib/app/content/admin/registry';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

type Params = { collection: string; entity: string; id: string };

function checkedId(id: string): string {
  if (!CONTENT_ID_PATTERN.test(id)) throw new NotFoundError('No content item has that id.');
  return id;
}

export const PUT = withAdminAuth<Params>(async (request: NextRequest, session, { params }) => {
  const log = await getRouteLogger(request);
  const { collection, entity, id: rawId } = await params;
  const handlers = entityHandlers(collection, entity);
  const id = checkedId(rawId);

  const body: unknown = await request.json().catch(() => {
    throw new ValidationError('Invalid JSON in request body');
  });
  const outcome = await handlers.save(id, body, session.user.id);

  log.info('Content item saved', { collection, entity, id, changed: outcome.changed });
  if (outcome.changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: `app_content.${collection}.${entity}.update`,
      entityType: 'settings',
      entityId: `app_content:${collection}/${entity}:${id}`,
      entityName: id,
      changes: outcome.changes,
      metadata: outcome.result,
      clientIp: getClientIP(request),
    });
  }
  return successResponse({ changed: outcome.changed, ...outcome.result });
});

export const DELETE = withAdminAuth<Params>(async (request: NextRequest, session, { params }) => {
  const log = await getRouteLogger(request);
  const { collection, entity, id: rawId } = await params;
  const handlers = entityHandlers(collection, entity);
  const id = checkedId(rawId);
  if (!handlers.remove)
    throw new NotFoundError(`A ${handlers.label} is not removed; clear or edit its text instead.`);

  const raw = request.nextUrl.searchParams.get('revision');
  const revision = raw === null ? null : Number.parseInt(raw, 10);
  if (revision !== null && !(Number.isInteger(revision) && revision > 0)) {
    throw new ValidationError('revision must be a positive whole number.');
  }
  const outcome = await handlers.remove(id, revision, session.user.id);

  log.info('Content item removed', { collection, entity, id });
  logAdminAction({
    userId: session.user.id,
    action: `app_content.${collection}.${entity}.remove`,
    entityType: 'settings',
    entityId: `app_content:${collection}/${entity}:${id}`,
    entityName: id,
    changes: outcome.changes,
    metadata: outcome.result,
    clientIp: getClientIP(request),
  });
  return successResponse({ removed: id, ...outcome.result });
});
