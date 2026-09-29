-- t-116: the last two install-wide unique keys on app_* tables include orgId.
--
-- t-113 and t-114 keyed every name-keyed table per org; these two uniques were
-- left install-wide. At TENANCY_MODE=multi with the policies on, both would
-- fail a second org:
--
--   - app_acknowledgement (userId, kind, documentVersion): a person who
--     accepted a document in one org could not record it in another. The
--     insert hit the first org's row, and the fallback read could not see it.
--   - app_knowledge_designation.sourceKey: a second org's knowledge mirror
--     could not designate `foundational:the_mission`, because the first org's
--     row held that key.
--
-- No row moves. Every existing row is in the install org (t-112's backfill),
-- so a key that was unique across the install is unique within it, and the
-- new indexes build over the same rows. Hand-written, not `migrate diff`
-- output (B13).

-- The index builds read every row. On a database where `db:tenancy:enable`
-- has run (FORCE ROW LEVEL SECURITY) a NOBYPASSRLS owner would otherwise see
-- none of them (.context/tenancy/isolation.md). Transaction-local: Prisma runs
-- the file as one transaction.
SELECT set_config('app.bypass_rls', 'on', true);

-- app_acknowledgement
DROP INDEX "app_acknowledgement_userId_kind_documentVersion_key";
CREATE UNIQUE INDEX "app_acknowledgement_orgId_userId_kind_documentVersion_key" ON "app_acknowledgement"("orgId", "userId", "kind", "documentVersion");

-- app_knowledge_designation
DROP INDEX "app_knowledge_designation_sourceKey_key";
CREATE UNIQUE INDEX "app_knowledge_designation_orgId_sourceKey_key" ON "app_knowledge_designation"("orgId", "sourceKey");
