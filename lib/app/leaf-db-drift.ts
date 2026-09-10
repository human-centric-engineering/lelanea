/**
 * Leaf-app database drift-probe registration — Lelañea's Prisma-unmodelled objects.
 *
 * Called by `lib/app/db-drift.ts`'s `registerAppDriftProbes()` after the
 * framework probes are registered, and run by `npm run db:drift-check` (CI, and
 * `/pre-pr`). Upstream Daybreak ships this empty.
 *
 * Register the objects Prisma cannot see. Prisma computes desired state from
 * the schema, so anything the schema cannot express is invisible to it and a
 * future `migrate dev` will emit a `DROP` for it — silently, and already
 * applied to the local database by the time you read the generated SQL.
 */

import { registerAppDriftProbe, constraintExists } from '@/lib/db/drift-probes';

export function registerLeafDriftProbes(): void {
  registerAppDriftProbe({
    name: 'app_waitlist_entry_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_waitlist_entry',
    // The second argument asserts the constraint DEFINITION, not just its
    // existence. That is the half that matters: `ON DELETE SET NULL` is the
    // erasure policy for this table's link to an account, it lives only in
    // un-reviewed migration SQL, and a constraint re-created with `NO ACTION`
    // would pass an existence check while breaking `prisma.user.delete()` with
    // `P2003` for every user who had ever joined the waitlist.
    probe: constraintExists('app_waitlist_entry_userId_fkey', 'ON DELETE SET NULL'),
  });
}
