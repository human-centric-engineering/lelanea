# Issue backlog — phased plan (2026-08-08, amended 2026-08-14)

The first real leaf (`reclaim-your-week`) has been building on Daybreak since the
Sunrise v0.8.0 sync, and has filed **ten issues** against this repo. In parallel,
the Sunrise upstream tracker holds **33 open issues**, ~16 of them fork-readiness
gaps Daybreak/RYW found — and **six upstream asks Daybreak is still shimming have
already landed upstream**.

This is the phased plan for all three. It is not a board claim: when a phase is
picked up, add its row to [`plan.md`](./plan.md) per
[`building-a-feature.md`](./building-a-feature.md) step 1.

**Proposed epic:** _Framework v1.3 — leaf-consumer hardening_ (v1.2 made Daybreak
distributable; v1.3 makes it usable by the app that took the distribution).

> ### Amended 2026-08-14
>
> Re-checked against the tree and both trackers. **Phases 0–4 stand unchanged** —
> all ten Daybreak issues are still open, nothing is claimed on
> [`plan.md`](./plan.md), and every code claim re-verified (both registries still
> bare `Map`s; all five Phase 1 shims still carried against seams that are all
> present; no `getSlotHistory`, `createJourney`, `recordNodeProgress`, `slots`
> facet or `array` descriptor). Three things moved, all in and around Phase 5:
>
> 1. **Nine upstream issues Phase 5 tracked have closed** — but every fix landed
>    on `upstream/main` _after_ the `v0.8.1` tag, so none are in this tree. The
>    carry-now bucket collapses to one row. Phase 5 is rewritten below.
> 2. **#539's failure mode already happened here.** The v0.8.1 sync (#196) was
>    squash-merged, so Daybreak's merge base with `upstream` is still v0.8.0. New
>    task **t-0.3** repairs it, and it must land _before_ the #539 CI guard.
> 3. **t-0.2's premise is half-obsolete** — the clone now has the `upstream`
>    remote and the Sunrise tags. The ledger reconciliation itself is still
>    entirely needed: all six stale rows still read "filed — awaiting the seam".

---

## The finding that reorders everything

[`upstream-asks.md`](./upstream-asks.md) lists eight open rows as "filed —
awaiting the seam". **Six of those Sunrise issues are closed and their seams are
in this tree already**, merged with the v0.7.0/v0.8.0 syncs:

| Ask                                                           | Upstream state                                                                                 | Seam present in tree                                                                                           | Fork shim still carried                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#398** `register(cap, { slug, guard })`                     | closed 2026-07-06                                                                              | ✅ `dispatcher.ts:133` + `CapabilityRegisterOptions`                                                           | ✅ `lib/framework/modules/capabilities/namespace.ts` (whole wrapper)                                                                                                                                                                                                                                                                                                               |
| **#403** `registerAgentAccessContributor`                     | closed 2026-07-06                                                                              | ✅ `resolveAgentDocumentAccess.ts:75`, core-owned                                                              | ❌ already delegated — **row is just stale**                                                                                                                                                                                                                                                                                                                                       |
| **#410** relocate `runStructuredCompletion` + open `phase`    | closed 2026-07-09                                                                              | ✅ `lib/orchestration/llm/structured-completion.ts`, `phase?: string`                                          | ⚠️ partly delegated — `extract.ts:28` uses the new path but still omits `phase`                                                                                                                                                                                                                                                                                                    |
| **#411** `CapabilityContext.customConfig`                     | closed 2026-07-09                                                                              | ✅ `capabilities/types.ts:65`                                                                                  | ✅ `data-slots/capabilities/exposure.ts:59` still runs its own `aiAgentCapability.findFirst` **per capture**                                                                                                                                                                                                                                                                       |
| **#415** `scope` on `consumerChatRequestSchema`               | closed 2026-07-09                                                                              | ✅ `lib/validations/orchestration.ts:4057`                                                                     | ❌ **not a shim** — see the amended t-1.3 row below. The two framework routes resolve the agent server-side, tag `contextType`/`contextId` (which the core consumer route refuses) and emit `module.entered`; they were never a `scope`-threading shadow. Closed as _landed — no carry_ in [[upstream-asks]] (v1.3 Phase 1 t-1.3), with the real remaining ask filed in its place. |
| **#416** find-or-resume by `(contextType, contextId)`         | closed 2026-07-09                                                                              | ✅ `chat/resume-conversation.ts` → `findResumableConversation`                                                 | ❌ **delegated** — both surfaces call `findResumableConversation` (v1.3 Phase 1 t-1.4); row closed in [[upstream-asks]]                                                                                                                                                                                                                                                            |
| **#366 / #367** tenancy · **#533** subject-access contributor | **#366/#367 closed 2026-09-09** (landed Sunrise 0.12.0, synced 2026-09-16); #533 landed 0.10.0 | ✅ `lib/auth/authorization.ts` — `canRead` / `subjectScope` / `canAdminister`, `lib/app/authorization.ts` seam | **carried — delegation is Phase 6 (t-6.1)**; #533 delegated                                                                                                                                                                                                                                                                                                                        |

Two consequences, both of which drive the phasing:

1. **Daybreak is carrying five shims it is entitled to delete.** Every one is
   merge surface on the next Sunrise pull, and `exposure.ts` is also an indexed
   DB lookup on every slot capture.
2. **Deleting them makes later work cheaper.** #169 (facet enforcement) becomes a
   `guard` passed to the #398 seam rather than a new `BaseModuleCapability`
   class; #411's `context.customConfig` is the value that guard reads. Build #169
   first and you build it twice.

The ledger's own closing note warns about exactly this failure mode ("a row that
claims the fork carries a seam it has already given up") — it was written during
the 0.8.0 reconciliation, which covered #412/#413/#414 and stopped there.

---

## Phase 0 — Stop the bleeding, establish truth — **shipped (#201)**

_Planned as two PRs; shipped as one (#201, three commits) — the three tasks are
independent of each other and none is a PR's worth alone. Merged with a **merge
commit**, not a squash, to preserve the `-s ours` ancestry commit t-0.3 exists to
restore._

### t-0.1 · Module registry survives the request realm (#160) — **leaf-blocking**

`lib/framework/modules/registry.ts:24` is a bare module-scoped `Map`.
`registerModule()` runs only from `initLeafApp()` inside `instrumentation.ts`;
under Next 16 + Turbopack the instrumentation graph is a different realm from the
route/RSC graph, so every request-time `getRegisteredModule()` sees an empty map.
A correctly-registered, active, DB-synced module renders _"This module's code is
no longer registered, so its config can't be edited"_ — the whole A4 config
surface is dead for any leaf module.

Sunrise fixed the same split for its own registries in **#462** (closed
2026-07-30, in this tree: `context-builder.ts:88`, `dispatcher.ts:752` are both
`globalThis`-backed). The framework registry was never in that sweep.

- Back the `Map` with `globalThis`, mirroring `globalForPrisma` / `globalForDispatcher`.
- **Audit the rest** (the issue's "broader concern"). Done here, so the task
  is bounded:
  - `lib/framework/capabilities/registry.ts:23` — same shape. Lower blast radius,
    because `registerFrameworkCapabilityHandlers()` flushes the handlers into the
    (globalThis-backed) dispatcher at boot, so runtime dispatch survives; only
    `getRegisteredFrameworkCapabilities()` is empty at request time. Back it
    anyway — it is one line and the asymmetry is a trap.
  - `facilitation/engine/graph-store.ts` — a per-call factory, not a registry. No change.
  - The remaining `new Map<` hits under `lib/framework/` are all local
    aggregation maps inside a single function. No change.
- Test: a unit test that populates the map, clears the module-local binding, and
  proves a fresh import still sees the registration.

**Done when:** the admin module Config tab renders fields for a leaf module on a
cold server; RYW can delete its local `keep-mine` copy of this file.

### t-0.2 · Reconcile `upstream-asks.md` (docs PR)

Rewrite the six stale rows against the table above: #403 → **Landed** section;
#398/#410/#411/#415/#416 → status `landed — shim still carried, delegate in
Phase 1`, each row naming its Phase 1 task. Keep #366/#367/#533 open.

Also close the loop the ledger cannot currently check. **Amended:** the clone now
_has_ the `upstream` remote and the Sunrise tags (`v0.0.1`…`v0.8.1`) — that half
resolved itself between filing and amendment. What did **not** change is that
neither [`CUSTOMIZATION.md` §9](../../CUSTOMIZATION.md) nor
[`building-on-daybreak.md`](../building-on-daybreak.md) tells anyone to set them
up, so the next clone starts blind again. Add
`git remote add upstream …` + `git fetch upstream --tags` to both as a
prerequisite step, and make the check concrete: for each open row,
`gh issue view <n> -R human-centric-engineering/sunrise --json state`.

**Done when:** every row's status matches upstream reality, and the sync guide
tells the next person how to keep it that way.

### t-0.3 · Repair the merge base the v0.8.1 sync broke (#539) — **before the guard**

_Added 2026-08-14. Phase 5 filed #539 as insurance against a failure that had not
happened yet. It happened six days later._

PR **#196** ("chore: merge Sunrise v0.8.1 into Daybreak", 2026-08-14) was
**squash-merged**: `66ba4513` has the single parent `3eeaf9ce`, not two. So
`git merge-base HEAD upstream/main` is still **`45e704d9` (Sunrise 0.8.0)**, and
`git merge-base --is-ancestor v0.8.1 HEAD` returns false while
`lib/sunrise-version.ts` says `0.8.1`. The next sync will therefore replay the
whole `v0.8.0..` range — conflicting on files that already carry the change.

**Only ancestry broke; the content is all here.** v0.8.1's entire delta is four
files (`CHANGELOG.md`, `lib/sunrise-version.ts`, `package.json`,
`package-lock.json`). `CHANGELOG.md` and `lib/sunrise-version.ts` are
byte-identical to the tag, both the `[0.8.1]` and `[0.8.0]` headings are present,
and `ws` is at `8.21.3` — ahead of the tag's `8.21.2`, via dependabot #197. That
is what makes the repair safe and cheap **now**, and it only gets dearer.

- Record the ancestry without touching the tree: `git merge -s ours v0.8.1` on a
  branch — a two-parent commit whose tree is HEAD's, asserting "v0.8.1 is
  accounted for". **Re-verify that four-file delta first**; `-s ours` would
  silently swallow anything genuinely missing.
- **Then** add the #539 guard — an `--is-ancestor` check of the latest Sunrise tag
  against `HEAD` — on the fork-owned `app:ci-checks` seam (already
  `framework:boundary && framework:changelog`, so no core edit). Mind the
  ordering: added today it goes **red on `main`**, because the condition it
  asserts is currently false.
- Add one line to [`CUSTOMIZATION.md` §9](../../CUSTOMIZATION.md) and the sync
  guide: **a sync PR is merged with a merge commit, never squashed.** The guard
  catches the mistake; the doc prevents it. Pairs with t-0.2's remote setup —
  the guard needs the tags to compare against.

**Done when:** `git merge-base --is-ancestor v0.8.1 HEAD` succeeds, CI fails a
squashed sync, and the next `git merge vX.Y.Z` replays only genuinely new commits.

---

## Phase 1 — Delegate the landed seams — **in flight (John)**

_Planned as five small PRs, each a deletion. Taken as **three**, grouped by the
surface each touches: **A** = t-1.1 + t-1.5 (the slot capabilities), **B** = t-1.2
(module capability namespacing), **C** = t-1.4 + t-1.3 (the two surface layers).
t-1.5 is a single argument and t-1.4 two call sites; neither is a PR alone. No new
behaviour, no migration; `t-1.1` is the one with a runtime win._

> ### Reconciled against the tree, 2026-08-14 (before building)
>
> Three rows survived verification unchanged (**t-1.1**, **t-1.4**, **t-1.5**: the
> seam exists, the shim is still carried, the swap is exactly as described). Two moved.
>
> **t-1.2 is wider than the row says.** It names `register.ts` as the only consumer,
> but `sync.ts` calls `namespaceModuleCapability` too — for the `ai_capability` row's
> slug, `name`, and rewritten `functionDefinition.name`. The wrapper can only be
> deleted if those derivations survive as pure functions (`moduleCapabilitySlug` is
> already exported; the tool-slug validation and the `functionDefinition` rewrite are
> not). Record one deliberate behaviour change: an out-of-scope call returns the core's
> `capability_guard_denied` instead of the fork's `out_of_module_scope`, and is refused
> **before** the rate limiter rather than inside `execute()`.
>
> **t-1.3's premise does not survive contact with the routes.** See the amended row
> below — the two framework stream routes are not shims, are not being collapsed, and
> #415 closes as _landed — no carry_.

| Task      | Delete                                                                                                         | Replace with                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **t-1.1** | `loadExposureConfig`'s `prisma.aiAgentCapability.findFirst` (`data-slots/capabilities/exposure.ts:59`)         | `context.customConfig`                                                                                                                                    | Keep the Zod parse + fail-closed + `facetAllows`. **Fix the header comment** — it still asserts "`CapabilityContext` carries no `customConfig`", now false. Removes one indexed lookup per capture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **t-1.2** | `namespaceModuleCapability` + its dummy `schema` + the `redactProvenance` re-assertion (`namespace.ts`)        | `capabilityDispatcher.register(inner, { slug: namespacedSlug, guard: scopeGuard })` in `capabilities/register.ts`; `isInModuleScope` moves into the guard | The dispatcher's own comment now says this seam "is exactly what lets a fork avoid wrapping a capability". **Keep** the `slug === functionDefinition.name` invariant test. Sets up t-4.1. **Also `sync.ts`** — it consumes the wrapper for the row's slug/`name`/`functionDefinition`, so the wrapper's derivations must survive as pure functions. Error code changes to core's `capability_guard_denied`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **t-1.3** | ~~the two shadow stream routes' reimplementation~~ — **nothing; the routes stay**                              | the now-false decision-6 rationale in both route headers + `guidance/surface.ts`, and the #415 ledger row                                                 | **Amended.** #415 landed and the _stated_ reason for the shadow ("the core consumer route/schema can't carry `scope`") is genuinely stale — but the routes never only threaded scope. They resolve the agent **server-side** from the module/role, tag `contextType`/`contextId` (which the core consumer route deliberately refuses — "admin-only concepts"), and the module route emits `module.entered`. A thin wrapper drops the context tuple, so new surface conversations go untagged and **resume breaks**. The facilitation route threads no `scope` at all, so it was never a #415 shim. The SECURITY note argues the same way round: `scope` here is **server-derived** (`encodeScope({ moduleSlug })`), and delegating would move it onto an untrusted client field. Close #415 as **landed — no carry**; file the real remaining gap (a consumer entry point accepting a _server-resolved_ context tuple). |
| **t-1.4** | the hand-rolled `aiConversation.findFirst` in `guidance/surface.ts:69` and `facilitation/agents/surface.ts:83` | `findResumableConversation`                                                                                                                               | Two call sites, identical shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **t-1.5** | nothing                                                                                                        | pass `phase: 'slot-extraction'` to `runStructuredCompletion` in `data-slots/capabilities/extract.ts`                                                      | Completes #410. `tryParseJson` legitimately stays at `evaluations/parse-structured` — that is its upstream home.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

> **Status (the table above is the _plan_; this is the _state_).** The `Delete` column
> names shims by the line they sat on when the phase was planned — once a task ships, that
> citation is history, not a location to go looking at. t-1.1 + t-1.5 → **#204**,
> t-1.2 → **#205**, t-1.4 + t-1.3 → **#206**. The authoritative record of what the fork
> still carries is [[upstream-asks]], not this table.

**Done when:** `upstream-asks.md` has five fewer open rows — four closed by
deleting the shim, #415 closed as _landed — no carry_ with the real remaining gap
filed in its place — `framework:boundary` and the full suite are green, and no
framework file re-implements a core seam.

---

## Phase 2 — The run-scoped slot spine (#156 · #162 · #167)

_The correctness phase. #162 describes a live data-loss bug in the leaf: a
completed audit's shared, tokenised public summary silently hollows out when the
user starts a second run. Nothing errors, nothing logs._

### t-2.1 · `runId` provenance + **batched** history read (#156 + #162, one task)

Land these together and **skip the intermediate signature**. #156 proposes
`getSlotHistory(userId, slotSlug)`; #162 — filed a day later, after the bug —
shows why that shape is a trap: it is per-slug, so the only correct reader for a
run is unaffordable, and every caller reaches for
`getSlotHeads({ slotSlugs })` + a `provenance.runId` filter instead. That is
correct only until a user's second run supersedes the first run's heads. **Daybreak
never shipped `getSlotHistory`, so there is no back-compat cost to landing the
batched form directly** — the leaf carries its own copy today.

In `lib/framework/data-slots/values.ts`:

```ts
export interface SlotValueProvenance {
  // …existing fields…
  /** The run this reading belongs to. Stored, never interpreted, by the engine. */
  runId?: string;
}

export interface GetSlotHistoryOptions {
  slotSlugs?: string[]; // omitted → every slug for the user
  runId?: string; // JSON-path filter on provenance.runId
}

/**
 * Every version — head AND superseded — oldest first (`version` ascending).
 * No `supersededAt` filter: the superseded rows are the point.
 */
export async function getSlotHistory(
  userId: string,
  options?: GetSlotHistoryOptions
): Promise<SlotValue[]>;
```

`provenance` is already `Json` → **no migration**. `canRead` wraps this exactly as
it wraps `getSlotHeads`.

Guard the trap the issue identifies rather than only fixing the symptom: a
doc-comment on `getSlotHeads` stating in one line that it is head-only and is
**not** how you read a run, pointing at `getSlotHistory`.

- Tests: superseded rows returned; `runId` filter selects across supersession;
  `slotSlugs` narrowing; ascending-version ordering (last write in a run wins);
  `canRead` parity with `getSlotHeads`.

**Done when:** the leaf deletes `readRunAnswers`' direct `prisma.slotValue` query
— a leaf reaching into a `framework_*` table is what the module exists to prevent.

### t-2.2 · Run context reaches capability writes (#167)

`fill_slot` builds provenance from `conversationId`/`moduleSlug`/`nodeKey` only,
so an agent-captured value structurally belongs to no run — invisible to every
run-scoped read from t-2.1.

**Resolution (the issue offers three; take 2 + a guarded 1, not 3):**

- **Server-resolved, primary:** in `fill-slot.ts`, resolve the conversation's
  active `UserJourney` and stamp its `contextKey` as `runId`. The framework
  already knows the conversation; the journey natural key is
  `@@unique([userId, graphSlug, contextKey])`.
- **Caller-supplied, secondary:** accept `scope.runId` — the opaque `scope` map
  that Phase 1 t-1.3 now threads through the core consumer route — **only when it
  matches an active journey for that user**. It arrives from an untrusted client;
  the schema's own SECURITY note says re-validate before making it load-bearing.
- **No run resolvable → no `runId`**, and say so in the capability's doc comment.
  Option 3 (document the exclusion and stop) is rejected: it makes agent capture
  permanently second-class in exactly the apps `runId` exists for.

**Done when:** a chat correction mid-run lands in that run's picture, and a
capture with no active journey still writes cleanly with no `runId`.

---

## Phase 3 — Journey and seeding seams (#159 · #168 · #158 · #157)

_The "declared but unreachable" phase: three framework concepts a leaf cannot
touch without writing `framework_*` rows itself._

### t-3.1 · `createJourney` (#159)

`applyEvent` is documented as the sole writer of journey state and requires an
existing `journeyId`; `assembleJourneyContext` returns `null` without one; and
**no `userJourney.create` exists anywhere in `lib/`** — only in two smoke scripts.
Add `createJourney(userId, graphSlug, contextKey)` to
`lib/framework/facilitation/journey/` (barrel-exported), idempotent on the natural
key, as the counterpart to `applyJourneyTransition`.

### t-3.2 · `recordNodeProgress` (#168)

`UserNodeState.progress` is `Json?` and documented as "module-defined … opaque to
the engine" — and has no setter. Add
`recordNodeProgress(journeyId, nodeKey, patch)` plus an optional `progress` field
on `TransitionRequest` (`guidance.ts:118`) for the case where the beat coincides
with a transition. The engine does not interpret it; the field is already opaque.

Use case is once-per-node beats ("show this person their week for the first
time") that must survive a reload. The leaf added a bespoke scalar-list column for
a concept the framework already models.

### t-3.3 · ESLint exemption for non-build framework consumers (#157)

The core→framework import ban (`lib/framework/eslint.config.mjs:72-78`) exempts
`lib/framework/**`, `lib/app/**`, `tests/**/lib/framework/**`, `scripts/smoke/**`.
Its stated rationale is build-time resolution — so the exemption should track
"does this ship in `next build`", and seeds do not.

**Resolve the issue's two halves differently:**

- **Seeds — accept as filed.** Add `prisma/seeds/app-*/**` and
  `prisma/seeds/_framework/**` (see t-3.4). Run via `tsx` from `prisma/seed.ts`,
  never in a build — the identical profile to the already-exempt `scripts/smoke/**`.
- **The comment's request for `app/(protected)/programme/**` etc. — decline as
  filed, satisfy generically.** `programme` is leaf vocabulary and must not enter
  a Daybreak-owned config; the next leaf has different words. Two answers instead:
  1. exempt the **reserved leaf route namespaces**, mirroring how `lib/app/**`
     is reserved: `app/api/v1/app/**`, `app/(protected)/app/**`, `app/admin/app/**`;
  2. document in `building-on-daybreak.md` that a leaf using its own vocabulary
     overrides via its own `lib/app/eslint.config.mjs` (spread **last**, so it
     wins) — which is what RYW already does, and is the supported mechanism, not
     a workaround.

  Mind the flat-config footgun the file's own header calls out: every block
  **restates** `aliasBan`, because `no-restricted-imports` replaces rather than
  merges.

### t-3.4 · Framework boot before leaf seeds (#158)

`db:seed` / `db:reset` / CI never boot the app, so `initFramework() →
initLeafApp() → syncFramework()` never runs and the `Module` row, its slot
definitions, and the framework capability rows do not exist. A leaf seeding
framework _configuration_ must call the three boot functions itself.

**Resolution — no core edit, and it exploits the runner's existing ordering.**
`prisma/runner.ts` runs seeds in lexicographic order of path-relative-to-`seeds/`,
and ASCII puts digits `<` `_` `<` letters. So:

- add **`prisma/seeds/_framework/000-framework-boot.ts`**, which calls the boot
  sequence via the Daybreak-owned bridge `initApp()` (`lib/app/bootstrap.ts`).
  It sorts **after** every core `NNN-*.ts` seed (so `001-system-owner`'s service
  account exists) and **before** `app-*/` leaf seeds. `db:reset` and CI just work
  with no leaf action at all.
- also export **`syncFrameworkForSeed()`** from `lib/framework` — the same
  sequence, idempotent, named — for `scripts/smoke/*` and any leaf that wants it
  explicitly.

Note the existing `prisma/seeds/framework/001-framework-rubric-judge.ts` sorts
_after_ `app-*/`; that is fine (it depends on core only), but the new directory
must be `_framework/`, not `framework/`, or the ordering fails silently.

Depends on **t-3.3** (the new seed imports `@/lib/framework`).

---

## Phase 4 — Enforcement and authoring (#169 · #161)

_Both are "the surface promises something it does not deliver". #169 is the more
serious: it is a security-shaped invariant that was never enforced._

### t-4.1 · Facet enforcement + slug-level facets (#169)

**Half 1 — module capabilities inherit nothing.** `facetAllows` is called by the
framework's own `fill_slot` and `get_state` and **by nothing else**;
`BaseCapability` does nothing with `context.customConfig`. A leaf that declares a
capability on its `ModuleDefinition` and grants it an `ExposureConfig` gets a
grant that **silently enforces nothing**, indistinguishable from one that works.
RYW believed for a year that its write allowlist was enforced twice; it was
enforced once, and its guard test asserted against a hand-written **mirror** of
`facetAllows` rather than the function — green while proving nothing.

**This is why Phase 1 t-1.2 comes first.** With the #398 seam, enforcement is a
`guard` on registration, not a new base class:

```ts
capabilityDispatcher.register(inner, {
  slug: namespacedSlug,
  guard: composeGuards(scopeGuard, exposureGuard), // exposureGuard reads context.customConfig (t-1.1)
});
```

Every module capability then inherits enforcement by construction. Also add the
sentence `BaseCapability` is missing: binding config is inert unless something
applies it.

**Half 2 — `facetSchema` cannot express a slug rule.** It is `.strict()` on
`{ groups, scopes }`. A group that mixes machine-computed lanes with user
self-reports cannot state its real permission as data, so the leaf permits the
whole group on the grant and shuts the computed lanes in code — two layers
deliberately non-identical, which reads as a bug. Add `slots?: string[]` and
`denySlots?: string[]` to the facet (deny wins), widen `facetAllows`, and
**replace the leaf's mirror-test pattern** with tests that call the real function.

Tests must include the both-halves case: a grant whose facets deny a slug, on a
module-declared capability, actually refuses.

### t-4.2 · Array-of-objects config descriptors (#161)

`modules/config/schema-descriptors.ts` renders string/number/boolean/enum and
falls back to a raw-JSON textarea for everything else (`:164`). That is sound for
a settings-shaped config and wrong for the common facilitation case, where **the
module's config _is_ its content**: nine authored bucket definitions and the
diagnostic prose under each. The page advertises "edit this module's
configuration without a deploy" and, for that class of module, does not — and one
unbalanced brace loses the lot.

- Add a bounded `type: 'array'` descriptor: an `items` descriptor list describing
  the element shape (flat primitives only) plus an index path
  (`buckets.0.title`) the client renders rows from. Keep the raw-JSON fallback for
  genuinely exotic schemas (nested arrays, unions, arrays of arrays).
- Client: repeatable labelled rows with add/remove/reorder.
- The walker stays **total** — never throws; worst case is still a JSON textarea.
  The server still re-validates against the real Zod schema, so a descriptor
  remains a rendering hint, never a trust boundary.

Note what this does _not_ close: RYW keeps its own form for content-provenance
markers (does each field still match the source document?), which no generic form
can know. That split is the right factoring — the leaf owns the form and `PUT`s to
the framework's own config endpoint, so validation, the `ModuleVersion` snapshot,
the change summary and the audit entry all stay upstream.

---

## Phase 5 — The Sunrise backlog: carry, watch, or document

_Rewritten 2026-08-14. The original triaged 33 open upstream issues into carry /
watch / document. **Nine have since closed**, and the shape of the answer changed
with them._

### The finding that reorders this phase

Every one of those nine fixes landed on `upstream/main` **after the `v0.8.1`
tag**, and Daybreak syncs at tag boundaries. The fixes are real, public, and
**not in this tree** — verified: `Dockerfile:63` still hardcodes
`--max-old-space-size=4096`, and `package.json` still has no `db:format:check`.

| Was                           | Fixed upstream by                                        | Phase 5 said         | Now                                                  |
| ----------------------------- | -------------------------------------------------------- | -------------------- | ---------------------------------------------------- |
| **#537** + **#528**           | #599 register capabilities before a workflow `tool_call` | carry / watch        | drop both — arrives with the next release            |
| **#510** Prisma format check  | #566 make the Prisma format check runnable locally       | carry                | drop — adopt upstream's, not a fork-local script     |
| **#543** `CI_NODE_HEAP_MB`    | #589 forward `CI_NODE_HEAP_MB` into the Docker build     | carry (verify first) | drop — the "don't pre-emptively edit" call was right |
| **#545** capability seeds     | #596 re-apply code-owned fields when re-seeding          | watch                | drop                                                 |
| **#507 / #508 / #509 / #553** | #557 · #558 · #555                                       | wait                 | still wait — now with a landing date                 |

Two of those security fixes (#507/#508 in `88dbb32a`, #553 in `7fda7821`) landed
**hours before this plan was filed** and were nonetheless written up as "wait;
re-check on each sync" — the same staleness failure the plan's own opening
section diagnoses in `upstream-asks.md`. The lesson is t-0.2's: **state-check
every referenced issue at the moment of writing**, then again on each sync.

### Carry now

One row, and it is no longer insurance against a hypothetical.

| Issue    | Why now                                                                                                                             | Daybreak action                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#539** | Still open upstream — and **it already bit this repo**: the v0.8.1 sync was squash-merged, so the merge base is stranded at v0.8.0. | Promoted to **[t-0.3](#t-03--repair-the-merge-base-the-v081-sync-broke-539--before-the-guard)** in Phase 0: repair the ancestry first, _then_ add the guard to `app:ci-checks`. |

### Adopt on the next sync — do not build

Nothing to do but pull. Add each as an `upstream-asks` row with status **landed
upstream, awaiting the next Sunrise release**, so the sync that brings it knows
which local mitigation to drop.

- **#537 / #528** (#599) — the `tool-call.ts` registration gap, plus a workflow
  exemption from strict binding mode. **Note the interaction with t-1.2:** Phase 1
  moves the framework's namespaced capabilities onto the dispatcher's own
  `register(…, { guard })` seam, and #599 changes when registration runs relative
  to a workflow `tool_call`. Land t-1.2 first, then re-test framework module
  capability dispatch on the sync that brings #599.
- **#510** (#566) — a locally-runnable Prisma format check. **Prefer upstream's to
  the original suggestion** of a fork-local `db:format:check` on `app:ci-checks`:
  same outcome, zero fork surface. Daybreak already paid this once (`8edb5797`);
  it is cheap to keep waiting.
- **#543** (#589) — `CI_NODE_HEAP_MB` reaching the Docker build. The original row
  said "verify first, don't pre-emptively edit the Dockerfile". That judgement
  held; the edit is now upstream's.
- **#545** (#596) — capability seed re-sync. Daybreak never had the bug — the
  framework's own `modules/capabilities/sync.ts:125` already diffs
  `functionDefinition` — so this only repairs the core seeds.
- **#507 / #508 / #509 / #553** (#557 · #558 · #555) — core security hardening
  (token domain separation, `deletePrefix` root guard, `name`/`slug` divergence,
  escalation webhook SSRF). None reachable from a Daybreak surface; the original
  "fixed in the wrong tier if fixed here" call was correct.

### Watch — real, but not biting Daybreak yet

All still open upstream (re-checked 2026-08-14). Keep as `upstream-asks` watch
rows with the trigger that would promote them:

- **#541** (grader registry is module-scoped; batch worker is route-realm) — the
  f-governance-plus sweep uses a **seeded agent judge**, not a registered grader,
  so it is unaffected. **Trigger:** the first framework-owned `registerGrader`.
- **#540** (MCP `HANDLERS` map is module-local, not extensible) — Daybreak
  registers no MCP resources. **Trigger:** the first `framework://` resource.
- **#542** (`AiApiKey.scopes` closed enum → least privilege unavailable to forks)
  — **Trigger:** the first framework-owned API surface wanting its own scope.
- **#526** (`ChatInterface` hardcodes the admin stream endpoint) — Daybreak's
  framework chat surfaces are API-only today. **Trigger:** the first framework
  chat page. RYW likely needs this before Daybreak does.
- **#532** (per-user schedules have no owner after #502).
- **#366 / #367 / #533** — already ledgered. Unchanged.

**#528 leaves this bucket.** "Strict mode is currently unusable with workflows"
is fixed upstream, so it now has a landing date rather than an open trigger.

### Document — bites the **leaf**, not Daybreak

Unchanged; #525, #530, #535 and #536 are all still open. These fire when RYW (or
the next leaf) fills a seam the supported way. Daybreak is the tier that should
warn them: add a **"known leaf-sync gotchas"** section to
[`building-on-daybreak.md`](../building-on-daybreak.md).

- **#525** — `registry.test.ts:158` asserts a hardcoded built-in count through
  `lib/app/capabilities.ts`. Daybreak leaves that seam empty (it registers via
  `initFramework()`), so Daybreak is green — **a leaf that fills it goes red**.
- **#530** — three more places hardcode a seam's default (auth-landing route and
  friends). Same shape: filling a seam correctly turns the suite red, and the fix
  is to pin the new value, never to delete the assertion.
- **#535** — `lib/app/env.ts` cannot honour §4's dynamic-import rule (it is read
  during a synchronous module-load parse in `lib/env.ts`). Daybreak's is empty
  today; the framework's only `process.env` read is
  `facilitation/overlays/nudge-channel.ts:36`, which takes env by parameter. Say
  so before someone adds a framework env var.
- **#536** — a scoped `update`'s `P2025` inside `$transaction` rolls back the
  whole batch. Worth a line in the framework's own DB conventions.

---

## Phase 6 — Delegate the authorization seam (#366 / #367 landed)

Opened 2026-09-16 on the Sunrise 0.12.0 sync. The two tenancy asks the ledger
has carried since v1 — **#367** (intra-tenant ownership scope) and **#366**
(org-admin tier axis) — closed on 2026-09-09 and their resolver shipped in
0.12.0 as `lib/auth/authorization.ts`: a policy with three faces
(`canAdminister` / `canRead` / `subjectScope`), the `lib/app/authorization.ts`
seam a fork replaces it through, and `checkAuthorizationParity()`. The fork
still carries its own [`lib/framework/shared/access.ts`](../../lib/framework/shared/access.ts)
(`canRead` / `canWrite` / `subjectScope`), whose header promised to delegate
"when #367's ownership resolver lands upstream". It has.

### t-6.1 · `lib/framework/shared/access.ts` delegates `canRead` / `subjectScope` to core

Delete the self-read + admin-support body of `canRead` and the `where` fragment
`subjectScope` builds, and call core's `canRead(principal, resource, scope)` /
`subjectScope(principal, scope)` instead, passing the framework's `AccessScope`
as the `AuthorizationScope` (`ownership` / `tier` map by name). Keep the
`canRead` ⇔ `subjectScope` parity test — core has its own
(`checkAuthorizationParity`), and the framework's is what proves the two tiers
agree. **Wire `canRead` and `subjectScope` ONLY — leave `canWrite`'s pinned
grant alone** (the ledger row says why: #242/#159 pin every journey write to
self-or-admin-support so a cohort _read_ widening never hands cohort readers the
right to drive transitions; the predicates are value-identical until the
resolver lands, so no test would catch a silent widening).

The one design question, and it is the reason this is a task and not a sync
chore: core's `canRead` takes an **`AuthorizationPrincipal`** — the guard's
principal, with `credential` and `scopes` — and
[`.context/auth/authorization.md`](../../.context/auth/authorization.md)
("The principal comes from the guard — never rebuild it") is explicit that a
handler must not reconstruct one from `session.user`. The framework's
`JourneyViewer` is a framework-local shape built exactly that way. So either the
framework's read seam starts taking `session.principal` (the callers are the
journey/slot readers, all reached from guarded routes and the engine), or it
maps `JourneyViewer` → principal and accepts the widening bug the doc names.
The first is right; size the caller sweep before promoting.

_Done when:_ `access.ts` imports `canRead` / `subjectScope` from
`@/lib/auth/authorization` and has no ownership predicate of its own;
`canWrite` is byte-identical; the parity test passes; the ledger row for
#366/#367 moves to the Landed table.

## Sequencing at a glance

```
Phase 0  ──▶ t-0.1 #160 registry realm      (leaf-blocking; independent)
             t-0.2 ledger reconciliation    (docs; makes Phase 1 obvious)
             t-0.3 #539 merge-base repair   (independent; MUST precede the CI guard)

Phase 1  ──▶ t-1.1 #411 · t-1.2 #398 · t-1.3 #415 · t-1.4 #416 · t-1.5 #410
             (5 deletions, parallelisable — t-1.1 and t-1.2 gate Phase 4)

Phase 2  ──▶ t-2.1 #156+#162  ──▶  t-2.2 #167        (strict chain)

Phase 3  ──▶ t-3.1 #159 · t-3.2 #168 (independent)
             t-3.3 #157  ──▶  t-3.4 #158              (strict chain)

Phase 4  ──▶ t-4.1 #169  (needs t-1.1 + t-1.2)
             t-4.2 #161  (independent)

Phase 5  ──▶ its one carry-now row IS t-0.3; the rest is ledger hygiene —
             adopt-on-next-sync rows + watch rows + the leaf gotchas doc

Phase 6  ──▶ t-6.1 #366/#367 delegate `canRead` / `subjectScope` (independent;
             opened on the Sunrise 0.12.0 sync)
```

**Schema impact:** none. No migration in any phase — `provenance` and `progress`
are existing `Json` columns, and every other change is code, config or docs.

**If only one thing gets done:** t-0.1. It costs ten lines and currently kills the
entire generic config-editing surface for every leaf module.

**If only one _more_ thing gets done:** t-0.3. The merge base is stranded at
v0.8.0 today and the repair is a single `-s ours` commit; every sync that lands
before it makes the replay larger and the repair harder to reason about.

**Issue → task index:** #156 → t-2.1 · #157 → t-3.3 · #158 → t-3.4 · #159 → t-3.1
· #160 → t-0.1 · #161 → t-4.2 · #162 → t-2.1 · #167 → t-2.2 · #168 → t-3.2 ·
#169 → t-4.1. Upstream: Sunrise #539 → t-0.3 · Sunrise #366/#367 → t-6.1.
