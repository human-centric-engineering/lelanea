-- f-content-seeds t-91: resources are retired, never deleted.
--
-- A conversation stores a resource suggestion by id and rebuilds its chip from
-- the library on every reload and replay. Deleting a resource would make those
-- chips vanish from history without an error, so the admin retires one instead:
-- it stops being offered, listed or suggested, and chip resolution still finds
-- it. The revision snapshot carries the flag because retiring is a change like
-- any other and the history has to say when it happened.
--
-- Additive with a default: every existing row stays live, and nothing else moves.

ALTER TABLE "app_resource" ADD COLUMN "retired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "app_resource_revision" ADD COLUMN "retired" BOOLEAN NOT NULL DEFAULT false;
