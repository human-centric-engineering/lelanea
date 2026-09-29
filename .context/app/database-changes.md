# Changing what existing databases hold

> **Rule (owner, 22 Sept 2026): a change that existing databases need ships as
> a migration.** Never only as an edit to seed content, and never as a manual
> step to run after deploying.
> This holds whenever a change must reach databases that are already running
> (dev, preview, production) and a `db:reset` is not an option.

## Why a migration, and not the seed

Of the two ways our code writes to a database that already exists, only one is
guaranteed to run everywhere:

|               | `db:migrate:deploy`                                           | `db:seed`                                                                    |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Production    | runs **before every `web` start** (`docker-compose.prod.yml`) | opt-in: `profiles: ['seed']`, only when someone runs it                      |
| Runs once per | database (`_prisma_migrations`)                               | database, per unit **source hash** (`SeedHistory`)                           |
| Content edits | n/a                                                           | an edit to `content/*.json` re-runs nothing unless the unit hashes that file |

And many of our seed units are **operator-owned**: they write once, while their
table is empty, and never again, so that an admin's later edits survive a
reseed. The slot taxonomy (`011-slot-taxonomy.ts`) is one. For those, editing
the JSON reaches **only a database that was never seeded**, and reseeding
changes nothing. The mistake is easy because the JSON edit looks like the
change.

So seed content is how a **fresh** database gets the new value, and a migration
is how every **existing** one does. A change usually needs both.

## Writing the data migration

- **Name it `app_…`** and give it a timestamp after the latest migration, like
  any of ours. Put a header comment saying what it moves, why, and which ruling
  or task asked for it. The migration is the only record some environments will
  ever have of the change.
- **Move only rows still at the old value.** That leaves a fresh database alone
  (it is empty when migrations run, because the seed runs after them) and it
  leaves alone any row an admin has already changed. It also makes the SQL
  safe to read as idempotent, though Prisma runs it once.
- **Write what the app's own write path writes.** If the table has a history
  (a version column, a revision table) or a projection another tier reads,
  update those too. Otherwise the record says one thing and the behaviour
  another. Writing the history from an `UPDATE … RETURNING` in a CTE records
  it only for the rows that actually moved.
- **Say who changed it.** Where the history has an origin or editor column,
  use the operator value (for example `origin = 'seed'`, `editorId` null), not
  a person.
- **Apply it with `npm run db:migrate:deploy`**, then run
  `npm run db:drift-check`. A data-only migration has no schema diff, so there
  is nothing for `migrate dev` to generate.
- **Check it against the dev database** before and after, reading the tables it
  touches. Verify by reading the rows, not by reading the migrate output.

Worked example: `prisma/migrations/20260926100000_app_health_slots_sensitive`
(t-84) moves the nine health slots to `sensitive`. It bumps each slot's
version, writes a revision snapshot, and updates the `framework_slot_definition`
projection that masking reads. The slot-specific notes are in
[`slots.md`](./slots.md#seeding--operator-owned-written-once-fp4).

The other shape, when the row is **missing** rather than at an old value:
`20260927100000_app_suggest_resource_capability` (t-93) inserts the
`suggest_resource` capability row and its grant to `lelanea-guide`, each
`WHERE NOT EXISTS`, so an admin's edited row and an operator's switched-off
binding are untouched and a database without the guide gets no dangling grant.
Where a migration carries a value the code also holds — there, the tool's
`functionDefinition` — **pin the two together in a test**: a migration is
frozen once applied, so nothing refactors it alongside the code
(`tests/unit/prisma/migrations/suggest-resource-capability.test.ts`).

## When a seed unit is still right

When the rows are a **pure projection of code** that the unit fully reconciles
on every run (agent grants, capability rows), and the environment's
deploy runs `db:seed`. Even then, remember production only runs it when
someone does. If the change must land without anyone remembering, it is a
migration.

## Tenancy: every table belongs to an org

Since Daybreak 0.6.0 (t-112), every `app_*` table carries `orgId`, backfilled
to the install org (`'install'`), with a dormant `org_isolation` policy and a
place in `leafOrgSources()` (`lib/app/leaf-data-export.ts`). A new model does
the same, or Sunrise's `model-classification`, `policy-coverage` and
`org-sources` guards fail naming it. The recipe is Daybreak's
(`.context/framework/building-on-daybreak.md`, "Tenancy"), and our two
migrations dated 2026-10-03 are the worked example.

- **You rarely write `orgId` yourself.** The tenancy client stamps it on
  every create and scopes every read to the current org. What changes is how
  you look a row up by a per-org key: a read is `findFirst({ where: { slug } })`,
  and a write keyed on it uses `orgId_slug: { orgId: requireOrgId(), slug }`.
  Scripts run outside a request, so they enter the install org with
  `runAsOrg(INSTALL_ORG_ID, main, { source: 'job' })`.
- **Some tables keep install-wide keys, on purpose (owner ruling,
  29 Sept 2026).** Fourteen are keyed by an authored name: the document,
  journey, resource and question-set collections, foundational documents,
  tiers, modules, discovery questions, resources, words keys, the voice
  overlay set and its situations, the golden set, and crisis region codes.
  `app_user_budget` is keyed by user id, so a person in two orgs would share
  one limit. At `TENANCY_MODE=single` none of that matters. **All fifteen
  must become per-org before anyone enables `multi`.** (`app_knowledge_designation`
  is keyed by a knowledge-document id, which is already per org, so it needs
  nothing.) The three tables whose key was a `slug` (`app_agent_settings`,
  `app_crisis_copy`, `app_slot_definition`) already are.

### A generated id must be the shape its readers expect

A migration that writes an id needs to know whether anything addresses that
row by id. `ai_capability.id` is a path parameter, and every admin route
validates it with `cuidSchema`, so a bare `gen_random_uuid()::text` would
create a row no admin page can open (t-93). **The column type does not decide
the id format; the table does.** When in doubt, use the cuid-shaped
`'c' || replace(gen_random_uuid()::text, '-', '')`.
