/**
 * App context-contributor registrations (prompt-context loaders) — FILLED by
 * Lelañea.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the landing
 * page: a starting point you're expected to modify.
 *
 * Auto-wired: `buildContext()` calls this once before its first lookup
 * (server route-handler runtime). Add `registerContextContributor(type,
 * loader)` calls to inject your own `LOCKED CONTEXT` block per turn for a
 * given `contextType`, without editing the core `buildContext` switch.
 *
 * ## What Lelañea registers
 *
 * Her voice block — the register a moment calls for, plus real passages of her
 * own writing, each labelled by origin so the model can tell her material from
 * the person's — under two context types:
 *
 * - `voice` (§05 t-27), keyed on a situation. What the admin chat sends.
 * - `facilitation` (§08 t-54), keyed on a seat. What Daybreak's facilitation
 *   route pins on every turn a person takes with her; the seat is mapped to a
 *   situation in `lib/app/voice/context-contributor.ts`. Daybreak registers
 *   nothing for this type, so the claim takes nothing from the framework.
 *
 * It is the second and third layers of the voice fingerprint. The first — the
 * always-on core — is not here and must not be: it rides on the agent's profile
 * and is present on every turn whether or not this block is
 * (`lib/app/voice/fingerprint.ts`).
 *
 * ## One block per turn, so a type is a claim on the whole turn
 *
 * A chat request carries exactly one `(contextType, contextId)` tuple, so a turn
 * gets one contributor's block and no other. Registering `voice` therefore does
 * not add a block to module turns, which carry Daybreak's `module` type — and
 * re-registering `module` here to wrap the framework's loader would be a leaf
 * quietly replacing a framework registration, which is the same mistake as
 * filling one of Daybreak's `lib/app/*` bridges.
 *
 * What sends each tuple: the admin orchestration chat passes a caller-supplied
 * `voice` straight through; Daybreak's facilitation route pins `facilitation`
 * server-side. The consumer route refuses a context type outright ("admin-only
 * concepts"), so a turn through it gets the always-on core and no block.
 *
 * Pinned in `tests/unit/lib/app/defaults.test.ts` (`HB2`: pin the new value,
 * never delete the row) and asserted by registration in
 * `tests/unit/lib/app/context-contributors.test.ts`.
 *
 * Full guide + example: CUSTOMIZATION.md §4 · .context/orchestration/chat.md ·
 * .context/app/voice.md
 */

import { registerContextContributor } from '@/lib/orchestration/chat/context-builder';
import {
  FACILITATION_CONTEXT_TYPE,
  VOICE_CONTEXT_TYPE,
  loadFacilitationVoiceContext,
  loadVoiceContext,
} from '@/lib/app/voice/context-contributor';

export function initAppContextContributors(): void {
  registerContextContributor(VOICE_CONTEXT_TYPE, loadVoiceContext);
  registerContextContributor(FACILITATION_CONTEXT_TYPE, loadFacilitationVoiceContext);
}
