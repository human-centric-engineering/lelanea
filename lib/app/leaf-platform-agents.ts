/**
 * Leaf-app platform-agent registrations — RESERVED, empty by default.
 *
 * A leaf app (a fork of Daybreak) registers its own platform agents here: agents every org gets its
 * own instance of, defined in code and kept in line with the definition by core's reconcile
 * (Sunrise §116; guide: `.context/orchestration/platform-agents.md`). Daybreak keeps this empty: it
 * is the leaf's seam, reserved so a leaf's registrations merge cleanly on upgrade — the
 * platform-agent analogue of `lib/app/leaf-bootstrap.ts` and `lib/app/leaf-data-export.ts`.
 *
 * Called by `lib/app/platform-agents.ts`'s `initAppPlatformAgents()` AFTER the framework tier
 * registers its own (the framework-rubric judge, `eval-judge-framework-rubric`). So registering a
 * slug the framework or Sunrise already uses replaces that definition in every org — allowed, and
 * logged at warn, because it changes an agent every org runs.
 *
 * **A throwing init takes the framework's agents down with yours.** Core runs this and the
 * framework's registrations as one unit and rolls the whole unit back on a throw (logged at
 * error), so the reconcile switches the rubric judge off in every org until the leaf is fixed —
 * and while it is unregistered its slug is not reserved, so an org admin could create their own
 * agent under it, which the reconcile would then never take over. `registerPlatformAgent` throws on
 * a slug that is not lowercase kebab-case, a repeated capability or knowledge-tag slug, and
 * `capabilityBindings: 'org'` with a non-empty `capabilities`; test yours.
 *
 * **An edit here does not re-run seed `021-platform-agents` on `db:seed`**: its `hashInputs` name
 * `lib/app/platform-agents.ts`, not this file. The maintenance tick applies it (it compares each
 * org's registry digest); on an install with no tick scheduled, touch `lib/app/platform-agents.ts`
 * or run the tick once.
 *
 * ```ts
 * import { registerPlatformAgent } from '@/lib/orchestration/agents/platform-agents';
 *
 * export function initLeafPlatformAgents(): void {
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
 * Do not register from `initApp()` / `initLeafApp()`: core reads this registry lazily in whichever
 * realm reads first, so a boot-time registration fills a map the reconcile never sees.
 *
 * @see lib/app/platform-agents.ts · lib/framework/platform-agents.ts
 */
export function initLeafPlatformAgents(): void {
  // No leaf platform agents by default.
}
