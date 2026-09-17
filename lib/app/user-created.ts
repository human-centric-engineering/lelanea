/**
 * App user-creation hook registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the other
 * `lib/app/*` seams.
 *
 * Auto-wired: better-auth's `user.create.after` hook calls this once before it
 * first dispatches (server runtime). Add `registerUserCreatedHook(key, hook)`
 * calls to react to a new account — provision a profile row, seed a default
 * workspace, start an onboarding sequence, push to a CRM.
 *
 * The hook receives `{ userId, email, name, signupMethod, viaInvitation }`.
 * `signupMethod` distinguishes OAuth (address already verified) from
 * email/password (not yet), and `viaInvitation` tells you the address was
 * already proven.
 *
 * Runs AFTER the user row exists, so a hook **cannot reject a signup** — a
 * throw is logged and ignored rather than failing account creation, since the
 * account is already there. Refusing a signup happens pre-creation, in
 * `userCreateBeforeHook` (lib/auth/config.ts); there is no fork seam for it
 * today. Empty registry = today's behaviour, byte-for-byte.
 *
 * Full guide: CUSTOMIZATION.md §4 · .context/auth/overview.md
 */
import { registerWaitlistLinkHook } from '@/lib/app/waitlist/service';

/**
 * Lelañea's one (t-46): the waitlist entry whose address matches the new
 * account becomes that account. Upstream ships this empty; the row in
 * `tests/unit/lib/app/defaults.test.ts` is PINNED to this registration rather
 * than deleted, so a stray second one still fails there (`HB2`).
 */
export function initAppUserCreatedHooks(): void {
  registerWaitlistLinkHook();
}
