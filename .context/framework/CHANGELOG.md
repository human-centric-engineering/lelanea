# Daybreak changelog

All notable changes to the **Daybreak framework** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) — see
[`VERSIONING.md`](./VERSIONING.md) for the public-surface contract and the release
process.

> **This is Daybreak's changelog, not Sunrise's.**
> [`../../CHANGELOG.md`](../../CHANGELOG.md) at the repo root is **Sunrise's** and
> describes the platform. A leaf reads **both**: this file for framework changes,
> that one for platform changes Daybreak carries through.
>
> Changes Daybreak merely inherits unchanged from a Sunrise sync do **not** get an
> entry here — they are already in Sunrise's changelog, and duplicating them would
> dilute the signal. What _does_ get an entry is anything the sync changed about
> **the leaf's contract with Daybreak** (see `0.1.0` below for exactly that case).

> **Status: `0.x` alpha.** The strict SemVer contract activates at `1.0.0`. During
> `0.x`, leaf forks should expect real merge work between any two releases. See
> [`VERSIONING.md`](./VERSIONING.md#0x-semantics--loose-by-design).

---

## [Unreleased]

### Added

- **`lib/app/leaf-ci.ts` — a leaf declares its own coverage exclusions and
  always-run tests.** Adopted from Sunrise #762 (`lib/app/ci.ts`), which Daybreak
  asked for as #759 and which is on `upstream/main` ahead of a Sunrise release.
  Two lists, both shipped empty for you:

  ```ts
  // lib/app/leaf-ci.ts
  export const leafCoverageExclusions: AppCoverageExclusion[] = [
    { pattern: 'scripts/my-cli.ts', reason: 'a tsx entry point nothing imports, so a scoped run forces it in at 0%' },
  ];
  export const leafAlwaysRunTests: AppAlwaysRunTest[] = [
    { path: 'tests/unit/my-tree-invariant.test.ts', reason: 'globs the repo; no import chain reaches it' },
  ];
  ```

  The cases these exist for: a **`tsx` CLI script of your own** is structurally 0%
  and fails the per-file 80% floor the first time anyone edits it, and a **test whose
  subject is the repository** is reached by no import chain, so `--changed` never
  selects it. Before the seam, declaring either meant editing a platform file.

  - **`lib/app/ci.ts` is one of Daybreak's bridges — do not fill it.** Sunrise's seam
    is built for two tiers and hands "the fork" one file; Daybreak is the middle of
    three, so it declares the framework tier's entries there and spreads your lists
    after them. Filling the bridge directly re-creates, one tier down, exactly the
    conflict #759 removed one tier up.
  - **Both lists append**, so the tiers compose — unlike `leaf-brand.ts`, which
    overrides.
  - **Your entries are guarded, not merely typed.** Every check Sunrise wrote over
    the core lists judges yours in your checkout: a `reason` under 20 characters or
    a duplicate fails either list; an always-run path must additionally exist, be
    passable to `vitest` as an argument, and sit in a directory `vitest.config.ts`
    collects — `tests/e2e/**` is excluded there, so a spec declared inside it would
    pass every other check and then silently never run.
  - **Mind the extglob.** `scripts/x/!(*-assertions).ts` spares a sibling only when
    the extracted half is *named* `*-assertions.ts`. Daybreak's own split is
    `check.ts`/`lib.ts`, so it names the wrapper directly — the pattern would have
    taken the tested half with it. Prefer naming the file unless you follow the
    convention.
  - **Filling `leaf-ci.ts` will break two `defaults.test.ts` rows**, its own and the
    bridge's. Pin both; don't delete either (#234).

  Daybreak's own three keep-mine edits — `vitest.config.ts`,
  `scripts/ci/missing-tests.ts` and `scripts/ci/scoped-tests.ts` — are **deleted**,
  so those files now carry no Daybreak content and merge clean on the next sync.

- **`recordNodeProgress(viewer, key, nodeKey, patch, scope?)`** — the writer for
  `UserNodeState.progress` (`lib/framework/facilitation/journey/progress.ts`,
  barrel-exported) (#168). The column is declared module-owned and opaque to the
  engine, and until now no module could reach it: `applyEvent` writes only the
  lifecycle projection, `TransitionRequest` carries no payload, and `JourneyEvent`
  is written inside the engine's own transaction. The one field the framework set
  aside *for* a module was the one field a module could not write.

  Use it for a beat that must happen **exactly once per node** — showing someone a
  chart of their own week for the first time, presenting a gap analysis — where
  re-firing replays a moment the person has already had.

  ```ts
  const result = await recordNodeProgress(viewer, key, 'week-chart', { chartShown: true });
  if (!result.ok) {
    // 'journey_not_started' — start it first; 'node_not_entered' — enter the node first.
  }
  ```

  - **It merges, and the database does the merging.** Postgres `jsonb ||` in a
    single statement, so two beats landing together cannot lose each other's keys —
    the read-modify-write a leaf would otherwise write itself has exactly that bug,
    in the one field whose job is "this must not happen twice". Merging the same
    patch twice is a no-op, so a failed call is safe to retry.
  - **The merge is shallow.** A nested object in `patch` replaces the one it lands
    on rather than merging into it. Keep ledger keys flat. A key set to `null` is
    stored as JSON `null`, not removed — `||` cannot delete.
  - **It will not create a `UserNodeState`.** A node that was never entered is
    refused (`node_not_entered`), because creating the row would mean inventing a
    `status` — the field `applyEvent` is the sole writer of. Enter the node, then
    record against it.
  - **Structured refusals, not `null`.** The rest of the journey family returns
    `null` for "nothing to do"; this one does not, because a write that silently did
    not happen leaves the beat firing forever, and the two reasons want different
    fixes. It mirrors `applyEvent`'s `ok`-discriminated result.
  - **Guarded by `canWrite`**, the pinned self-or-admin-support grant — not the
    `canRead` that Sunrise #367 will widen to cohorts. Same reasoning as
    `createJourney`.

  **`TransitionRequest` deliberately did *not* gain a `progress` field**, the
  alternative the issue offered for "the beat coincides with a transition". It would
  give the framework two ways to write one field and put module-owned data inside the
  pure engine, to buy an atomicity that idempotence already covers. Additive if a
  real case needs it.

  **If you added a bespoke column for this** — as Daybreak's first leaf did — you can
  now move that ledger onto `UserNodeState.progress` and drop the column and its
  migration.

- **Seeds can materialise framework rows without booting the app** (#158). A
  standalone `db:seed` — what `db:reset` and CI run — never runs
  `initFramework() → initLeafApp() → syncFramework()`, so the `Module` rows, their
  slot definitions and the framework capability rows did not exist and a leaf
  seeding framework *configuration* had nothing to operate on.
  - **`prisma/seeds/_framework/000-framework-boot.ts`** now runs that sequence.
    It sorts after every core seed and before any `app-…` directory, so a leaf's
    own seeds find the rows already in place. **No leaf action needed** for
    `db:reset` or CI.
  - **`syncFrameworkForSeed(options?)`** in `lib/framework/seed.ts` is the same
    sequence as a callable seam, for smoke scripts and for the case the boot seed
    cannot cover. Pass `registerLeaf: initLeafApp` — it runs *between* framework
    registration and the database reconcile, the only correct position, because
    the reconcile treats modules missing from the registry as removed. It
    **throws** where `initApp()` logs and continues: a seed that silently failed
    to establish the framework would be recorded as applied.

  **The case you must handle:** the runner skips a unit whose source hash is
  unchanged, so the boot seed runs once and then not again. Add a module and a
  seed for it, run `db:seed` on an existing database, and the boot seed is skipped
  — your new module never gets its row. Call `syncFrameworkForSeed()` at the top of
  your own seed's `run()`; that unit's hash changes when you edit it. See
  [`building-on-daybreak.md`](./building-on-daybreak.md).

- **A leaf can now import `@/lib/framework` from the reserved namespaces and from
  its own seeds, with no configuration.** The core → framework import ban exempts
  three more groups (#157):
  - **Reserved leaf surfaces** — `app/api/v1/app/**`, `app/(protected)/app/**`,
    `app/(public)/app/**`, `app/(auth)/app/**`, `app/admin/app/**`, and
    `components/app/**`. These *do* ship in a build, but the ban's build-time
    rationale is about a fork with **no** `lib/framework/` folder, and these paths
    exist only in a leaf — which always has a framework tier beneath it. Same
    reasoning that already exempts `lib/app/**`.
  - **Framework- and leaf-tier seeds** — `prisma/seeds/app-*/**`,
    `prisma/seeds/framework/**`, `prisma/seeds/_framework/**`. Seeds run via `tsx`
    and are never part of `next build`, the same profile as the already-exempt
    `scripts/smoke/**`.

  **The numbered core seeds at `prisma/seeds/NNN-*.ts` are deliberately still
  banned.** "Ships in no build" is not on its own a licence to cross tiers: those
  files exist in upstream Sunrise and in sibling forks with no framework tier.

  **If you use your own route vocabulary** (`programme/**`, `journal/**`, …) rather
  than the reserved namespaces, re-permit it in your own
  `lib/app/eslint.config.mjs`, which is spread last and wins for your files. That is
  the supported mechanism — Daybreak cannot take one leaf's vocabulary into a
  framework-owned config. Mind the flat-config footgun: `no-restricted-imports`
  replaces rather than merges, so restate the `@/`-alias ban in your block.
  See [`building-on-daybreak.md`](./building-on-daybreak.md).


- **`createJourney(viewer, key, scope?)`** — the seam that starts a journey
  (`lib/framework/facilitation/journey/create.ts`, barrel-exported). Until now
  nothing in the framework created a `UserJourney`: `applyEvent` is the sole writer
  of journey *state* and requires an existing `journeyId`, and `getJourney` returned
  `null` for a journey nobody could start — so a leaf beginning a run had to write
  the `framework_user_journey` row itself. It is the counterpart to
  `applyJourneyTransition`: **create the journey, then transition it.**
  - **Idempotent** on the natural key `(userId, graphSlug, contextKey)` — a second
    start returns the existing row with its original `startedAt`, including under a
    concurrent race.
  - **`canWrite`-guarded** against the journey's owner before any write (see the
    new export below) — deliberately narrower than the `canRead` guarding the
    journey reads.
  - The **caller supplies `contextKey`** (`''` is the default, context-free
    journey); the framework never mints one. This is also the `contextKey` ↔ run
    identity that per-run slot provenance will resolve against.
  - It deliberately does **not** validate `graphSlug` against a published map —
    `graphSlug` is a plain label by design, and the engine takes its graph as an
    input. A journey started against an unpublished slug is inert rather than
    rejected, so publish the map first.

- **`canWrite(viewer, subject, scope?)`** in `lib/framework/shared/access.ts` — the
  write face of the journey access seam. Today it is value-identical to `canRead`
  (self, or the explicit admin-support override), and it exists so it stays that
  way: `canRead` is documented as widening `own → team → all` when Sunrise #367's
  ownership resolver lands, and that widening is about *reading* a cohort. Without
  a separate predicate, every future cohort-reader would silently gain the right to
  create journeys for those subjects. It composes with `canRead` rather than
  replacing it, so a future *narrowing* of reads also refuses the write.

  **A leaf writing its own framework-tier writes should guard on this, not
  `canRead`.** Note `applyJourneyTransition` still authorizes through `canRead`
  (#242) — that path is unchanged by this release.

## [0.2.0] — 2026-09-07

> **Second tagged Daybreak release, and the first a leaf actually merges** — 0.1.0
> was the baseline forks were cut from. **MINOR bump carrying two breaking changes**,
> which `0.x` permits: see [`VERSIONING.md`](./VERSIONING.md#0x-semantics--loose-by-design).
>
> **Read Changed and Removed before merging.** A subject-access export bundle
> changes shape, `GET /api/health` loses two fields, and `lib/app/leaf-data-export.ts`
> gains a second export that is **not optional** — the platform now holds a fork
> tier's schema to full accounting, so a leaf owes a declaration on every model in
> `prisma/schema/app.prisma`. Three seams are new or moved for leaves in total:
> `leaf-brand.ts`, `initLeafSubjectSources()`, and the ancestry guard that became a
> workflow.
>
> Platform range: **Sunrise v0.8.0 → v0.11.2** (see [Platform](#platform) below).

### Added

- **`lib/app/leaf-brand.ts` — a leaf declares its own brand identity here.**
  Sunrise 0.11.0 removed `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_LEGAL_NAME` and
  `NEXT_PUBLIC_APP_DESCRIPTION` and moved brand identity into committed code at
  `lib/app/brand.ts` (Sunrise #661) — a leaf-reserved scaffold. Daybreak has to
  set its own name there, so it fills that file as its **fourth** bridge and
  reads a reserved-empty `lib/app/leaf-brand.ts` in front of its own values.

  Brand is the one seam where a leaf **overrides** rather than appends: a leaf
  does not compose with the framework's name, it replaces it. So a non-`null`
  value in `leaf-brand.ts` wins; `null` falls through to Daybreak's, and
  `lib/brand.ts` falls through again to Sunrise's. `??`, not `||`, so a leaf can
  deliberately set an empty string.

  **What a leaf must do.** Move your three values out of `.env` — they do
  nothing there now, and a boot warning names each one still set — into
  `lib/app/leaf-brand.ts`, then pin them in the `lib/app/leaf-brand.ts` row of
  `tests/unit/lib/app/defaults.test.ts`. Change the row rather than deleting it:
  pinning keeps the protection for the seams you have not filled.

  Note this defect was live in Daybreak until now. `NEXT_PUBLIC_*` is inlined at
  build time and `.dockerignore` excludes `.env*`, so a container build shipped
  `© <year> Sunrise` in both footers regardless of what was configured.


- **`npm run framework:sync-ancestry`, wired into the fork-owned `app:ci-checks`
  seam** — fails the build when `lib/sunrise-version.ts` claims a Sunrise release
  that is not in the tree's git history, the signature of a squash-merged sync PR
  that silently resets the fork's merge base.

  **Leaves inherit this check.** It compares the *claimed* version against history
  — never against the newest upstream release — so being deliberately behind
  upstream stays silent.

  The check **bootstraps its own refs**: a CI runner (or a leaf clone) has none of
  Sunrise's `vX.Y.Z` tags and checks out at depth 1, so it adds the `upstream`
  remote, fetches the tags, and deepens a shallow clone before answering.
  Deepening matters most — on a depth-1 clone `HEAD` has no parents, so an
  un-deepened check would call *every* release a violation. If those refs cannot be
  fetched (offline runner, blocked egress) it skips loudly rather than accusing the
  tree of a violation it could not observe. On a machine that already has the tags
  and full history it is a no-op and touches no git config. (Sunrise #539.)

### Changed

- **BREAKING: the framework tier's subject-access sections moved out of
  `app.framework` and sit flat under `app`.** The Sunrise v0.11.1 sync delegates
  Daybreak's Art. 15 manifest to the registry Sunrise 0.10.0 landed
  (`registerAppSubjectSources({ tier: 'framework' })`, Sunrise #533) — the ask
  Daybreak filed and had been carrying a fork-first shim for.

  A subject export used to carry one nested key,
  `app.framework = { meta, personalData, attributions }`. It now carries one key
  per source directly under `app` — `app.journeys`, `app.slotValues`,
  `app.facilitationMaps`, and so on — and the hand-rolled `meta` block is gone,
  because core emits `meta.app` (every declared source with its row count and
  disposition) and folds the framework tier's exclusions into `meta.excluded`
  beside its own. The `export` / `attribution` distinction survives: it moved
  from which sibling object a section sat in onto `meta.app[].disposition`.

  **Anything parsing a Daybreak export bundle breaks** — a leaf's own tooling, a
  DPO's script, a stored fixture. The subject receives strictly more than before:
  one manifest describing every tier on the same terms, rather than core's
  manifest plus a second one describing only ours.

  **What a leaf must do.** `lib/app/leaf-data-export.ts` gains
  `initLeafSubjectSources()` beside its collector — declare your `app_*` models
  there, each as a source or an exclusion with a reason. This is no longer
  optional: Sunrise 0.10.0 holds every fork-tier schema file to **full
  accounting**, so `tests/unit/lib/privacy/export-sources.test.ts` fails naming
  any model in `prisma/schema/app.prisma` that is neither. Your section names
  must not collide with the framework tier's — the registry refuses a section
  another tier claimed, and a refused declaration then fails that guard.


- **The slot capabilities read their per-agent exposure allowlist from the execution
  context instead of re-querying the grant** — `loadExposureConfig(agentId, slug)` in
  `lib/framework/data-slots/capabilities/exposure.ts` is replaced by the pure
  `resolveExposureConfig(context, slug)`. `get_state` and `fill_slot` behave the same
  for every existing grant; one indexed `AiAgentCapability` lookup disappears from every
  slot capture and every state read.

  Sunrise 0.7.0 surfaced the resolved binding's `customConfig` onto `CapabilityContext`
  (#411), which is the value this shim was fetching for itself a few milliseconds after
  the dispatcher had already fetched it.

  **Two consequences worth knowing if you edit allowlists at runtime.** The config now
  shares the dispatcher's per-agent binding cache (5-minute TTL). The admin binding routes
  call `capabilityDispatcher.clearCache()` on every write, so a **single-instance**
  deployment applies an allowlist edit immediately. On a **multi-instance** deployment,
  `clearCache()` only clears the process that served the request — instances that did not
  serve it keep the previous allowlist for up to 5 minutes. The per-execute database read
  this replaces had no such window, so if you narrow an allowlist to cut off access, budget
  for that delay (or disable the binding, which has the same window, or restart the
  instances). This is the window `isEnabled` and `customRateLimit` already had; the
  fine-grained allowlist now shares it. Cross-instance invalidation is core-owned and filed
  in [`upstream-asks.md`](./upstream-asks.md).

  And a capability executed **outside** the dispatcher
  (no resolved binding on the context) now fails closed with `invalid_exposure` rather
  than treating the missing allowlist as permissive; nothing in Daybreak or Sunrise
  executes a capability that way, but a leaf calling `execute()` directly would see it.

  One narrowing in the other direction: a `customConfig` that is not a JSON **object**
  (an array or a scalar) is collapsed to `null` by the dispatcher before the capability
  sees it, so it now reads as "no allowlist" where the direct column read rejected it.
  The admin binding routes and the config import both validate the field as an object, so
  this only bites a leaf that writes the column by hand — write `{}`, not `[]`.

- **Slot prose→typed extraction is tagged `slot-extraction` in traces**
  (`lib/framework/data-slots/capabilities/extract.ts`) — it inherited the structured
  runner's default `evaluation` phase, so every extraction was filed under evaluation
  work in the OTEL span tree. Sunrise 0.7.0 widened `phase` to an open string (#410).
  Spans only: the runner persists nothing by contract, so this changes no cost record.

- **Module-declared capabilities are registered as themselves, through the core seam,
  instead of being wrapped** — `lib/framework/modules/capabilities/namespace.ts` no longer
  exports `namespaceModuleCapability` (and the `NamespacedModuleCapability` class is gone).
  It exports two pure derivations instead: `moduleCapabilityIdentity(moduleSlug,
  capability)` → `{ slug, functionDefinition }`, and `moduleScopeGuard(moduleSlug)` → a
  `CapabilityGuard`. `register.ts` passes them to
  `capabilityDispatcher.register(capability, { slug, guard })` (Sunrise #398, landed in
  0.7.0); `sync.ts` reuses the identity for the `ai_capability` row, so the handler key and
  the row's slug still come from one derivation.

  **Module authors: one authoring constraint is now stricter.** You still write an ordinary
  `BaseCapability` with a bare snake_case slug, still registered as
  `<module_slug>__<tool_slug>` with a matching `functionDefinition.name`. But if your
  capability sets `processesPii = true`, its `redactProvenance()` must be a **method on that
  class's own prototype**. Core's check is an own-property lookup on the instance's direct
  prototype, where the framework's deleted re-assertion compared by identity against the base
  method and so accepted anything. Two shapes that used to register are now **refused** — the
  boot still succeeds (registration is fail-soft; see the next entry), but the capability is
  absent from every agent's toolset and its `ai_capability` row is deactivated:

  ```ts
  // ❌ inherited from an intermediate base class
  abstract class ModuleToolBase extends BaseCapability {
    override redactProvenance() { … }
  }
  class GrabEmail extends ModuleToolBase { processesPii = true }

  // ❌ class-property arrow — an own *instance* property, not on the prototype
  class GrabEmail extends BaseCapability {
    processesPii = true;
    override redactProvenance = () => ({ … });
  }

  // ✅ a method on the capability's own class
  class GrabEmail extends BaseCapability {
    processesPii = true;
    override redactProvenance() { … }
  }
  ```

  **Check your module capabilities before upgrading.** Nothing crashes: the boot is healthy,
  the app serves traffic, and the only signal is a `logger.error` line reading
  `capability rejected — skipping`. Grep for it after upgrading rather than waiting for
  someone to notice a tool that stopped answering. Both shapes are pinned by
  tests, and core's over-strict check is filed in [`upstream-asks.md`](./upstream-asks.md);
  if Sunrise relaxes it, this constraint relaxes with it.

  **Two visible changes if you assert on refusals.** An out-of-module call is now refused
  by the dispatcher *before* the rate limiter (so it consumes no token) and comes back as
  core's `capability_guard_denied` rather than the framework's `out_of_module_scope`; the
  message names the module the same way. And the framework's own `redactProvenance`
  re-assertion is gone — core's PII guard now inspects your capability's real prototype
  instead of a wrapper that defeated it, so the contract is enforced in one place rather
  than two. A `processesPii` module capability that does not override `redactProvenance()`
  is still refused — it gets no handler, rather than taking the boot down with it.

- **Module slugs are now validated where the namespaced tool name is derived.** A module
  slug must be alphanumeric words joined by **single dashes**; an underscore (`read_ing`),
  a double dash (`read--ing`), or any character outside `[A-Za-z0-9-]` is refused.

  `registerModule()` never validated slugs, so the namespacing rule's "collision-free by
  construction" was a claim about a leaf's discipline rather than a property of the code.
  Modules `read-ing` and `read_ing` both declaring a tool `x` derive the *same*
  `read_ing__x`: the second registration silently replaces the first's handler and one
  module's tool becomes permanently non-dispatchable, with a single `ai_capability` row
  advertising it. A slug with a space or a dot produces a name no provider accepts.

  Uppercase is deliberately still allowed — `Reading__save_worksheet` is a legal tool
  name, so refusing it would break a working leaf for no safety gain. A violating module's
  capabilities are logged and skipped (see the next entry), not fatal.

- **A rejected module capability no longer takes the whole framework down with it.**
  `registerRegisteredModuleCapabilities()` is now fail-soft per capability: one that core
  refuses is logged at `error` and skipped, and its siblings still register.

  Previously the throw escaped into `syncFramework()`, whose caller (`lib/app/bootstrap.ts`)
  catches and logs — so a single bad capability skipped **every later boot step**: framework
  capability handlers never registered, and the module, slot and capability syncs never ran.
  The app served traffic looking healthy with no framework capabilities at all, on the
  strength of one log line. One author's broken tool is not a reason to unregister everyone
  else's.

  `syncRegisteredModuleCapabilities()` follows through: it writes rows only for capabilities
  that actually have a registered handler, so a refused capability's `ai_capability` row is
  deactivated rather than left advertising — and admin-grantable as — a tool that can never
  dispatch. If **no** declared capability has a handler, the sync skips entirely rather than
  mass-deactivating, the same reasoning as the existing zero-modules guard.

  **If you imported `namespaceModuleCapability`** (it was exported from
  `lib/framework/modules/capabilities`), switch to `moduleCapabilityIdentity` +
  `moduleScopeGuard`, or better, let `registerRegisteredModuleCapabilities()` do it.

- **Both framework chat surfaces resume through core's `findResumableConversation`**
  (`lib/framework/guidance/surface.ts`, `lib/framework/facilitation/agents/surface.ts`) —
  each hand-rolled the same `aiConversation.findFirst` on
  `(userId, agentId, contextType, contextId, isActive)`. Same query, same result; the
  `userId` scoping that keeps one user's surface conversation out of another's is now
  derived in one place (Sunrise #416, landed in 0.7.0). No API change — `ModuleSurface` /
  `FacilitationSurface` still declare `conversationId: string | undefined` (a required
  property that may be undefined, not an optional one).

### Removed

- **BREAKING: `daybreak` is gone from the `GET /api/health` response**, along
  with `sunrise` — which Sunrise removed for its own reasons in 0.10.0 (#531).
  Anything reading `body.daybreak` breaks: an uptime monitor asserting on it, a
  deploy-verification script grepping it.

  The reason is the one Sunrise gave, applied one tier up. `/api/health` takes no
  authentication — load balancers and container orchestrators probe it — so the
  field named the exact Daybreak release a deployment runs, and therefore the
  exact set of published Daybreak issues to try against it, to anyone who asked.
  Unlike a leaf's own app version, that answer is useful against **every**
  Daybreak-derived deployment rather than one. `version` is unaffected: it is the
  leaf's own number to disclose, it means nothing outside that leaf, and health
  checks read it.

  **Read it from `GET /api/v1/admin/stats` instead** — `system.daybreakVersion`,
  behind `withAdminAuth`, beside `system.sunriseVersion` — or import
  `DAYBREAK_VERSION` server-side. It is also rendered on `/admin/overview`, where
  the System Information card now shows all three tiers: the leaf's app version,
  the Daybreak framework version, and the Sunrise platform version. That card is
  where an operator can now answer "did that upgrade actually ship?" without a
  terminal.

- **`npm run framework:sync-ancestry`** and its `app:ci-checks` entry, together
  with `scripts/release/sync-ancestry.ts`, `sync-ancestry-check.ts` and their unit
  tests. Sunrise 0.9.0 landed the seam this shim stood in for (Sunrise #539) as the
  [`Fork Sync Integrity`](../../.github/workflows/fork-sync-integrity.yml)
  workflow, so the fork stops carrying its own.

  **Leaf-visible, no action required — but read this if your leaf pinned it.** A
  leaf invoking `framework:sync-ancestry` directly must switch to the workflow,
  which ships in the same merge. The trigger changes: the npm guard ran on every
  CI job, the workflow runs on **push to `main`**. That is the right trigger for a
  leaf as well as for Daybreak — and, unlike the shim, the workflow resolves its
  upstream through `SUNRISE_UPSTREAM_URL` instead of hardcoding Sunrise's clone
  URL, which is what a fork of Daybreak actually needs. **Leave that variable
  unset unless Sunrise's tags are genuinely unreachable** — see
  [`CUSTOMIZATION.md` §9](../../CUSTOMIZATION.md) for the trap it opens.
  > **Net effect depends on how your leaf tracks Daybreak.** The guard was _added_
  > earlier in this same 0.2.0 cycle (see Added above) and never appeared
  > in a tagged Daybreak release, so a leaf that upgrades release-to-release sees
  > no change at all and can ignore both entries. A leaf tracking `main` did pick
  > the script up and needs this one. Both entries are kept deliberately rather
  > than cancelled out, because silently dropping the pair would leave the second
  > kind of leaf with a script that vanished and no note saying why.

  ([`upstream-asks.md`](./upstream-asks.md) — Sunrise #539.)

### Fixed

- **`FrameworkConversationEval` was silently absent from every subject-access
  export.** It holds the automated quality scores and judge reasoning recorded
  against a subject's own conversation turns — assessments *of* what they said —
  and Art. 15 covers those as squarely as it covers the words assessed.

  It was missed because it reaches the subject through `conversationId` with no
  user column, and the coverage guard Daybreak carried scanned for
  `userId` / `createdBy`. A table keyed by a join is invisible to that scan, and
  the tables such a scan cannot see are exactly the ones nobody remembers. It
  surfaced the moment full accounting replaced the heuristic — which is the whole
  argument for full accounting, and the reason a leaf now owes a decision on
  every one of its own tables rather than only the obvious ones.

  **Leaf action: none for this table** — the fix ships in the framework
  collector. But if your leaf has a table reached by a join rather than by a user
  column, it has the same defect today and the new guard will now name it.


- **Module registrations now survive the request realm** — `registerModule()` /
  `getRegisteredModule()` (`lib/framework/modules/registry.ts`) and
  `registerFrameworkCapability()` / `getRegisteredFrameworkCapabilities()`
  (`lib/framework/capabilities/registry.ts`) are backed by `globalThis`.

  **Leaf-visible fix, no action required.** Next 16 + Turbopack loads
  `instrumentation.ts` in a different module graph from route handlers and RSC, so
  a registry populated at boot was empty on every request. A correctly registered,
  active, DB-synced module rendered _"This module's code is no longer registered,
  so its config can't be edited"_ — the whole generic module-config surface was
  dead for any leaf module. If your leaf carries a local `keep-mine` copy of either
  registry to work around this, you can drop it on merging this release.
  (Daybreak #160; same class as Sunrise #462, which swept core's own registries.)

- **Map publish listeners now fire on the request path**
  (`registerMapPublishListener()` / `notifyMapPublished()`,
  `lib/framework/facilitation/map/publish-hooks.ts`) — same `globalThis` fix, same
  root cause. The seam registers at boot but fires from the admin publish/rollback
  routes, so `autoEmbedAfterPublish` never ran after a real publish and overlay
  embeddings went stale with no error and no log.

  > **Scope — this fixes Daybreak's own registries, not the whole class.** Four
  > **Sunrise-owned** registries have the same split and the framework registers
  > into all of them at boot: the workflow `executor-registry`, and the
  > agent-access, guard-floor and guard-event contributors. Until those are backed
  > upstream, framework workflow step types throw _unknown step type_, and module
  > knowledge scope, facilitation guard minimums and escalation silently no-op on
  > the request path. They cannot be fixed from a fork without editing core; each
  > is tracked in
  > [`upstream-asks.md`](./upstream-asks.md) as a Sunrise #462 follow-on.

### Documentation

- **The two framework surface stream routes now say why they exist.** Their headers
  attributed the shadow to "the core consumer route/schema can't carry `scope`" — true when
  written, stale since Sunrise #415 added `scope` to `consumerChatRequestSchema`. The real
  reasons never involved `scope`: the agent is **server-resolved** from the module binding
  or role (and visibility-gated), the conversation is tagged
  `contextType`/`contextId` — which the core consumer route deliberately refuses as an
  admin-only concept, and which resume looks up — and the module route emits
  `module.entered`. **A leaf should not read those routes as scaffolding to delete.** The
  remaining upstream ask is now filed honestly: a consumer entry point that accepts a
  server-resolved context tuple. See [`upstream-asks.md`](./upstream-asks.md).


### Platform

- **Sunrise v0.11.2** is the platform version as of this release, up from v0.8.0 at
  Daybreak 0.1.0 — three sync merges spanning four Sunrise releases:
  [#210](https://github.com/human-centric-engineering/daybreak/pull/210) (v0.9.0),
  [#215](https://github.com/human-centric-engineering/daybreak/pull/215) (v0.10.0 and
  v0.11.0, merged as v0.11.1) and
  [#221](https://github.com/human-centric-engineering/daybreak/pull/221) (v0.11.2).
  Sunrise's own changes are documented in [`../../CHANGELOG.md`](../../CHANGELOG.md);
  only the leaf-contract consequences are repeated above. The three worth knowing
  are the subject-source registry (0.10.0) that the export entries above build on,
  the removal of `NEXT_PUBLIC_APP_NAME` and friends (0.11.0) behind `leaf-brand.ts`,
  and the `Fork Sync Integrity` workflow (0.9.0) that replaced Daybreak's own
  ancestry shim.

## [0.1.0] — 2026-08-05

> **First tagged Daybreak release.** The framework has been in use for some time
> (Framework v1 and v1.1 — 23 features — are shipped); this is the point it becomes
> **versioned and consumable**, so a leaf fork merges a named release rather than
> whatever `main` happens to be.
>
> The entry below describes the leaf-facing surface **as it stands today**. It is
> deliberately not a retroactive log of 23 features — that history lives in
> [`planning/plan.md`](./planning/plan.md)'s Work-completed log.

### ⚠️ Changed — action required for existing leaf forks

- **`lib/app/data-export.ts` is now Daybreak-owned; leaf collectors move to the new
  `lib/app/leaf-data-export.ts`.**

  **If your leaf fills `lib/app/data-export.ts`, move that code before merging** —
  otherwise the merge conflicts, and resolving it the obvious way (keeping yours)
  silently drops the framework's own tables from every subject-access export.

  Why it moved: Sunrise v0.8.0 added a GDPR Art. 15 subject-access export
  (`exportUserData()`) plus a coverage guard that fails until every `User`-linked
  model declares what a data subject receives from it. Sunrise's design assumes
  **two** tiers — core declares its tables, the leaf declares its own via
  `lib/app/data-export.ts` — and Daybreak is a **third** tier in between, with ten
  `framework_*` models of its own to declare. Because the seam is a static function
  rather than a registry, there was no way for the framework tier to contribute
  without occupying it.

  Daybreak therefore fills `data-export.ts` as a **bridge** (its third, after
  `bootstrap.ts` and `admin-nav.ts`) and delegates to a reserved
  **`lib/app/leaf-data-export.ts`** for the leaf — the same pattern as
  `leaf-bootstrap.ts` and `leaf-admin-nav.ts`. Your collector goes there, unchanged
  in shape; only the file name and export name differ
  (`collectLeafSubjectData`).

  Tracked upstream as Sunrise
  [#533](https://github.com/human-centric-engineering/sunrise/issues/533) — if
  Sunrise grows a contributor seam, `data-export.ts` returns to the leaf and this
  reverses. See [`upstream-asks.md`](./upstream-asks.md).

### Added

- **`DAYBREAK_VERSION`** (`lib/daybreak-version.ts`) — the framework version, and
  the middle of three tiers. `APP_VERSION` reads `package.json`, which in a leaf
  names the **leaf**, so it cannot answer which framework the app is running;
  `SUNRISE_VERSION` answers for the platform. Merged through to leaves, **never
  edited by them**.
- **`daybreak` on `GET /api/health`** — so an operator can read all three tiers
  (`version` / `daybreak` / `sunrise`) off a running deployment. Required in the
  response schema, matching `sunrise`.
- **`.context/framework/VERSIONING.md`** — what a Daybreak version commits to, the
  tight definition of the leaf-facing **public surface**, the `daybreak-vX.Y.Z` tag
  convention, and the release checklist.
- **`.context/framework/building-on-daybreak.md`** — the guide for building a leaf
  app on Daybreak: the reserved leaf surface, the sync recipe, and how migrations
  from three tiers interleave.
- **`npm run framework:changelog`** — a CI guard (wired into `app:ci-checks`) that
  fails a PR touching the mechanically-detectable public surface without a
  changelog entry, so this file cannot quietly go stale.

### Platform

- **Sunrise v0.8.0** is the platform version as of this release (synced in
  [#181](https://github.com/human-centric-engineering/daybreak/pull/181)). Its own
  changes — the subject-access export, `SIGNUP_MODE`, the email-change security
  fix, private storage objects, the authenticated-nav and post-auth landing seams —
  are documented in [`../../CHANGELOG.md`](../../CHANGELOG.md). Only the
  leaf-contract consequence is repeated above.

[unreleased]: https://github.com/human-centric-engineering/daybreak/compare/daybreak-v0.2.0...HEAD
[0.2.0]: https://github.com/human-centric-engineering/daybreak/releases/tag/daybreak-v0.2.0
[0.1.0]: https://github.com/human-centric-engineering/daybreak/releases/tag/daybreak-v0.1.0
