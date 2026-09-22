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
  another. A data-modifying CTE (`WITH moved AS (UPDATE … RETURNING *) INSERT …
SELECT … FROM moved`) writes the history only for rows that actually moved.
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

## When a seed unit is still right

When the rows are a **pure projection of code** that the unit fully reconciles
on every run (agent grants, capability rows), and the environment's
deploy runs `db:seed`. Even then, remember production only runs it when
someone does. If the change must land without anyone remembering, it is a
migration.
