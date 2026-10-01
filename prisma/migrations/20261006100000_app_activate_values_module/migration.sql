-- Activate the values module (§15 onboarding, t-106; owner ruling 30 Sept 2026).
--
-- Onboarding ends with "Begin the journey", which enters the person into the
-- `values` node of the published map. Daybreak's engine refuses to enter a
-- node whose module is not live, and only `active` is live
-- (`lib/framework/modules/liveness.ts`). Module rows are born `draft`, so
-- without this nobody could begin.
--
-- Values only, as the ruling says: each other module is activated when its
-- content lands. Status is operator-owned from here on: an admin sets it at
-- Framework -> Modules, and nothing in code writes it again.
--
-- Moves only a row still at `draft`, so a row an operator has already moved
-- is left alone. On a fresh database the row does not exist yet when
-- migrations run, so this matches nothing: the seed unit
-- `app-lelanea/022-activate-values` covers that case.
--
-- Not audited, for the reason the onboarding activation gives: Daybreak's
-- write path logs an admin action attributed to a person, and there is no
-- person here. This header is the record.

UPDATE "framework_module"
SET "status" = 'active', "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'values' AND "status" = 'draft';
