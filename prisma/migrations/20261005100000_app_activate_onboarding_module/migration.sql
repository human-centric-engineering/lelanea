-- Activate the onboarding module (§15 onboarding, t-102; owner ruling 30 Sept 2026).
--
-- A person's journey starts when they pass the gate, by entering the
-- `onboarding` node of the published map. Daybreak's engine refuses to enter a
-- node whose module is not live, and only `active` is live
-- (`lib/framework/modules/liveness.ts`). Every `framework_module` row is born
-- `draft`, so without this no journey can be entered by anyone.
--
-- Onboarding only. The other sixteen modules are activated when their content
-- lands (Values with t-106). Status is operator-owned from here on: an admin
-- sets it at Framework -> Modules, and nothing in code writes it again.
--
-- Moves only a row still at `draft`, so a row an operator has already moved
-- (to `active`, `scheduled` or `retired`) is left alone. On a fresh database
-- the row does not exist yet when migrations run, so this matches nothing:
-- the seed unit `app-lelanea/021-activate-onboarding` covers that case.
--
-- Not audited: Daybreak's write path (`updateModuleSettings`) logs an admin
-- action attributed to a person, and there is no person here. This header is
-- the record.

UPDATE "framework_module"
SET "status" = 'active', "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'onboarding' AND "status" = 'draft';
