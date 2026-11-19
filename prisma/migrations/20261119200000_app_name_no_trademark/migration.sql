-- The app's name drops its ™ (owner ruling, 19 Nov 2026): Lelanea is not yet
-- a registered trademark, so nothing should claim it is.
--
-- WHAT IT MOVES, on every database that already exists
-- (`.context/app/database-changes.md`): the one seeded place the name carried
-- the mark, the Terms of Use title, which read "Lelanea™" and now reads
-- "Lelanea", as `content/lelanea_foundational_documents.json` does.
--
-- A correction of the product's name, as `20261119100000_app_name_lelanea`
-- was: no revision is written and no revision number moves, so an admin
-- mid-edit is not refused for a change they cannot see. Revision history is
-- corrected with its rows, so an old revision still reads back the same as its
-- current row. Only a title still at exactly "Lelanea™" moves; an admin's own
-- title is left alone.

SELECT set_config('app.bypass_rls', 'on', true);

UPDATE "app_foundational_document" SET "title" = 'Lelanea' WHERE "title" = 'Lelanea™';

UPDATE "app_foundational_document_revision" SET "title" = 'Lelanea' WHERE "title" = 'Lelanea™';
