-- f-journey-record t-145 — AppJourneyEntry: the journey record, a person's
-- session synopses and their own entries in one stream (product description
-- §3.16). Only lib/app/journey-record/ reads or writes it.
--
-- OURS, NOT DAYBREAK'S EVENT STREAM (owner ruling, 6 Oct 2026, at planning).
-- `framework_journey_event` is insert-only by contract, and this record is
-- edited and removed (§12). Ledgered in .context/app/divergences.md.
--
-- Two hand-written FKs, both ON DELETE CASCADE, against MAPPED tables (`B11`),
-- because a relation would add a reverse field to a model we do not own:
--   - "userId" → "user": erasing the person takes their record.
--   - "sessionId" → "framework_journey_event": a synopsis goes with the
--     session it describes (f-forget-session).
-- The CHECK below ties an entry's kind to its session and its state, so a
-- synopsis always has the session its cascade follows and an own entry is
-- never a draft.
--
-- Prisma cannot see the two hand-written FKs or the two CHECKs, so a future
-- `migrate dev` will emit DROPs for them. lib/app/leaf-db-drift.ts registers a
-- probe for each; `npm run db:drift-check` fails if one moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, then `npm run db:drift-check`.
-- Hand-written (idea #34: `migrate dev` cannot run on this repo).
--
-- TENANCY. The `org_isolation` policy ships dormant, like every other app_*
-- table's (20261003100100_app_org_isolation_policies). On a database where
-- `npm run db:tenancy:enable` has already run, run it again after this
-- migration so the new table's row security is switched on with the rest.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`;
-- only the statements naming app_journey_entry were kept. Everything else it
-- emitted was a DROP for an object Prisma cannot model (hand-written FKs,
-- vector and full-text indexes) and is not ours to remove.

-- CreateEnum
CREATE TYPE "app_journey_entry_kind" AS ENUM ('synopsis', 'own');

-- CreateEnum
CREATE TYPE "app_journey_entry_state" AS ENUM ('draft', 'kept');

-- CreateTable
CREATE TABLE "app_journey_entry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "app_journey_entry_kind" NOT NULL,
    "state" "app_journey_entry_state" NOT NULL,
    "sessionId" TEXT,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL DEFAULT '[]',
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "withheldFromAgent" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "keptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT,

    CONSTRAINT "app_journey_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — one synopsis per session, whatever its state.
CREATE UNIQUE INDEX "app_journey_entry_sessionId_key" ON "app_journey_entry"("sessionId");

-- CreateIndex
CREATE INDEX "app_journey_entry_userId_occurredAt_idx" ON "app_journey_entry"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "app_journey_entry_orgId_idx" ON "app_journey_entry"("orgId");

-- AddForeignKey
ALTER TABLE "app_journey_entry" ADD CONSTRAINT "app_journey_entry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — hand-written; the core `User` model maps to table "user".
ALTER TABLE "app_journey_entry"
    ADD CONSTRAINT "app_journey_entry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — hand-written; Daybreak's `JourneyEvent` maps to
-- "framework_journey_event", and a session is its `session.started` row.
ALTER TABLE "app_journey_entry"
    ADD CONSTRAINT "app_journey_entry_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "framework_journey_event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- An entry's shape. A synopsis names its session and has a one-line summary;
-- an own entry names no session and is kept from the moment it is written.
-- An entry is kept exactly when it has a time it was kept.
ALTER TABLE "app_journey_entry"
    ADD CONSTRAINT "app_journey_entry_shape_check"
    CHECK (
      (
        ("kind" = 'synopsis' AND "sessionId" IS NOT NULL AND "summary" IS NOT NULL)
        OR ("kind" = 'own' AND "sessionId" IS NULL AND "state" = 'kept')
      )
      AND (("state" = 'kept') = ("keptAt" IS NOT NULL))
    );

-- t-115: every app_* row names its org.
ALTER TABLE "app_journey_entry" ADD CONSTRAINT "app_journey_entry_orgId_not_null" CHECK ("orgId" IS NOT NULL);

-- t-112: dormant until `npm run db:tenancy:enable` (see TENANCY above).
CREATE POLICY "org_isolation" ON "app_journey_entry"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  );
