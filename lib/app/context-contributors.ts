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
 * One contributor, for the `voice` context type (§05 t-27): the register a
 * moment calls for, plus real passages of her own writing, each labelled by
 * origin so the model can tell her material from the person's.
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
 * What sends the tuple today: the admin orchestration chat, which passes a
 * caller-supplied `contextType` straight through. The consumer route
 * deliberately refuses one ("admin-only concepts"), so the surface a member
 * eventually talks to her through will pin it server-side the way the
 * framework's module and facilitation routes pin theirs. Until that surface
 * exists this path is reachable and exercised but not yet on a member's turn —
 * stated here rather than left to be discovered.
 *
 * Pinned in `tests/unit/lib/app/defaults.test.ts` (`HB2`: pin the new value,
 * never delete the row) and asserted by registration in
 * `tests/unit/lib/app/context-contributors.test.ts`.
 *
 * Full guide + example: CUSTOMIZATION.md §4 · .context/orchestration/chat.md ·
 * .context/app/voice.md
 */

import { registerContextContributor } from '@/lib/orchestration/chat/context-builder';
import { VOICE_CONTEXT_TYPE, loadVoiceContext } from '@/lib/app/voice/context-contributor';

export function initAppContextContributors(): void {
  registerContextContributor(VOICE_CONTEXT_TYPE, loadVoiceContext);
}
