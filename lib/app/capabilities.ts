/**
 * App capability (agent tool) registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the landing
 * page: a starting point you're expected to modify.
 *
 * Auto-wired: `registerBuiltInCapabilities()` calls this once before the first
 * agent dispatch (server route-handler runtime). Add
 * `registerAppCapability(new YourTool())` calls (your tools extend
 * `BaseCapability`).
 *
 * Full guide + example: CUSTOMIZATION.md §4 · .context/orchestration/capabilities.md
 *
 * ## What Lelañea registers
 *
 * One capability, mounted OVER a built-in rather than beside it: her search,
 * with each result labelled by whose material it is (f-safety t-60). Same slug,
 * same schema and function definition. The subclass runs the platform's search
 * unchanged, then adds the label for her agents only. A new slug would lose the
 * chat handler's citation path, which is keyed on this one.
 *
 * The registry flushes app capabilities after the built-ins, so this handler is
 * the one the dispatcher holds. Pinned in `tests/unit/lib/app/defaults.test.ts`
 * (`HB2`: pin the new value, never delete the row).
 */
import { registerAppCapability } from '@/lib/orchestration/capabilities/registry';
import { LabelledSearchKnowledgeCapability } from '@/lib/app/safety/labelled-search';

export function initAppCapabilities(): void {
  registerAppCapability(new LabelledSearchKnowledgeCapability());
}
