# Daybreak framework docs (`.context/framework/`)

This folder is **Daybreak's own documentation** — the framework layer's docs,
one tier above Sunrise's platform substrate and one tier below a leaf app's own
docs. Daybreak is a **framework built on Sunrise**, and apps are built by forking
**Daybreak** (not Sunrise directly). That makes three tiers, and this folder
exists to keep them cleanly separated.

## The three tiers

| Tier                   | Is                        | Owns (code)                                   | Owns (docs)               | Reserves for its forks       |
| ---------------------- | ------------------------- | --------------------------------------------- | ------------------------- | ---------------------------- |
| **Sunrise**            | the platform              | core `lib/`, `components/`, `app/api/v1` core | `.context/<domain>/`      | `lib/app/*`, `.context/app/` |
| **Daybreak** (here)    | the framework, on Sunrise | `lib/framework/` + its registration seams     | **`.context/framework/`** | `lib/app/*`, `.context/app/` |
| **App** (e.g. Lelanea) | a leaf, forks Daybreak    | fills `lib/app/*`, own routes/models          | `.context/app/`           | —                            |

The load-bearing rule, applied **twice** (Sunrise→Daybreak, and Daybreak→App):
**a tier extends the tier below through seams; it never occupies the surface it
reserves for its own forks.**

- `.context/<domain>/` (`auth/`, `orchestration/`, …) is **Sunrise's** — merges
  from Sunrise upstream; don't edit it.
- **`.context/framework/` is Daybreak's** — Daybreak's feature/domain docs. A
  leaf app inherits this from Daybreak and treats it like Sunrise's docs: read,
  don't edit; it merges through on a Daybreak upgrade.
- **`.context/app/` is the leaf app's** — Daybreak (like Sunrise) ships **nothing**
  into it, so a leaf's docs never conflict on a Daybreak or Sunrise merge.

> **Why this folder is not `.context/app/`.** Daybreak used to keep its docs in
> `.context/app/`. But that is the namespace Sunrise reserves for _its_ forks —
> and Daybreak _is_ such a fork, while also being a framework with its _own_
> forks. Occupying `.context/app/` would do to Lelanea exactly what Sunrise was
> careful not to do to Daybreak. So Daybreak's docs live here, and `.context/app/`
> stays empty and available for leaf apps. (Decision: 2026-07-02, see the plan's
> decisions log.)

## What Daybreak owns vs. extends vs. reserves

**Daybreak-owned — Daybreak edits freely (a leaf app treats these as upstream):**

- `lib/framework/` — the framework code and its registration seams
  (`registerModule()`, the map, slot definitions, guidance, …)
- `prisma/schema/framework-*.prisma` + `framework_`-prefixed migrations, touching
  only `framework_*` tables (the boundary CI keys on this prefix — see
  [`planning/f-bootstrap.md`](./planning/f-bootstrap.md) and the spec's Appendix B)
- **`.context/framework/`** — this folder
- The Daybreak-owned region of `CLAUDE.md` (its banner)

**Sunrise-owned — Daybreak extends through a seam, never edits:**

- Core `lib/` utilities, core `app/api/v1` routes, core `components/`, the
  security / rate-limit middleware (`proxy.ts`, `lib/security/**`)
- `lib/sunrise-version.ts`, `VERSIONING.md`, `CHANGELOG.md`, and `.context/**`
  **except `.context/framework/` and `.context/app/`**, plus the SQL of any
  **Sunrise** migration
- Daybreak registers its framework pieces into Sunrise's seams **from within
  `lib/framework/`** (driven by `initFramework()`) — exactly as Sunrise
  registers its own built-ins from core. The **six exceptions** are the
  `lib/app/*` **bridges** Daybreak fills: `bootstrap.ts` (server boot →
  `initFramework()`), `admin-nav.ts` (client sidebar → the framework nav
  section), `data-export.ts` (subject access → the framework's own GDPR Art. 15
  manifest), `brand.ts` (product name + legal entity → `lib/brand.ts`),
  `db-drift.ts` (Prisma-unmodelled DB objects) and `ci.ts` (coverage exclusions
  - always-run tests → `vitest.config.ts` and `ALWAYS_RUN_TESTS`). CLAUDE.md's
    banner carries the same roster; count them there rather than from an ordinal
    in a docblock. A
    framework registration that must run in a realm `initFramework()` can't reach —
    server-boot, the client sidebar, a lazy seam whose init core owns, or a static
    value core imports directly — has nowhere else to go; each delegates to a
    reserved leaf hook (`leaf-bootstrap.ts` / `leaf-admin-nav.ts` /
    `leaf-data-export.ts` / `leaf-brand.ts`). `brand.ts` is the one where the leaf
    **overrides** rather than appends — brand identity is single-valued, so a leaf
    replaces Daybreak's name rather than composing with it. Otherwise Daybreak does
    **not** fill `lib/app/*` (see next).

  `data-export.ts` has the most history behind it. Sunrise v0.8.0 (#467) shipped
  subject access assuming exactly **two** tiers — core declares its tables in
  `lib/privacy/export-sources.ts`, the leaf declares its own in
  `lib/app/data-export.ts` — and a framework fork has three, so Daybreak
  occupied the seam and handed the leaf `leaf-data-export.ts` beside it. Sunrise
  0.10.0 landed the contributor seam that was asked for (#533):
  `registerAppSubjectSources({ tier: 'framework' })`. The bridge **stays**, and
  that is not an oversight — upstream requires a framework tier to register from
  the leaf's lazy `initAppSubjectSources()` rather than from `initFramework()` at
  boot, because the registry re-runs only that lazy seam and a boot-time
  contribution is lost the first time anything resets it. What the delegation did
  remove is the fork edit to Sunrise's core guard test, which is byte-identical
  to upstream again.

  The framework's own manifest lives at `lib/framework/privacy/export-sources.ts`.
  **Core owns the coverage check now** — `tests/unit/lib/privacy/export-sources.test.ts`
  holds every model in `prisma/schema/framework-*.prisma` to **full accounting**
  against what the manifest registers: declared as a source, or excluded with a
  reason the data subject is shown verbatim, with no third state. That is
  stronger than the `userId` / `createdBy` scan Daybreak used to run, which could
  not see a table reached by a join — `FrameworkConversationEval` was invisible to
  it, and silently absent from every export, until full accounting forced the
  question.

  `tests/unit/lib/framework/privacy/export-sources.test.ts` keeps what core cannot
  do: **disposition ↔ erasure parity**. The dispositions mirror the policy already
  in each migration — a `userId` column with `ON DELETE CASCADE` exports in full;
  a `createdBy` column with `SET NULL` exports as attribution. **Both halves of
  GDPR must agree on what a row is** — change one, change the other. Core reads its
  own column vocabulary, not our migrations, so nothing upstream can check that.

  The bundle shape changed with the delegation: the framework's sections sit flat
  under `app` rather than nested in `app.framework`, and core emits `meta.app` and
  `meta.excluded` in place of the `meta` block the fork used to build. That is a
  breaking change for a leaf — see [`CHANGELOG.md`](./CHANGELOG.md).

**Reserved for the leaf app — Daybreak keeps these empty:**

- `lib/app/*` **leaf** scaffolds (`capabilities.ts`, `context-contributors.ts`,
  `knowledge-access-contributors.ts`, `guard-floor-contributors.ts`,
  `guard-event-contributors.ts`, `modules.ts`, `leaf-bootstrap.ts`,
  `leaf-admin-nav.ts`, `leaf-data-export.ts`, …) — Sunrise ships these empty;
  Daybreak keeps them empty
  (and may add new empty framework-concept scaffolds like `lib/app/modules.ts`)
  for the **leaf app** to fill. Daybreak filling one would collide with the
  leaf's own registrations on a Daybreak upgrade. (The `bootstrap.ts` /
  `admin-nav.ts` / `data-export.ts` bridges above are the deliberate exception —
  Daybreak fills those, and the leaf uses their `leaf-*` counterparts.) The four
  `*-contributors.ts` files are Sunrise's **auto-wire** seams (a seam lazily
  calls `initApp<Seam>Contributors()` on first use); Daybreak registers its own
  framework contributors a different way — see [Contributor registration](#contributor-registration-the-framework-pushes-the-leaf-pulls).
- `.context/app/`, `prisma/schema/app.prisma` + `app_…` migrations,
  `app/brand-theme.css`, `NEXT_PUBLIC_APP_NAME` — the leaf's surface.

If Daybreak genuinely must change Sunrise behaviour and no seam exists: keep the
edit minimal and add a follow-up rather than rewriting the file. A one-line
"keep mine" is a cheap merge; a rewritten platform file fights every release.

## Contributor registration: the framework pushes, the leaf pulls

Sunrise v0.6/0.7 gave each contributor seam an **auto-wire** entry point: the
seam lazily calls `initApp<Seam>Contributors()` from a reserved
`lib/app/<seam>-contributors.ts` file the first time it runs. There are four —
chat context, knowledge access, and the two inline-guard seams:

| Seam file (leaf surface, kept empty)       | Pulled by                      |
| ------------------------------------------ | ------------------------------ |
| `lib/app/context-contributors.ts`          | `buildContext()`               |
| `lib/app/knowledge-access-contributors.ts` | `resolveAgentDocumentAccess()` |
| `lib/app/guard-floor-contributors.ts`      | `collectGuardFloors()`         |
| `lib/app/guard-event-contributors.ts`      | `emitGuardEvent()`             |

Daybreak registers its **own** four framework contributors the other way — by
**push**, from `initFramework()` (`lib/framework/index.ts`):

| Framework contributor    | Registered with                                      |
| ------------------------ | ---------------------------------------------------- |
| module prompt context    | `registerContextContributor(MODULE_CONTEXT_TYPE, …)` |
| module knowledge access  | `registerAgentAccessContributor(…)`                  |
| facilitation guard-floor | `registerGuardFloorContributor(…)`                   |
| facilitation escalation  | `registerGuardEventContributor(…)`                   |

**Why push and not a bridge** (the way `bootstrap.ts` / `admin-nav.ts` are
filled)? Those two are bridges only because a framework registration that must
run at **server boot** or in the **client sidebar** has no other entry point —
`initFramework()` can't reach those realms. Contributors have no such
constraint: they run in the server route-handler realm that `initFramework()`
already owns, so the registrations sit next to the framework's capability/slot
wiring (which must be eager at boot anyway). Bridging the four would add
`leaf-*-contributors.ts` indirection for zero extra reach.

**What this means for a leaf app on Daybreak:** to add a contributor, edit the
`lib/app/<seam>-contributors.ts` file **directly** — Sunrise's documented path,
no Daybreak-specific indirection. The `leaf-*` delegation is used only by the
bridges listed above (boot, admin-nav, data-export, brand, db-drift, ci) — this
line used to say "only boot and admin-nav", which stopped being true as each
later bridge landed. Both mechanisms feed the same in-memory registry; ordering is safe
because `initFramework()` runs at boot, before any seam's first lazy pull.

Sunrise has no middle-tier concept, so this is **not** a deviation from an
upstream solution — it is how the framework tier fills a gap Sunrise's two-tier
model doesn't address. **Decision (Sunrise v0.7.0 sync): keep push; do not
bridge the four.**

## Version model

Three tiers, three constants. Each is owned by a different party, so **none can
be derived from another** — full contract in [`VERSIONING.md`](./VERSIONING.md).

| Constant                                                      | Means                                                     | Who edits it                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `package.json.version` → `APP_VERSION` (`lib/app-version.ts`) | The **leaf app's** version (in this repo, Daybreak's own) | Whoever owns the repo, on each of their releases                            |
| `DAYBREAK_VERSION` (`lib/daybreak-version.ts`)                | The **Daybreak framework** version                        | Daybreak, on each Daybreak release — leaves merge it through, never edit it |
| `SUNRISE_VERSION` (`lib/sunrise-version.ts`)                  | The **Sunrise platform** version forked from              | Sunrise upstream — merged through, never edited                             |

`version` surfaces on the unauthenticated `/api/health`; the other two on
`GET /api/v1/admin/stats` (`system.daybreakVersion` / `system.sunriseVersion`)
and the `/admin/overview` System Information card, both behind admin auth —
see [`VERSIONING.md`](./VERSIONING.md) for why a platform version is not a
public disclosure.

`APP_VERSION` reads `package.json` — which in a **leaf** names the leaf, not
Daybreak. That is exactly why `DAYBREAK_VERSION` is its own constant rather than
derived: once an app forks Daybreak, `package.json` stops being able to answer
which framework it is running. _(Superseded the earlier note here that a leaf's
third version was "not designed here yet" — it is, as of `f-release` (24).)_

## Tracking changes

`CHANGELOG.md` at the repo root is **Sunrise's** public-surface log — leave it
untouched so upstream edits merge cleanly. Daybreak's own release notes live in a
separate, Daybreak-owned file: **[`CHANGELOG.md`](./CHANGELOG.md) beside this
README**, paired with [`VERSIONING.md`](./VERSIONING.md), which defines what a
Daybreak version commits to and what counts as public surface.

_(This supersedes the earlier suggestion of a root `CHANGELOG.daybreak.md`: keeping
the changelog next to the versioning contract that governs it means a leaf reads one
tree, not two, and the root pair stays unambiguously Sunrise's. Landing in
[`f-release`](./planning/f-release.md) t-2.)_

## Pulling an upstream Sunrise release

```bash
git fetch upstream --tags
git merge vX.Y.Z            # e.g. git merge v0.5.0
# resolve conflicts keeping Daybreak's version, add follow-ups not rewrites
npm run db:migrate:status  # see newly-merged Sunrise migrations
npm run db:migrate:dev      # (dev) apply them  ·  db:migrate:deploy for prod/CI
npm run validate && npm run test
```

The migration directory is the main moving part — Sunrise and Daybreak
migrations share `prisma/migrations/` and interleave by timestamp. Never edit an
applied Sunrise migration; add a follow-up. Full reconciliation recipe:
[`CUSTOMIZATION.md` §9](../../CUSTOMIZATION.md) and
[`.context/database/migrations.md`](../database/migrations.md). A leaf app pulls
**Daybreak** releases the same way (Daybreak becomes its `upstream`).

## Reference

- [`CLAUDE.md`](../../CLAUDE.md) — Daybreak fork banner + Sunrise's platform instructions
- [`CUSTOMIZATION.md`](../../CUSTOMIZATION.md) — the canonical build-on-Sunrise guide
- [`.context/substrate.md`](../substrate.md) — Sunrise's platform documentation entry point
- [`planning/`](./planning/) — the Daybreak build plan (`plan.md`), spec
  (`framework-architecture.md`), and per-feature plans
- [`planning/building-a-feature.md`](./planning/building-a-feature.md) — **start here to build or pick
  up a feature**: the operational flow (plan-first → per-task gate loop → close-out)

## Daybreak feature docs

_None yet — add `.context/framework/<feature>.md` files here as Daybreak grows and link them:_

<!-- - [Feature X](./feature-x.md) — one-line description -->
