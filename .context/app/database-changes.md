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
  every create. Reads are **not** filtered by org at `TENANCY_MODE=single`:
  there is one org, and a query sees every row. At `multi` the `org_isolation`
  policies scope each query to the current org. So code looks a row up by its
  per-org name, and the database decides whose: a read is
  `findFirst({ where: { slug } })`, and a write keyed on the name uses
  `orgId_slug: { orgId: requireOrgId(), slug }`, or `where: { id: row.id }`
  when you already hold the row. Scripts run outside a request, so they enter
  the install org with `runAsOrg(INSTALL_ORG_ID, main, { source: 'job' })`.
- **Authored names are per org, beside a generated id.** Every table keyed by
  a name follows `app_slot_definition` (t-112): a generated `id` primary key,
  the name in `slug` with `@@unique([orgId, slug])`, and children pointing at
  the parent's generated id while keeping its name in a plain `…Slug` column
  (`journeySlug` beside `journeyId`). A table whose key already had its own
  name keeps it, unique per org: resource words' `key`, an overlay's
  `situation`, a crisis `region`, a budget's `userId`. The ten content tables
  moved in t-113 (`20261004100000_app_content_per_org_keys`), and the voice,
  crisis and budget tables in t-114 (`20261004100100_app_voice_crisis_budget_per_org_keys`),
  so every table keyed by a name is now keyed per org. The API, the content
  files and the `changedFields` stored in revisions still say `id`,
  `documentId`, `moduleId`: only the Prisma layer uses the new names.
  - **Write both columns of a child.** A child needs its parent's generated
    id, so a write that creates both reads the parents back
    (`createManyAndReturn`) and looks each id up with `idsBySlug`
    (`lib/app/content/row-ids.ts`), inside one interactive transaction.
  - **A budget is per person per org.** `app_user_budget` is unique on
    `(orgId, userId)`, so a person in two orgs has a limit in each.
  - **Prove it at `multi`.** At `single` nothing shows two orgs apart, so
    `npm run smoke:app-per-org-content` runs against a throwaway database with
    the policies enabled (its docblock has the steps).
- **Other unique keys include `orgId` too** (t-116,
  `20261004100200_app_acknowledgement_designation_per_org_uniques`).
  `app_acknowledgement` is unique on `(orgId, userId, kind, documentVersion)`,
  so a person accepts a document in each org they join, and the repeat read
  in `recordAcknowledgement` is keyed by `requireOrgId()`. That includes
  `age_18`: a second org asks again, because each org keeps its own record
  and cannot read another's.
  `app_knowledge_designation` is unique on `(orgId, sourceKey)`, so each org's
  knowledge mirror holds `foundational:the_mission` for itself. The mirror
  cron (`/api/v1/app/cron/knowledge-mirror`) reconciles every active org, each
  inside its own scope through `forEachOrg` (t-115). A new unique key on an
  `app_*` table starts with `orgId`, or it fails the second org at `multi`.
- **Every row names its org, and the database refuses one that does not**
  (t-115, `20261004100300_app_org_id_required`). `orgId` stays nullable in
  the schema, as Sunrise's own columns do, so Prisma's types are unchanged,
  but every tenant-owned `app_*` table carries
  `CHECK ("orgId" IS NOT NULL)`, named `<table>_orgId_not_null`. A row with no
  org would belong to nobody: no org's screens would show it, and no per-org
  key would catch a duplicate of it, because Postgres treats two NULLs as
  different. The tenancy client stamps every create, and only a create under
  `runAsSystem` goes unstamped, so a system-scope write to an `app_*` table
  now fails loudly. Prisma cannot model a CHECK, so each is pinned by a drift
  probe over `APP_ORG_OWNED_TABLES` (`lib/app/leaf-db-drift.ts`). That list
  is written out, and `tests/unit/lib/app/org-id-check-roster.test.ts`
  (always-run) pins it to the tenant-owned roster: a new `app_*` model fails
  there until it is listed, then `db:drift-check` fails until its migration
  adds the CHECK. Adding a model means both.
- **Lookups rely on the policies, not on an explicit org** (t-115, the
  owner's ruling). Leaf code reads by name inside an org, as Sunrise and
  Daybreak do, and names the org explicitly only where Prisma needs it: a
  `findUnique` or `upsert` on a per-org compound key (`orgId_slug`, and the
  like), or a write that must pair with one. Two orgs are isolated only at
  `TENANCY_MODE=multi` with `db:tenancy:enable` run.
  - **So a second org is never hosted at `single`.** Sunrise's lifecycle API
    will create one there, and a session can act in it, but nothing scopes a
    read at `single`: an editor in the second org could edit the install
    org's copy of a document, and its members could read the install org's
    content. Explicit org filters in our code would not make that safe,
    because the platform's conversations, agents and knowledge base would
    still mix. Switch to `multi` first.
  - **An explicit org filter is not a fix for a leak at `multi`.** If a read
    crosses orgs there, a policy is missing or off, and the fix is the
    policy: `db:drift-check` as the app role, and
    `smoke:app-per-org-content`, show which.

### A generated id must be the shape its readers expect

A migration that writes an id needs to know whether anything addresses that
row by id. `ai_capability.id` is a path parameter, and every admin route
validates it with `cuidSchema`, so a bare `gen_random_uuid()::text` would
create a row no admin page can open (t-93). **The column type does not decide
the id format; the table does.** When in doubt, use the cuid-shaped
`'c' || replace(gen_random_uuid()::text, '-', '')`.
