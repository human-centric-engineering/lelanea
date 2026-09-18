/**
 * Metering — one person, this month (Admin)
 *
 * GET /api/v1/admin/app/metering/users/:userId — that person's spend and tokens
 * this UTC month against their effective ceiling. The same shape a member reads
 * of themselves at `/api/v1/app/usage` (§08 t-56).
 *
 * 404 when no such person exists — a ceiling for nobody is not an answer.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier, already
 * applied by `proxy.ts`. Caching: `no-store`.
 *
 * @see lib/app/agent/metering.ts
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { validatePathParam } from '@/lib/api/validation';
import { cuidSchema } from '@/lib/validations/common';
import { prisma } from '@/lib/db/client';
import { getMonthToDate } from '@/lib/app/agent/metering';
import { getAgentSettingsRouteLogger } from '@/app/api/v1/admin/app/agent/_shared/route-logger';

export const GET = withAdminAuth<{ userId: string }>(async (request, session, { params }) => {
  const log = await getAgentSettingsRouteLogger(request);
  const { userId: raw } = await params;
  const userId = validatePathParam(raw, cuidSchema, { label: 'user id' });

  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw new NotFoundError('User not found');

  const usage = await getMonthToDate(userId);

  log.info('Metering month-to-date read', { adminId: session.user.id, userId });

  return successResponse(usage, undefined, { headers: { 'Cache-Control': 'no-store' } });
});
