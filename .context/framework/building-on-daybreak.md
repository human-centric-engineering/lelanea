---
name: building-on-daybreak
description: The guide for building a leaf app on Daybreak — what's yours, what's reserved, and how to sync a Daybreak release.
parent: README.md
---

# Building on Daybreak

The canonical guide for building an application **on top of** Daybreak. Audience:
leaf-app teams (e.g. `reclaim-your-week`).

This is the mirror, one tier up, of Sunrise's
[`CUSTOMIZATION.md`](../../CUSTOMIZATION.md) — read that too. It still applies: it
describes the platform underneath, and most of its guidance (route groups, the API
envelope, auth guards, adding dependencies) is what you build with day to day. This
file covers only what is **different because Daybreak sits in between**.

---

## The three tiers

```
Sunrise      the platform   — auth, API conventions, orchestration, security middleware
  └── Daybreak   the framework  — modules, facilitation maps, journeys, slots, guidance
        └── your app   the leaf   — your product
```

**You fork Daybreak, not Sunrise.** Daybreak carries Sunrise through, along with the
reconciliation work each platform sync required. See
[Syncing a release](#syncing-a-daybreak-release) for why merging Sunrise directly is
a trap.

| Tier         | Owns                                                                                                     | You treat it as       |
| ------------ | -------------------------------------------------------------------------------------------------------- | --------------------- |
| **Sunrise**  | core `lib/`, `app/api/v1`, security middleware, `CHANGELOG.md` / `VERSIONING.md` at root                 | upgradable dependency |
| **Daybreak** | `lib/framework/`, `.context/framework/`, `prisma/schema/framework-*.prisma`, the `lib/app/*` **bridges** | upgradable dependency |
| **your app** | `lib/app/leaf-*`, `.context/app/`, `prisma/schema/app.prisma`, `app/brand-theme.css`, your own new files | freely yours          |

---

## What's yours, and the four files that aren't

Daybreak reserves a leaf surface and keeps it empty for you — the same discipline it
inherits from Sunrise, applied one level down. **Fill the `leaf-*` files, not the
bridges they delegate to.**

| Fill this (yours)             | NOT this (Daybreak's) | Registers                                                       |
| ----------------------------- | --------------------- | --------------------------------------------------------------- |
| `lib/app/leaf-bootstrap.ts`   | `bootstrap.ts`        | one-time server boot work                                       |
| `lib/app/leaf-admin-nav.ts`   | `admin-nav.ts`        | admin sidebar sections                                          |
| `lib/app/leaf-db-drift.ts`    | `db-drift.ts`         | Prisma-unmodelled DB objects                                    |
| `lib/app/leaf-data-export.ts` | `data-export.ts`      | your tables in a subject export, and their Art. 15 declarations |
| `lib/app/leaf-brand.ts`       | `brand.ts`            | product name, legal entity, meta description                    |
| `lib/app/leaf-ci.ts`          | `ci.ts`               | your own coverage exclusions and whole-tree always-run tests    |

Each bridge runs Daybreak's registration and then calls your `leaf-*` hook. Filling a
bridge directly collides with Daybreak on your next merge — and in the
`data-export.ts` case, resolving that conflict the obvious way silently drops the
framework's tables from every GDPR subject-access export.

**`leaf-ci.ts` is where your CI declarations go** — a `tsx` CLI script of your own
is structurally 0% and will fail the per-file coverage floor the first time anyone
edits it, and a test whose subject is the repository is reached by no import chain,
so a scoped run never selects it. Both lists append to Daybreak's, which append to
Sunrise's, and every guard Sunrise wrote over those lists judges your entries in
your checkout: a reason under 20 characters or a duplicate fails either list, and an
always-run path must exist, be passable to `vitest` as an argument, and sit in a
directory `vitest.config.ts` actually collects. See `lib/app/ci.ts` for two worked
examples.

**`leaf-brand.ts` is the one that OVERRIDES rather than appends.** Brand identity is
single-valued: your name replaces Daybreak's, it does not compose with it. A
non-`null` value wins; `null` falls through to Daybreak's, then to Sunrise's. Note
these three values used to be `NEXT_PUBLIC_*` env vars — Sunrise 0.11.0 removed them,
because `NEXT_PUBLIC_*` is inlined at build time and `.dockerignore` excludes `.env*`,
so on a container build they delivered nothing and the footers shipped someone else's
name. Setting them in `.env` now does nothing, and a boot warning names each one you
have left set.

**`leaf-data-export.ts` now carries two exports, and the second is not optional.**
Beside `collectLeafSubjectData()` there is `initLeafSubjectSources()`, where you
declare each model in `prisma/schema/app.prisma` as a subject-data source or as an
exclusion with a reason. Sunrise 0.10.0 holds a fork tier's schema file to **full
accounting** — every model, no third state — so `tests/unit/lib/privacy/export-sources.test.ts`
fails naming any model that is neither. Full accounting rather than a `userId` scan
because core reads its own column vocabulary and cannot read yours: a table keyed
`authorId`, or reached by a join, is invisible to a scan and is exactly the table
nobody remembers. Your section names must not collide with the framework tier's —
the registry refuses a section another tier claimed.

**Every other `lib/app/*` file is yours to fill as normal** (`capabilities.ts`,
`context-contributors.ts`, `env.ts`, `rate-limit.ts`, `public-nav.ts`,
`protected-nav.ts`, `auth-landing.ts`, `emails.ts`, `csp.ts`, `jobs.ts`,
`user-created.ts`, …) — Daybreak keeps those empty for you.

> **Which files are Daybreak's is itself versioned surface.** A file changing hands
> is a breaking change and is called out in [`CHANGELOG.md`](./CHANGELOG.md) — that
> is exactly what happened to `data-export.ts` in `0.1.0`. Read the changelog before
> merging, not after.

---

## Importing `@/lib/framework` from your own code

Daybreak bans `@/lib/framework` imports from core and app-shell code. The reason is
not hygiene: a static `@/lib/framework` specifier resolves at **build** time, so
upstream Sunrise — or a sibling fork with no `lib/framework/` folder — would fail
`next build`. In **your** repo that folder always exists, so the ban is not
protecting you from anything; it is protecting the tiers above you. You have two
ways through it, and the first is free.

### 1. Use the reserved namespaces (no configuration)

Sunrise and Daybreak both keep these empty for you, and they are already exempt:

| Your code                | Reserved path            |
| ------------------------ | ------------------------ |
| Consumer API routes      | `app/api/v1/app/**`      |
| Authenticated pages      | `app/(protected)/app/**` |
| Public pages             | `app/(public)/app/**`    |
| Auth-flow pages          | `app/(auth)/app/**`      |
| Admin pages              | `app/admin/app/**`       |
| React components         | `components/app/**`      |
| Server-side registration | `lib/app/**`             |
| Your seeds               | `prisma/seeds/app-*/**`  |

Put a route that calls `applyJourneyTransition` or `resolveModuleSurface` at
`app/api/v1/app/runs/route.ts` and it just works — no override, and nothing to
re-do on a Daybreak upgrade.

### 2. Use your own vocabulary, and re-permit it yourself

If you would rather your URLs read `programme` or `journal` than `app`, that is a
perfectly good reason to leave the reserved namespaces — Daybreak cannot exempt your
words, because the next leaf has different ones and they would accumulate in a
framework-owned config forever. Re-permit them in your own
`lib/app/eslint.config.mjs`, which the root config spreads **last** so your block
wins for your files:

```js
export default [
  {
    files: ['app/(protected)/programme/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // RESTATE the alias ban — see the footgun below.
            { group: ['./*', '../*'], message: 'Use the @/ path alias.' },
          ],
        },
      ],
    },
  },
];
```

**This is the supported mechanism, not a workaround.** The seam exists precisely so
a leaf can make this call.

> **The flat-config footgun.** `no-restricted-imports` **replaces** rather than
> merges across matching blocks. A block that omits the `@/`-alias ban does not
> inherit it — it silently turns relative-import enforcement off for those paths.
> Restate the whole rule per glob.

## Seeding framework configuration

Your seeds can activate a module, bind an agent, or publish a map that references
one — all of which need the `Module` rows, their slot definitions and the framework
capability rows to exist. Those are created at **server boot**, and a standalone
`db:seed` never boots the app.

**Daybreak handles this for you.** `prisma/seeds/_framework/000-framework-boot.ts`
runs the framework boot sequence against the database, and it sorts after the core
seeds and before any `app-…` directory, so by the time your seeds run the rows are
there. `db:reset` and CI need no action from you at all.

### The one case you have to handle yourself

The seed runner **skips a unit whose source hash is unchanged**, so the boot seed
runs once and then not again. That is fine for a fresh database, `db:reset` and CI.
It is not fine here:

> You add a new module to your leaf, and a new seed that configures it. You run
> `db:seed` against your existing dev database. The boot seed is skipped — its
> source did not change — so your new module never gets its `Module` row, and your
> new seed fails.

Call the seam at the top of your own seed's `run()`. Your unit's hash _does_ change
when you edit it, so the sync happens exactly when it is needed:

```ts
import type { SeedUnit } from '@/prisma/runner';
import { syncFrameworkForSeed } from '@/lib/framework/seed';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';

const unit: SeedUnit = {
  name: 'my-module-config',
  async run({ prisma }) {
    await syncFrameworkForSeed({ registerLeaf: initLeafApp });
    // ...your module's rows now exist; configure them.
  },
};
export default unit;
```

It is idempotent, so calling it when the boot seed already ran is safe. It is not
free of noise, though: re-registering a framework capability logs
`registerFrameworkCapability: duplicate slug — last registration wins` per
capability, and the registry is `globalThis`-backed, so it persists across seed
units in one process. Call it from the seeds that need it rather than from all of
them, or those warnings will outnumber your actual output. They are harmless — the
last registration is identical to the first.

**Pass `registerLeaf`.** It runs between framework registration and the database
reconcile, which is the only correct position: the reconcile does not just write
what it finds, it treats modules missing from the registry as **removed**. Omit the
hook in a process that has leaf modules and the sync will do exactly that.

`syncFrameworkForSeed()` throws where the server-boot bridge logs and continues —
deliberately. A seed that silently failed to establish the framework would be
recorded as applied, and the next seed would fail a long way from the cause.

### Seeds are exempt, but core seeds are not

Seed files run via `tsx` and are never part of `next build`, so the build-time
argument does not reach them — `prisma/seeds/app-*/**` may import the framework
freely. That is _not_ a blanket exemption for `prisma/seeds/`: the numbered core
seeds at the top level (`prisma/seeds/001-system-owner.ts`, …) are Sunrise's and
stay banned, because they exist upstream and in forks with no framework tier.

---

## Syncing a Daybreak release

```bash
git remote add daybreak git@github.com:human-centric-engineering/daybreak.git
git fetch daybreak --tags
git merge daybreak-v0.2.0
```

Then, because a release usually carries Sunrise migrations as well as Daybreak ones:

```bash
npm install                  # the release may move dependencies
npm run db:migrate:status    # what's pending
npm run db:migrate:deploy    # apply (dev: db:migrate:dev)
npm run db:drift-check
```

**Tags are prefixed `daybreak-v`.** A bare `vX.Y.Z` in this repo is a **Sunrise** tag
— they share a namespace, so the prefix is what tells them apart.

### Never merge Sunrise directly

It is tempting when Sunrise ships something you want. Don't:

- You get platform changes **Daybreak hasn't reconciled yet**, and you solve that
  reconciliation yourself — differently from how Daybreak will.
- You then conflict with Daybreak's version of the same resolution on your next merge.
- Concretely: Sunrise v0.8.0's export coverage guard fails for any fork with its own
  user-linked tables. Daybreak solved it once, in a way that also routes leaves to
  `leaf-data-export.ts`. A leaf that had merged Sunrise directly would have solved it
  by filling `data-export.ts` — the file Daybreak now owns.

Wait for the Daybreak release. If something upstream is urgent, ask Daybreak to sync.

### Resolving conflicts

Keep **your** version in files you own, keep **theirs** in files you don't, and add a
follow-up rather than rewriting a Daybreak or Sunrise file in place. A one-line "keep
mine" is a cheap merge; a rewritten framework file is not.

---

## Migrations — three tiers, one directory

`prisma/migrations/` holds all three tiers' migrations, applied in timestamp order,
so a Daybreak release's migrations **interleave with yours**.

- **Prefix yours** — `npm run db:migrate:dev -- --name app_add_bookings`. The prefix
  is for human triage; Prisma orders by folder name regardless.
- **Your models go in `prisma/schema/app.prisma`** with `@@map("app_…")` table names.
  `framework_*` is Daybreak's prefix and `ai_*` / core tables are Sunrise's.
- **Never edit a Daybreak or Sunrise migration's SQL.** Add your own follow-up
  migration instead; editing an applied migration desyncs every environment.
- After a merge: `db:migrate:status` → `db:migrate:deploy`.

---

## Two tests you are expected to adjust

Both are working as designed — they assert a property a leaf is _supposed_ to
violate. **Adjust the one row; don't delete the file**, or you lose the protection
for everything else it covers.

- **`tests/unit/lib/daybreak-version.test.ts`** — the case asserting
  `DAYBREAK_VERSION === package.json.version` fails in your repo, correctly: your
  `package.json` carries **your** version while `DAYBREAK_VERSION` keeps reporting
  the framework's. Delete that one case.
- **`tests/unit/lib/app/defaults.test.ts`** — asserts every `lib/app/*` seam ships
  empty. When you fill one, **pin the new value** in its `SEAM_DEFAULTS` row rather
  than removing the row.

  **Filling a `leaf-*` seam breaks two rows, not one** — its own, and the row for
  the **bridge above it**, a file you never touched. The bridge reads your seam, so
  your value changes the bridge's resolved value. Confirmed for `brand.ts`,
  `admin-nav.ts` and `ci.ts`; see issue #234. Pin both.

---

## Versions

Your app reports three, and **they are not all on the same endpoint** — 0.2.0 moved
two of them:

| Field                    | Is                     | Read it from                                | You set it                |
| ------------------------ | ---------------------- | ------------------------------------------- | ------------------------- |
| `version`                | **your** app's version | `GET /api/health` (unauthenticated)         | `package.json`            |
| `system.daybreakVersion` | the framework version  | `GET /api/v1/admin/stats` (`withAdminAuth`) | never — it merges through |
| `system.sunriseVersion`  | the platform version   | `GET /api/v1/admin/stats` (`withAdminAuth`) | never — it merges through |

All three are also rendered together on `/admin/overview`, which is where an operator
answers "did that upgrade actually ship?" without a terminal.

**Why the split.** `/api/health` is unauthenticated — load balancers and orchestrators
probe it — so a framework or platform version there names the exact set of published
issues to try against **every** Daybreak-derived deployment, not just yours. Your own
app version is different in kind: it means nothing outside your leaf, it is yours to
disclose, and health checks read it. If your monitoring asserted on `body.daybreak` or
`body.sunrise`, that breaks on this release; see the Removed entry in
[`CHANGELOG.md`](./CHANGELOG.md).

Do not edit `lib/daybreak-version.ts` or `lib/sunrise-version.ts`. Editing them makes
your app claim a version it isn't running, which is worse than no answer.

---

## Where to read next

- [`README.md`](./README.md) — the three-tier ownership model in full
- [`VERSIONING.md`](./VERSIONING.md) — what a Daybreak version commits to
- [`CHANGELOG.md`](./CHANGELOG.md) — **read before every merge**
- [`../../CUSTOMIZATION.md`](../../CUSTOMIZATION.md) — the platform's own fork guide
