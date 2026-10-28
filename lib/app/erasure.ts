/**
 * App erasure cleanup-hook registrations (GDPR Art. 17).
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the other
 * `lib/app/*` seams.
 *
 * Auto-wired: `getErasureCleanupHooks()` (`lib/privacy/erasure-hooks.ts`) calls
 * this once before its first read, in the module graph `eraseUser()` runs in.
 * Add `registerErasureCleanupHook({ name, cleanupExternal?, scrubInTransaction? })`
 * calls for app data the FK cascade cannot reach: object-storage blobs, search
 * documents, and PII left on rows your `ON DELETE SET NULL` tables keep.
 *
 * Must be synchronous — register here, do the async work inside the hook.
 *
 * Full guide + example: .context/privacy/data-erasure.md · CUSTOMIZATION.md §4
 */
import { initFrameworkErasureHooks } from '@/lib/framework/privacy/erasure';
import { initLeafErasureHooks } from '@/lib/app/leaf-erasure';

export function initAppErasureHooks(): void {
  // DAYBREAK — one of the `lib/app/*` bridges Daybreak fills (the roster is in CLAUDE.md's banner).
  // The framework registers its erasure hook (binding templates) and its stale writer (the module
  // dispatcher) here, NOT from `initFramework()` at boot: core's registry runs this lazily before
  // its first read and re-runs it after a reset, and Sunrise's stale-writer test reads only what
  // this registers. Framework first, then the leaf. A leaf init that throws rolls the framework's
  // registrations back with its own: core's gate treats the two as one unit.
  initFrameworkErasureHooks();
  initLeafErasureHooks();
}
