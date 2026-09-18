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

  registerAppDriftProbe({
    name: 'app_acknowledgement_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_acknowledgement',
    // The opposite policy to the waitlist's, and the reason the definition is
    // asserted rather than the existence: `ON DELETE CASCADE` IS the whole Art.
    // 17 disposition for this table — there is no erasure hook behind it — so a
    // constraint re-created with `NO ACTION` would pass an existence check while
    // making `eraseUser()` fail with `P2003` for everyone who ever reached the
    // gate, and one re-created with `SET NULL` would fail on the NOT NULL column.
    probe: constraintExists('app_acknowledgement_userId_fkey', 'ON DELETE CASCADE'),
  });

  registerAppDriftProbe({
    name: 'app_knowledge_designation_documentId_fkey (hand-written FK \u2192 ai_knowledge_document)',
    kind: 'FK constraint',
    table: 'app_knowledge_designation',
    // Third of the three, and the first pointing at a Sunrise table rather than
    // `user`. The definition is asserted, not just the existence, for the same
    // reason as the other two: `ON DELETE CASCADE` is what stops a deleted
    // document leaving its licensing note behind as an orphan row keyed on an id
    // nothing resolves \u2014 and a constraint re-created with `NO ACTION` would pass
    // an existence check while making `deleteDocument()` fail with `P2003` for
    // every document anyone had ever designated.
    probe: constraintExists('app_knowledge_designation_documentId_fkey', 'ON DELETE CASCADE'),
  });

  registerAppDriftProbe({
    name: 'app_voice_comparison_arm_evaluationRunId_fkey (hand-written FK → ai_evaluation_run)',
    kind: 'FK constraint',
    table: 'app_voice_comparison_arm',
    // Fourth of the four, and the second pointing at a Sunrise table. The
    // definition is asserted for the same reason as the others, and here the
    // action is the opposite of the obvious one: `ON DELETE SET NULL` is what
    // keeps this row — the stored prompt, the version, the record that the check
    // happened — when the run it points at is deleted. `AiEvaluationRun.user`
    // cascades, so erasing the admin who queued a comparison deletes their runs;
    // under `CASCADE` that destroyed the evidence too, and none of it is about
    // that admin. A constraint re-created with `CASCADE` would pass an existence
    // check while quietly restoring exactly that; one re-created with `NO ACTION`
    // would make every run deletion fail with `P2003`.
    //
    // The constraint is created by the `app_voice_comparison` migration with
    // `CASCADE` and corrected by `app_voice_comparison_arm_run_set_null`. This
    // probe is what makes that second migration verifiable: it asserts the
    // ACTION, not just the constraint's existence, so a database that only ever
    // ran the first one fails the drift check instead of passing it.
    //
    // Note the SIBLING constraint on this table —
    // `app_voice_comparison_arm_comparisonId_fkey` — is NOT probed, and that is
    // not an omission: both of its tables are ours and the relation is in
    // `prisma/schema/app.prisma`, so Prisma can see it and will never emit a
    // DROP for it. Probing it would imply this file is a list of every FK the
    // fork has, which is exactly the wrong thing to believe about it.
    probe: constraintExists('app_voice_comparison_arm_evaluationRunId_fkey', 'ON DELETE SET NULL'),
  });

  registerAppDriftProbe({
    name: 'app_user_budget_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_user_budget',
    // `ON DELETE CASCADE` is the whole Art. 17 disposition for a person's own
    // spending ceiling — no erasure hook stands behind it. Re-created with
    // `NO ACTION`, `eraseUser()` would fail with `P2003` for anyone an admin had
    // given a ceiling; with `SET NULL`, on the NOT NULL primary key.
    probe: constraintExists('app_user_budget_userId_fkey', 'ON DELETE CASCADE'),
  });
}
