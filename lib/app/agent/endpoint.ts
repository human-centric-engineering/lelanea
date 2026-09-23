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

/** Anyone's spend, grouped — `?by=user|conversation|seat|model|day` (§08 t-56). */
export const ADMIN_METERING_ENDPOINT = '/api/v1/admin/app/metering';

/**
 * A path segment, encoded. A turn id is client-chosen (any trimmed 1–128
 * characters), so one of `.` or `..` would resolve away — and escaping cannot
 * stop that: the URL standard treats `%2E` and `%2E%2E` as dot segments too.
 * The only fix is refusing such ids where turns are accepted; until then the
 * cost is one admin link that 404s, on a turn its own person named that way.
 */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/** One conversation's turns, each with its cost (f-budget t-97). */
export function adminConversationTurnsEndpoint(conversationId: string): string {
  return `${ADMIN_METERING_ENDPOINT}/conversations/${segment(conversationId)}`;
}

/** One person's turn, every cost row it caused (§08 t-56). */
export function adminTurnMeterEndpoint(userId: string, turnId: string): string {
  return `${ADMIN_METERING_ENDPOINT}/users/${segment(userId)}/turns/${segment(turnId)}`;
}

/** Where an admin reads what this month cost, and who and what spent it (t-97). */
export const COST_ADMIN_PAGE = '/admin/app/cost';

/** A costly conversation, opened to its turns. */
export function costConversationPage(conversationId: string): string {
  return `${COST_ADMIN_PAGE}/conversations/${segment(conversationId)}`;
}

/** One turn, opened to every row it cost. Person and turn, as the turn route is. */
export function costTurnPage(userId: string, turnId: string): string {
  return `${COST_ADMIN_PAGE}/turns/${segment(userId)}/${segment(turnId)}`;
}
