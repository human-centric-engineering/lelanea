-- f-onboarding t-101: each discovery question carries a weight. It is an admin
-- setting rather than her words, so it lives on the rows and their revisions,
-- never in the authored file. A question weighted 100 is core. It is not the
-- slot's `priorityWeight`, which stays 0: that is Daybreak's sequencing field.
-- The Core Set switch is not here: it is the Onboarding
-- module's own config (`framework_module.config`), which needs no migration.
--
-- Every existing question starts fully weighted (100), so switching the Core
-- Set on changes nothing until an admin lowers some weights, which is the
-- point: which questions are core is the owner's call, not a default.
--
-- Hand-written and applied with `db:migrate:deploy` (idea #34: `migrate dev`
-- refuses this repo's history). Two `ADD COLUMN`s with defaults; nothing is
-- dropped, so there is no spurious drop to strip (`B13`).

ALTER TABLE "app_discovery_question" ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "app_discovery_question_revision" ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 100;

-- She reads a person's discovery answers back through `get_state`, like any
-- other open slot (owner ruling at claim: the questions behave as data slots).
-- Her two slot grants store the read allowlist seed 013 wrote, and that seed
-- never touches an existing grant: the allowlist is an operator's. So existing
-- databases get the new group here.
--
-- Deliberately narrow, so it cannot undo an operator's choice:
-- - only her grants (`lelanea-guide`) on `get_state` and `fill_slot`;
-- - only where `read.groups` is an array, i.e. an allowlist is in force. A grant
--   with no read facet already reads everything, `discovery` included; a
--   malformed one fails closed and is left for its operator;
-- - only where `discovery` is absent. The group is new, so no operator can have
--   removed it, and re-running writes nothing.
UPDATE "ai_agent_capability" AS grant_row
SET "customConfig" = jsonb_set(
  grant_row."customConfig",
  '{read,groups}',
  (grant_row."customConfig" -> 'read' -> 'groups') || '["discovery"]'::jsonb
)
FROM "ai_agent" AS agent, "ai_capability" AS capability
WHERE grant_row."agentId" = agent."id"
  AND grant_row."capabilityId" = capability."id"
  AND agent."slug" = 'lelanea-guide'
  AND capability."slug" IN ('get_state', 'fill_slot')
  AND jsonb_typeof(grant_row."customConfig" -> 'read' -> 'groups') = 'array'
  AND NOT (grant_row."customConfig" -> 'read' -> 'groups') ? 'discovery';
