/**
 * A route logger for the agent settings surface, with the request URL left off.
 *
 * The budget list takes `?q=`, and the first thing anyone types into a people
 * search is an email address. `getRouteLogger` binds the full URL — query string
 * included — to every line, and the sanitiser redacts by key, not by value, so
 * the address would reach stdout and the admin log buffer. The same finding, and
 * the same fix, as `app/api/v1/admin/app/waitlist/_shared/route-logger.ts`; the
 * platform gap is `sunrise#685`.
 *
 * Used by every route under `/api/v1/admin/app/agent/` so the surface has one
 * logging shape rather than a careful list route beside careless write routes.
 */

import type { Logger } from '@/lib/logging';
import { logger } from '@/lib/logging';
import { getEndpointPath, getFullContext } from '@/lib/logging/context';

export async function getAgentSettingsRouteLogger(request: Request): Promise<Logger> {
  const { url: _url, ...context } = await getFullContext(request);
  return logger.withContext({ ...context, endpoint: getEndpointPath(request) });
}
