/**
 * App guard-event contributor registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the other
 * `lib/app/*` seams.
 *
 * Auto-wired: the chat handler calls this once before it first emits a guard
 * event (server route-handler runtime). Add
 * `registerGuardEventContributor(key, contributor)` calls to OBSERVE an inline
 * guard (input / output / citation) firing and react — notify, log, escalate —
 * keyed on the turn's `(contextType, contextId, agentId, userId,
 * conversationId)`.
 *
 * Fire-and-forget: a contributor runs after the guard acts and never delays or
 * breaks the turn; a throwing or rejecting contributor is logged and ignored.
 * Empty registry = inert / no-op. Observation only — it cannot change detection
 * or the guard's action (use the guard-floor seam to raise a guard's strictness).
 *
 * Full guide: CUSTOMIZATION.md §4 · .context/orchestration/chat.md
 */
import { registerGuardEventContributor } from '@/lib/orchestration/chat/guard-events';
import { MISUSE_RECORD_CONTRIBUTOR, recordGuardDetection } from '@/lib/app/safety/misuse';

/**
 * Lelañea registers one observer: a guard flagging a message on one of her seats
 * is written to the safety record (f-safety t-60, `lib/app/safety/misuse.ts`).
 * Daybreak's escalation observer, which notifies and audits, is registered by
 * the framework separately. Pinned in `tests/unit/lib/app/defaults.test.ts`
 * (`HB2`).
 */
export function initAppGuardEventContributors(): void {
  registerGuardEventContributor(MISUSE_RECORD_CONTRIBUTOR, recordGuardDetection);
}
