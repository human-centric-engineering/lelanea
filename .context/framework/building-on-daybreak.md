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

Each bridge runs Daybreak's registration and then calls your `leaf-*` hook. Filling a
bridge directly collides with Daybreak on your next merge — and in the
`data-export.ts` case, resolving that conflict the obvious way silently drops the
framework's tables from every GDPR subject-access export.

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

---

## Versions

Your app reports three, on `GET /api/health`:

| Field      | Is                     | You set it                |
| ---------- | ---------------------- | ------------------------- |
| `version`  | **your** app's version | `package.json`            |
| `daybreak` | the framework version  | never — it merges through |
| `sunrise`  | the platform version   | never — it merges through |

Do not edit `lib/daybreak-version.ts` or `lib/sunrise-version.ts`. Editing them makes
your app claim a version it isn't running, which is worse than no answer.

---

## Where to read next

- [`README.md`](./README.md) — the three-tier ownership model in full
- [`VERSIONING.md`](./VERSIONING.md) — what a Daybreak version commits to
- [`CHANGELOG.md`](./CHANGELOG.md) — **read before every merge**
- [`../../CUSTOMIZATION.md`](../../CUSTOMIZATION.md) — the platform's own fork guide
