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
 * Two capabilities mounted OVER an upstream one rather than beside it — same
 * slug, same schema, same function definition, because a new slug would lose
 * what is keyed on the old one and would advertise a second tool for the same
 * job — and one of the app's own.
 *
 * - **`search_knowledge_base`** — her search, with each result labelled by whose
 *   material it is (f-safety t-60). The subclass runs the platform's search
 *   unchanged, then adds the label for her agents only. A new slug would lose
 *   the chat handler's citation path, which is keyed on this one.
 * - **`fill_slot`** — Daybreak's capture, guarded so one turn writes a slot once
 *   (f-slots t-72). The subclass adds the turn-scoped idempotency the framework
 *   cannot have, because the turn id is this leaf's. Everything else — the
 *   exposure allowlist, masking, the typed-value extraction, the audit
 *   redaction — is inherited untouched.
 *
 * - **`suggest_resource`** — the agent hands a person one of Lelañea Fulton's
 *   videos, audio or articles, by id, when it fits (f-resources t-77). The
 *   app's own tool, not an override: its `ai_capability` row and the grant to
 *   the guide are `prisma/seeds/app-lelanea/014-suggest-resource.ts`.
 *
 * `get_state` is granted but NOT mounted here: it is read-only, and nothing
 * about it needs a leaf's turn.
 *
 * The registry flushes app capabilities after the built-ins, so these handlers
 * are the ones the dispatcher holds. Pinned in
 * `tests/unit/lib/app/defaults.test.ts` (`HB2`: pin the new value, never delete
 * the row).
 */
import { registerAppCapability } from '@/lib/orchestration/capabilities/registry';
import { SuggestResourceCapability } from '@/lib/app/resources/suggest';
import { LabelledSearchKnowledgeCapability } from '@/lib/app/safety/labelled-search';
import { GuardedFillSlotCapability } from '@/lib/app/slots/capture';

export function initAppCapabilities(): void {
  registerAppCapability(new LabelledSearchKnowledgeCapability());
  registerAppCapability(new GuardedFillSlotCapability());
  registerAppCapability(new SuggestResourceCapability());
}
