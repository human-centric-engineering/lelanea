/**
 * App platform-agent registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the other
 * `lib/app/*` seams.
 *
 * A platform agent is an agent your platform defines in code and every org
 * gets its own instance of — the way Sunrise ships its evaluation judges and
 * its document clean-up assistant. Register one here and the reconcile creates
 * it in every org (on org creation, on `npm run db:seed`, and from the
 * maintenance tick after a deploy changes the definitions), writes back the
 * fields it owns, and leaves the org's provider, model and spend settings
 * alone. Which fields are which is declared in the agent field registry.
 *
 * Auto-wired: the registry calls this once before its first read, in whichever
 * realm reads first. Registering from `initApp()` would fill a map the
 * reconcile never sees.
 *
 * @example
 * ```ts
 * import { registerPlatformAgent } from '@/lib/orchestration/agents/platform-agents';
 *
 * export function initAppPlatformAgents(): void {
 *   registerPlatformAgent({
 *     slug: 'intake-triage',
 *     audience: 'every-org',
 *     agent: {
 *       name: 'Intake Triage',
 *       description: 'Routes new requests to the right queue.',
 *       systemInstructions: 'You triage incoming requests…',
 *       temperature: 0.2,
 *       maxTokens: 2048,
 *     },
 *     capabilities: ['search_knowledge_base'],
 *     knowledgeTags: [],
 *   });
 * }
 * ```
 *
 * Registering a slug Sunrise already uses replaces Sunrise's definition in
 * every org. That is allowed, and logged at warn, because it changes an agent
 * every org runs. An org's own agent that already holds the slug is never
 * taken over: the reconcile skips it and logs why.
 *
 * Full guide: .context/orchestration/platform-agents.md
 */

import { logger } from '@/lib/logging';
import { getPlatformAgent } from '@/lib/orchestration/agents/platform-agents';
import {
  FRAMEWORK_PLATFORM_AGENTS,
  initFrameworkPlatformAgents,
} from '@/lib/framework/platform-agents';
import { initLeafPlatformAgents } from '@/lib/app/leaf-platform-agents';

export function initAppPlatformAgents(): void {
  // DAYBREAK — this is one of the `lib/app/*` bridges Daybreak fills (the roster is in CLAUDE.md's
  // banner). The framework registers its platform agents here, NOT from `initFramework()` at boot:
  // core's registry runs this lazily in whichever realm reads first, so a boot-time registration
  // would fill a map the reconcile never sees. Framework first, then the leaf, so a leaf registering
  // a framework slug replaces it (owner ruling, Hub t-142).
  //
  // One unit, as core's gate sees it: if the leaf's init throws, the gate rolls back EVERYTHING this
  // function registered — the framework's agents included — and logs it at error. The reconcile then
  // switches those agents off in every org until the leaf is fixed, and back on after (a definition's
  // `isActive` is the platform's). Isolating the leaf would need an `unregister` core does not have.
  initFrameworkPlatformAgents();
  initLeafPlatformAgents();
  // Core's gate warns when a fork replaces one of CORE's agents, comparing against the registry as it
  // stood before this init ran — which held no framework agents. So a leaf replacing a framework
  // agent is named here instead. (A read during the init sees the live registry; the gate latches.)
  for (const definition of FRAMEWORK_PLATFORM_AGENTS) {
    if (getPlatformAgent(definition.slug) !== definition) {
      logger.warn('platform-agents: a leaf definition replaced a framework platform agent', {
        slug: definition.slug,
      });
    }
  }
}
