/**
 * Consumer chat exclusions — a seam a fork fills to keep a named agent off the
 * general consumer chat route.
 *
 * **Carried by Lelañea ahead of Sunrise** (`.context/app/divergences.md`,
 * Row 21). The consumer routes — `POST /api/v1/chat/stream` and
 * `GET /api/v1/chat/agents` — serve every active agent whose visibility admits
 * it. A fork that serves an agent through a surface of its own (one that runs
 * its own checks around each turn) can need that agent `public` for the
 * surface's sake without wanting the general route to reach it: a turn there
 * skips everything the fork's surface does. The authorization seam cannot say
 * no, because those routes name no resource to decide on.
 *
 * ## The contract
 *
 * - A registered slug is answered by the stream route **exactly** as an agent
 *   that does not exist — same status, same code, same message — and is left
 *   out of the agent listing. Neither route reveals that the agent exists.
 *   This does not hide it everywhere: `POST /api/v1/chat/agents/:slug/validate-token`
 *   answers every active agent, internal ones included, differently from an
 *   unknown slug. Nothing streams through that route, so it is not a way in.
 * - Only the consumer routes consult this. Admin chat, embed and any fork
 *   surface are untouched.
 * - With nothing registered, both routes behave exactly as before.
 *
 * Register from the fork's boot seam. The match is exact, like the routes' own
 * slug lookup.
 *
 * ## Why the store is on `globalThis`
 *
 * Next can bundle a route handler and the boot seam into separate module
 * graphs, each with its own copy of this file. A module-scoped set filled at
 * boot would be invisible to the route that reads it. Same reason, same fix, as
 * the facilitation turn hook (`lib/framework/facilitation/agents/turn-hook.ts`).
 */

const STORE_KEY = Symbol.for('sunrise.consumerChatExclusions');

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Set<string> };

function store(): Set<string> {
  const g = globalThis as GlobalWithStore;
  g[STORE_KEY] ??= new Set<string>();
  return g[STORE_KEY];
}

/** Keep the agent with this slug off the consumer chat routes. Idempotent. */
export function excludeFromConsumerChat(slug: string): void {
  store().add(slug);
}

/** Whether the consumer chat routes must not serve the agent with this slug. */
export function isExcludedFromConsumerChat(slug: string): boolean {
  return store().has(slug);
}

/** Test-only: forget every registration. */
export function resetConsumerChatExclusions(): void {
  store().clear();
}
