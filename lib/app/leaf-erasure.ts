/**
 * Leaf-app erasure cleanup hooks and stale writers — FILLED by Lelañea.
 *
 * A leaf app (a fork of Daybreak) registers here what Sunrise's `lib/app/erasure.ts` scaffold is
 * for: cleanup for the leaf's own data that the FK cascade cannot reach (object-storage blobs,
 * search documents, PII on rows an `ON DELETE SET NULL` table keeps), and, for each leaf file that
 * writes a column core erasure scrubs in place, a stale-writer declaration saying how it knows its
 * copy is stale. Daybreak keeps this empty: it is the leaf's seam, reserved so a leaf's
 * registrations merge cleanly on upgrade — the erasure analogue of `lib/app/leaf-data-export.ts`.
 *
 * Called by `lib/app/erasure.ts`'s `initAppErasureHooks()` AFTER the framework tier registers its
 * own (`lib/framework/privacy/erasure.ts` — a worked example of both):
 *
 * ```ts
 * import { registerErasureCleanupHook, registerStaleWriter } from '@/lib/privacy/erasure-hooks';
 *
 * export function initLeafErasureHooks(): void {
 *   registerErasureCleanupHook({
 *     name: 'leaf:avatars',
 *     cleanupExternal: async ({ userId }) => deleteAvatarBlobs(userId),
 *   });
 *   registerStaleWriter({
 *     file: 'lib/app/orders/notify-settings.ts',
 *     model: 'AiWebhookSubscription',
 *     anchor: 'version',
 *     how: 'Saves with the version it loaded; refused once the subscription moved.',
 *   });
 * }
 * ```
 *
 * **Name a hook so it cannot collide with the framework's.** Both registries are keyed — a hook by
 * `name`, a writer by `file` and `model` — so re-registering a key replaces it. Prefix yours
 * (`leaf:`); the framework's start `framework:`.
 *
 * **A throwing init takes the framework's registrations down with yours.** Core runs this and the
 * framework's registration as one unit and rolls the whole unit back on a throw, after which no
 * fork cleanup runs inside an erasure until it is fixed.
 *
 * Register synchronously: this function must not be `async`.
 *
 * @see lib/app/erasure.ts · lib/privacy/erasure-hooks.ts · .context/privacy/data-erasure.md
 */

import { registerWaitlistErasureHook } from '@/lib/app/waitlist/service';

export function initLeafErasureHooks(): void {
  // GDPR Art. 17. `app_waitlist_entry` is keyed by EMAIL, so the FK cascade
  // cannot reach the rows of anyone who joined before signing up — which is
  // everyone who has not accepted an invitation, since only the user-created
  // hook (`lib/app/user-created.ts`) writes `userId`. Without this hook an
  // erased account would leave that person's address, name and stated intent
  // on a table nothing points at. See `lib/app/waitlist/service.ts`. Moved here
  // from `leaf-bootstrap.ts` on the Daybreak 0.9.0 sync (t-174), so the hook is
  // registered wherever erasure runs, not only after a server boot.
  registerWaitlistErasureHook();
}
