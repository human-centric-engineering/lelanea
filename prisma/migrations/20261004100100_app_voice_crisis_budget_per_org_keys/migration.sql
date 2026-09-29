-- t-114: the last five name-keyed tables are keyed per org.
--
-- The second half of t-113 (20261004100000_app_content_per_org_keys), and the
-- same shape: a generated `id` primary key, the authored name unique with
-- `orgId`, and children pointing at the parent's generated id while keeping
-- its name in a plain column.
--
--   - app_voice_overlay_set, app_voice_golden_set: the authored id moves to
--     `slug`; their revisions and the overlays keep `setSlug` beside `setId`.
--   - app_voice_overlay: `situation` stays as its name, unique per org; its
--     revisions keep `situation` beside a new `overlayId`.
--   - app_crisis_region: `region` stays, unique per org.
--   - app_user_budget: `userId` stays, unique per org, so a person in two orgs
--     has a limit in each. Its hand-written FK to "user" is untouched.
--
-- As in t-113, the set FKs are ON UPDATE CASCADE, so replacing a set's id in
-- step 3 carries it into its children. Generated ids use the cuid-shaped
-- expression (t-93, .context/app/database-changes.md). Hand-written, not
-- `migrate diff` output (B13).

-- Every step reads and writes tenant-owned rows. On a database where
-- `db:tenancy:enable` has run (FORCE ROW LEVEL SECURITY) a NOBYPASSRLS owner
-- would otherwise see none of them (.context/tenancy/isolation.md).
-- Transaction-local: Prisma runs the file as one transaction.
SELECT set_config('app.bypass_rls', 'on', true);

-- 1. Children keep their set's authored name
ALTER TABLE "app_voice_overlay_set_revision" ADD COLUMN "setSlug" TEXT;
UPDATE "app_voice_overlay_set_revision" SET "setSlug" = "setId";
ALTER TABLE "app_voice_overlay_set_revision" ALTER COLUMN "setSlug" SET NOT NULL;

ALTER TABLE "app_voice_overlay" ADD COLUMN "setSlug" TEXT;
UPDATE "app_voice_overlay" SET "setSlug" = "setId";
ALTER TABLE "app_voice_overlay" ALTER COLUMN "setSlug" SET NOT NULL;

ALTER TABLE "app_voice_golden_set_revision" ADD COLUMN "setSlug" TEXT;
UPDATE "app_voice_golden_set_revision" SET "setSlug" = "setId";
ALTER TABLE "app_voice_golden_set_revision" ALTER COLUMN "setSlug" SET NOT NULL;

-- 2. The sets keep their authored name
ALTER TABLE "app_voice_overlay_set" ADD COLUMN "slug" TEXT;
UPDATE "app_voice_overlay_set" SET "slug" = "id";
ALTER TABLE "app_voice_overlay_set" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_voice_golden_set" ADD COLUMN "slug" TEXT;
UPDATE "app_voice_golden_set" SET "slug" = "id";
ALTER TABLE "app_voice_golden_set" ALTER COLUMN "slug" SET NOT NULL;

-- 3. Generated set ids. ON UPDATE CASCADE carries each into its children.
UPDATE "app_voice_overlay_set" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_voice_golden_set" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');

-- 4. Overlays: keyed by `situation`, so they gain an id and their revisions an
-- `overlayId`, backfilled from the situation (the old primary key, so it
-- alone finds the parent).
ALTER TABLE "app_voice_overlay" ADD COLUMN "id" TEXT;
UPDATE "app_voice_overlay" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
ALTER TABLE "app_voice_overlay" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "app_voice_overlay_revision" ADD COLUMN "overlayId" TEXT;
UPDATE "app_voice_overlay_revision" r
   SET "overlayId" = o."id"
  FROM "app_voice_overlay" o
 WHERE o."situation" = r."situation";
ALTER TABLE "app_voice_overlay_revision" ALTER COLUMN "overlayId" SET NOT NULL;

ALTER TABLE "app_voice_overlay_revision" DROP CONSTRAINT "app_voice_overlay_revision_situation_fkey";
DROP INDEX "app_voice_overlay_revision_situation_revision_key";
DROP INDEX "app_voice_overlay_revision_situation_changedAt_idx";
ALTER TABLE "app_voice_overlay" DROP CONSTRAINT "app_voice_overlay_pkey";
ALTER TABLE "app_voice_overlay" ADD CONSTRAINT "app_voice_overlay_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "app_voice_overlay_revision_overlayId_revision_key" ON "app_voice_overlay_revision"("overlayId", "revision");
CREATE INDEX "app_voice_overlay_revision_overlayId_changedAt_idx" ON "app_voice_overlay_revision"("overlayId", "changedAt");
ALTER TABLE "app_voice_overlay_revision" ADD CONSTRAINT "app_voice_overlay_revision_overlayId_fkey" FOREIGN KEY ("overlayId") REFERENCES "app_voice_overlay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Crisis regions and user budgets: no children, so a generated id takes
-- the primary key and the old key becomes unique per org.
ALTER TABLE "app_crisis_region" ADD COLUMN "id" TEXT;
UPDATE "app_crisis_region" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
ALTER TABLE "app_crisis_region" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "app_crisis_region" DROP CONSTRAINT "app_crisis_region_pkey";
ALTER TABLE "app_crisis_region" ADD CONSTRAINT "app_crisis_region_pkey" PRIMARY KEY ("id");

ALTER TABLE "app_user_budget" ADD COLUMN "id" TEXT;
UPDATE "app_user_budget" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
ALTER TABLE "app_user_budget" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "app_user_budget" DROP CONSTRAINT "app_user_budget_pkey";
ALTER TABLE "app_user_budget" ADD CONSTRAINT "app_user_budget_pkey" PRIMARY KEY ("id");

-- 6. Authored names are unique per org
CREATE UNIQUE INDEX "app_voice_overlay_set_orgId_slug_key" ON "app_voice_overlay_set"("orgId", "slug");
CREATE UNIQUE INDEX "app_voice_golden_set_orgId_slug_key" ON "app_voice_golden_set"("orgId", "slug");
CREATE UNIQUE INDEX "app_voice_overlay_orgId_situation_key" ON "app_voice_overlay"("orgId", "situation");
CREATE UNIQUE INDEX "app_crisis_region_orgId_region_key" ON "app_crisis_region"("orgId", "region");
CREATE UNIQUE INDEX "app_user_budget_orgId_userId_key" ON "app_user_budget"("orgId", "userId");
-- The old primary key was the only index leading with userId. Reads of one
-- person's budgets, and the cascade when a user is erased, still need one.
CREATE INDEX "app_user_budget_userId_idx" ON "app_user_budget"("userId");
