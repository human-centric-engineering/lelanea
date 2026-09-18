/**
 * The agent settings surface's paths, in one place.
 *
 * Same reasoning as `lib/app/waitlist/endpoint.ts`: `lib/api/endpoints.ts` is
 * Sunrise-owned, so a leaf route there would buy a divergence row for a string
 * constant. Its own module rather than a member of `./settings`, because the
 * admin component is a client component and `./settings` imports Prisma.
 */

/** The singleton: deadlines and the default monthly ceiling. `GET` and `PUT`. */
export const AGENT_SETTINGS_ENDPOINT = '/api/v1/admin/app/agent/settings';

/** Every person with their effective ceiling — the one list the override is set from. */
export const USER_BUDGETS_ENDPOINT = '/api/v1/admin/app/agent/budgets';

/** One person's override: `PUT` sets it, `DELETE` clears it back to the default. */
export function userBudgetEndpoint(userId: string): string {
  return `${USER_BUDGETS_ENDPOINT}/${userId}`;
}

/** Where an admin changes them. The nav seam and the page both name it here. */
export const AGENT_SETTINGS_PAGE = '/admin/app/agent';

/** Whether a turn can be expected to be answered now — `GET`, any member (§08 t-55). */
export const AGENT_STATUS_ENDPOINT = '/api/v1/app/agent/status';
