/**
 * A route logger for the agent settings surface, with the request URL left off.
 *
 * The budget list takes `?q=`, and the first thing anyone types into a people
 * search is an email address. Until Sunrise 0.14.0 `getRouteLogger` bound the
 * full URL — query string included — to every line, and the sanitiser redacts by
 * key, not by value, so the address reached stdout and the admin log buffer.
 * `sunrise#685` fixed that in the platform, so this now delegates; it stays so
 * its test keeps pinning the property for this surface. The same reasoning as
 * `app/api/v1/admin/app/waitlist/_shared/route-logger.ts`.
 *
 * Used by every route under `/api/v1/admin/app/agent/` so the surface has one
 * logging shape rather than a careful list route beside careless write routes.
 */

import type { Logger } from '@/lib/logging';
import { getRouteLogger } from '@/lib/api/context';

export async function getAgentSettingsRouteLogger(request: Request): Promise<Logger> {
  return getRouteLogger(request);
}
