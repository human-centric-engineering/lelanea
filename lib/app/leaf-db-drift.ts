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

import { registerAppDriftProbe, constraintExists, indexExists } from '@/lib/db/drift-probes';

/**
 * t-115. Every `app_*` table with an `orgId` column: each carries
 * `<table>_orgId_not_null`, `CHECK ("orgId" IS NOT NULL)`
 * (`20261004100300_app_org_id_required`).
 *
 * Written out rather than derived, so registering the probes needs neither a
 * Prisma runtime model nor a raw query. The list cannot fall behind the schema
 * unnoticed: `tests/unit/lib/app/org-id-check-roster.test.ts`, always-run,
 * fails until a new `app_*` model with `orgId` is added here, and the drift
 * check then fails until its migration adds the CHECK.
 */
export const APP_ORG_OWNED_TABLES = [
  'app_acknowledgement',
  'app_agent_settings',
  'app_crisis_copy',
  'app_crisis_region',
  'app_discovery_question',
  'app_discovery_question_revision',
  'app_document_collection',
  'app_foundational_document',
  'app_foundational_document_revision',
  'app_journey',
  'app_journey_module',
  'app_journey_module_revision',
  'app_journey_tier',
  'app_journey_tier_revision',
  'app_knowledge_designation',
  'app_memory_embedding',
  'app_question_set',
  'app_question_set_revision',
  'app_resource',
  'app_resource_collection',
  'app_resource_revision',
  'app_resource_words',
  'app_resource_words_revision',
  'app_safety_event',
  'app_slot_definition',
  'app_slot_definition_revision',
  'app_turn',
  'app_turn_slot_write',
  'app_user_budget',
  'app_voice_comparison',
  'app_voice_comparison_arm',
  'app_voice_golden_set',
  'app_voice_golden_set_revision',
  'app_voice_overlay',
  'app_voice_overlay_revision',
  'app_voice_overlay_set',
  'app_voice_overlay_set_revision',
  'app_waitlist_entry',
] as const;

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

  registerAppDriftProbe({
    name: 'app_turn_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_turn',
    // `ON DELETE CASCADE` is the whole Art. 17 disposition for a person's turn
    // records — no erasure hook stands behind it. Re-created with `NO ACTION`,
    // `eraseUser()` would fail with `P2003` for everyone who ever talked to the
    // agent; with `SET NULL`, on the NOT NULL column.
    probe: constraintExists('app_turn_userId_fkey', 'ON DELETE CASCADE'),
  });

  registerAppDriftProbe({
    name: 'app_turn_sessionId_fkey (hand-written FK → framework_journey_event)',
    kind: 'FK constraint',
    table: 'app_turn',
    // f-recap t-141. Prisma cannot see this relation (it would add a reverse
    // field to Daybreak's `JourneyEvent`), so it emits a DROP for it on the
    // next generated migration. `ON DELETE SET NULL` is the action: a turn's
    // metering outlives its session row. Re-created with `NO ACTION`, removing
    // a session (f-forget-session) would fail with `P2003` for every sitting
    // that had a turn in it; with `CASCADE`, it would silently delete the
    // turns' metering with it.
    probe: constraintExists('app_turn_sessionId_fkey', 'ON DELETE SET NULL'),
  });

  registerAppDriftProbe({
    name: 'app_turn_slot_write_turnId_fkey (hand-written FK → app_turn)',
    kind: 'FK constraint',
    table: 'app_turn_slot_write',
    // Prisma DOES model this relation, unlike the others in this file — the
    // probe is here because the migration is hand-written (`migrate dev` cannot
    // run against this tree; see the migration's own note), so nothing
    // regenerates the constraint if it is lost.
    //
    // `ON DELETE CASCADE` is the second link of this table's Art. 17 chain:
    // `user` → `app_turn` → here (f-slots t-72). With `NO ACTION`, erasing an
    // account would fail with `P2003` for anyone who ever had something noted
    // about them, and the failure would surface in `eraseUser()` — two tables
    // away from the row that caused it.
    probe: constraintExists('app_turn_slot_write_turnId_fkey', 'ON DELETE CASCADE'),
  });

  registerAppDriftProbe({
    name: 'app_safety_event_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_safety_event',
    // `ON DELETE CASCADE` is the whole Art. 17 disposition for a person's
    // safety events (f-safety t-58). With `NO ACTION`, `eraseUser()` would fail
    // for everyone the crisis path ever answered.
    probe: constraintExists('app_safety_event_userId_fkey', 'ON DELETE CASCADE'),
  });

  registerAppDriftProbe({
    name: 'app_slot_definition_revision_editorId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_slot_definition_revision',
    // The action is asserted, not just the existence, and here the DANGEROUS
    // drift is the one that looks tidiest. `ON DELETE SET NULL` (f-slots t-70)
    // is what keeps a revision — the wording as it stood, and the date it
    // changed — when the admin who made that edit is erased. The history is
    // about the taxonomy, not about the editor, and every slot value captured
    // after a revision is read against it. A constraint re-created with
    // `CASCADE` would pass an existence check while making one admin's erasure
    // silently delete the wording history that OTHER people's answers resolve
    // through; one re-created with `NO ACTION` would make `eraseUser()` fail
    // with `P2003` for every admin who ever edited a definition.
    probe: constraintExists('app_slot_definition_revision_editorId_fkey', 'ON DELETE SET NULL'),
  });

  registerAppDriftProbe({
    name: 'app_foundational_document_revision_editorId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_foundational_document_revision',
    // f-content-seeds t-86. The same reasoning as the slot revision probe above.
    // `SET NULL` keeps the record of what her documents said on a given day,
    // including the Terms a person agreed to, when the admin who edited them is
    // erased. `CASCADE` would delete that record with the admin, and `NO ACTION`
    // would make `eraseUser()` fail for every admin who ever edited a document.
    probe: constraintExists(
      'app_foundational_document_revision_editorId_fkey',
      'ON DELETE SET NULL'
    ),
  });

  // f-content-seeds t-87. The same reasoning again, for the six revision tables
  // of the journey's text, the discovery questions and the resource library:
  // `SET NULL` keeps the record of what the words said when the admin who edited
  // them is erased, and anything else either deletes that record or makes
  // `eraseUser()` fail for every admin who ever edited one.
  for (const table of [
    'app_journey_tier_revision',
    'app_journey_module_revision',
    'app_question_set_revision',
    'app_discovery_question_revision',
    'app_resource_revision',
    'app_resource_words_revision',
    // f-content-seeds t-88. The two revision tables of the voice overlays, for
    // exactly the same reason.
    'app_voice_overlay_set_revision',
    'app_voice_overlay_revision',
    'app_voice_golden_set_revision',
  ]) {
    registerAppDriftProbe({
      name: `${table}_editorId_fkey (hand-written FK → user)`,
      kind: 'FK constraint',
      table,
      probe: constraintExists(`${table}_editorId_fkey`, 'ON DELETE SET NULL'),
    });
  }

  // f-memory t-129. The per-person index (`app_memory_embedding`). Every
  // object below is what makes "an embedding goes with its source" true (owner
  // ruling 2), and none is visible to Prisma. Each action is asserted, not just
  // the existence: re-created with `NO ACTION`, the user FK makes `eraseUser()`
  // fail with `P2003` for anyone who ever spoke, and the message FK makes every
  // message, exchange and conversation deletion fail the same way. With
  // `SET NULL`, the vector of a deleted message would outlive it, searchable.
  registerAppDriftProbe({
    name: 'app_memory_embedding_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_memory_embedding',
    probe: constraintExists('app_memory_embedding_userId_fkey', 'ON DELETE CASCADE'),
  });
  registerAppDriftProbe({
    name: 'app_memory_embedding_messageId_fkey (hand-written FK → the message table)',
    kind: 'FK constraint',
    table: 'app_memory_embedding',
    probe: constraintExists('app_memory_embedding_messageId_fkey', 'ON DELETE CASCADE'),
  });
  registerAppDriftProbe({
    // f-memory t-107. Deleting a version outright (erasure's cascade to slot
    // values) takes its vector. Wiping one in place does not fire it; that is
    // `forgetWipedNotes`, in the wipe's own transaction.
    name: 'app_memory_embedding_slotValueId_fkey (hand-written FK → the slot value table)',
    kind: 'FK constraint',
    table: 'app_memory_embedding',
    probe: constraintExists('app_memory_embedding_slotValueId_fkey', 'ON DELETE CASCADE'),
  });
  registerAppDriftProbe({
    // A row without its source's id would have no cascade to follow it. Probed
    // on the note half, which only t-107's widened CHECK has, so the t-129
    // CHECK it replaced does not pass for it.
    name: 'app_memory_embedding_source_check (every row names its source)',
    kind: 'CHECK constraint',
    table: 'app_memory_embedding',
    probe: constraintExists('app_memory_embedding_source_check', '"slotValueId" IS NOT NULL'),
  });
  registerAppDriftProbe({
    // Without it a search still answers, by a sequential scan over every vector.
    name: 'idx_app_memory_embedding (HNSW memory embedding)',
    kind: 'HNSW index',
    table: 'app_memory_embedding',
    probe: indexExists('idx_app_memory_embedding', 'hnsw'),
  });

  // t-115. Every app_* table refuses a row with no org. A CHECK, because
  // Prisma cannot model one, so `migrate dev` would drop it. A row with no org
  // would be seen by no org and caught by no per-org key.
  for (const table of APP_ORG_OWNED_TABLES) {
    registerAppDriftProbe({
      name: `${table}_orgId_not_null (every row names its org)`,
      kind: 'CHECK constraint',
      table,
      probe: constraintExists(`${table}_orgId_not_null`, '"orgId" IS NOT NULL'),
    });
  }
}
