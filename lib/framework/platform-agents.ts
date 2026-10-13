/**
 * The framework tier's platform agents (Hub t-142) — agents every org gets its own instance of,
 * defined in code and reconciled by core (Sunrise §116).
 *
 * Registered from the `lib/app/platform-agents.ts` bridge, NOT from `initFramework()` at boot. Core's
 * registry runs its own lazy init (`createAppInitGate` → `initAppPlatformAgents()`) in whichever
 * realm reads first, and resets back to core's list in tests; a boot-time registration would fill a
 * map the reconcile in another realm never sees. Same trap, same shape as the subject-source
 * declarations (`lib/app/data-export.ts` → `initFrameworkSubjectSources()`).
 */

import { registerPlatformAgent } from '@/lib/orchestration/agents/platform-agents';
import type { PlatformAgentDefinition } from '@/lib/orchestration/agents/platform-agents';
import { FRAMEWORK_RUBRIC_JUDGE_AGENT } from '@/lib/framework/facilitation/evaluation/rubric-judge';

/** Every platform agent the framework defines, in registration order. */
export const FRAMEWORK_PLATFORM_AGENTS: readonly PlatformAgentDefinition[] = [
  FRAMEWORK_RUBRIC_JUDGE_AGENT,
];

/** Register the framework's platform agents. Called by the bridge, before the leaf's. */
export function initFrameworkPlatformAgents(): void {
  for (const definition of FRAMEWORK_PLATFORM_AGENTS) registerPlatformAgent(definition);
}
