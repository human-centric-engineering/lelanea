-- §08 t-53 — AppAgentSettings / AppUserBudget: the agent's deadlines and what
-- one person may spend in a month, as settings an admin can change.
--
-- Owner ruling at claim: no first words within 8 seconds and the app speaks up;
-- a turn ends at 60 seconds; $5 per user per month to start — all of it
-- configurable, budgets per person. Nothing here enforces any of it: the
-- resolvers in lib/app/agent/settings.ts read these rows per request, and
-- §08 t-55, f-safety and f-budget are the readers that act on them.
--
-- THE SINGLETON IS CREATED HERE, ONCE (`fp4`). The `INSERT` below is the only
-- write any automated path ever makes to `app_agent_settings`: a migration is
-- recorded when applied and never re-run, so the row is born with the ruled
-- defaults in every database and is the admin's from then on. No seed and no
-- boot writes it. `ON CONFLICT DO NOTHING` is belt and braces for a database
-- where someone created the row by hand before this ran.
-- tests/unit/lib/app/agent/settings.test.ts holds the three values below equal
-- to the constants in lib/app/agent/settings.ts.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `app_user_budget.userId` is a plain
-- scalar with no Prisma `@relation`, because a fork table must not add a reverse
-- field to the Sunrise-owned `User` model (CUSTOMIZATION.md §5). So the FK is
-- HAND-WRITTEN below, against the MAPPED table `user` (`B11`), with
-- `ON DELETE CASCADE`: a ceiling set for a person is about that person and goes
-- when the account goes. The Art. 15 export returns it
-- (lib/app/leaf-data-export.ts). The singleton holds nothing about anyone and is
-- declared there as an exclusion.
--
-- Prisma cannot see that constraint, so a future `migrate dev` will emit a DROP
-- for it. lib/app/leaf-db-drift.ts registers a probe that pins both its
-- existence and its `ON DELETE` action; `npm run db:drift-check` fails if either
-- moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose, and the development command reads that
-- divergence as drift and "corrects" it.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which emitted 23 statements that are not ours ahead of the two CREATE TABLEs:
-- DROP CONSTRAINT for this fork's four existing hand-written FKs and for
-- fourteen framework FKs to `user`, `ai_agent`, `ai_knowledge_document`,
-- `ai_knowledge_tag`, `ai_workflow` and `ai_message`; DROP INDEX for the three
-- pgvector HNSW indexes and the tsvector GIN index; and the `searchVector`
-- DROP DEFAULT. Every one of them an object Prisma cannot model.
-- Everything below this line is the two tables this migration is for.

-- CreateTable
CREATE TABLE "app_agent_settings" (
    "slug" TEXT NOT NULL DEFAULT 'global',
    "firstWordsDeadlineMs" INTEGER NOT NULL,
    "turnDeadlineMs" INTEGER NOT NULL,
    "defaultMonthlyCeilingUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_agent_settings_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "app_user_budget" (
    "userId" TEXT NOT NULL,
    "monthlyCeilingUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_budget_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey — hand-written; the core `User` model maps to table "user".
ALTER TABLE "app_user_budget"
    ADD CONSTRAINT "app_user_budget_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The singleton, with the ruled defaults. See the header: written here once and
-- by the admin surface thereafter.
INSERT INTO "app_agent_settings" ("slug", "firstWordsDeadlineMs", "turnDeadlineMs", "defaultMonthlyCeilingUsd", "updatedAt")
VALUES ('global', 8000, 60000, 5, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
