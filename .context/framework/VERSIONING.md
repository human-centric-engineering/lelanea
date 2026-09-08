---
name: VERSIONING
description: What a Daybreak version commits to, the leaf-facing public surface, the tag convention, and how a release is cut.
parent: README.md
---

# Daybreak versioning

This is **Daybreak's** versioning contract, for the apps that fork Daybreak. It is
the mirror, one tier up, of Sunrise's own [`VERSIONING.md`](../../VERSIONING.md) —
read that one for the _platform's_ contract with Daybreak.

> **Do not confuse the two.** [`../../VERSIONING.md`](../../VERSIONING.md) and
> [`../../CHANGELOG.md`](../../CHANGELOG.md) at the repo root are **Sunrise-owned**
> and describe the platform. This file and
> [`CHANGELOG.md`](./CHANGELOG.md) beside it are **Daybreak-owned** and describe
> the framework.

> **Two companion docs referenced below land in the next task.**
> `CHANGELOG.md` and `building-on-daybreak.md` (the leaf's sync guide) arrive in
> [`f-release`](./planning/f-release.md) **t-2**; this file ships first because it
> defines the contract they implement. Until then those links are forward
> references, not omissions.

---

## The three versions

A Daybreak-derived app reports three versions, and they answer three different
questions. None can be derived from another, because each is owned by a different
party:

| Constant           | File                      | Owned by         | Answers                         | Surfaced as                           |
| ------------------ | ------------------------- | ---------------- | ------------------------------- | ------------------------------------- |
| `APP_VERSION`      | `lib/app-version.ts`      | the **leaf app** | which build of _this app_?      | `/api/health` `version` · admin stats |
| `DAYBREAK_VERSION` | `lib/daybreak-version.ts` | **Daybreak**     | which framework is it built on? | admin stats `system.daybreakVersion`  |
| `SUNRISE_VERSION`  | `lib/sunrise-version.ts`  | **Sunrise**      | which platform is underneath?   | admin stats `system.sunriseVersion`   |

**Only `version` is on the unauthenticated `/api/health`.** The other two moved
to `GET /api/v1/admin/stats` (behind `withAdminAuth`) and the `/admin/overview`
System Information card in the Sunrise v0.11.1 sync — `sunrise` because Sunrise
removed it there (#531), `daybreak` for the same reason one tier up. A platform
release number names the exact set of published issues to try against it, and
that answer is useful against **every** deployment derived from that platform
rather than one. A leaf's own app version is the leaf's to disclose: it means
nothing outside that leaf, and container health checks read it.

`APP_VERSION` reads `package.json`, which in a leaf says the _leaf's_ name and
version — so Daybreak's version cannot be recovered from it downstream. That is
the whole reason `DAYBREAK_VERSION` is a separate constant rather than derived.

**A leaf fork never edits `lib/daybreak-version.ts`.** It merges through with the
rest of Daybreak. Editing it makes the app claim a framework version it is not
running, which is worse than no answer.

---

## `0.x` semantics — loose by design

Daybreak is in `0.x`. The strict SemVer promise activates at `1.0.0`.

During `0.x`, **a leaf should expect real merge work between any two releases.**
That is not an apology; it is the same posture Sunrise takes at `0.x`, and it is
what lets the framework keep changing shape while leaves are few. What `0.x` still
commits to:

- Every change to the **public surface** below appears in
  [`CHANGELOG.md`](./CHANGELOG.md), so a leaf can read what will hit it before merging.
- A change that **moves work onto the leaf** — a seam becoming Daybreak-owned, a new
  reserved file a leaf must not fill — is called out explicitly, not left to be
  inferred from a diff.
- **MINOR** for additive surface, **PATCH** for fixes with no surface change. A
  breaking surface change bumps MINOR during `0.x` (there is no MAJOR to spend), and
  says so loudly in the changelog.

`1.0.0` is reserved for the point Daybreak is willing to promise a stable contract.

---

## The public surface (tight definition)

This is what a version commits to and what the changelog tracks. A leaf may depend
on:

- **The `lib/app/*` bridges Daybreak fills** — `bootstrap.ts`, `admin-nav.ts`,
  `data-export.ts` — **and the reserved `leaf-*` seams they delegate to**
  (`leaf-bootstrap.ts`, `leaf-admin-nav.ts`, `leaf-db-drift.ts`,
  `leaf-data-export.ts`). Which files are Daybreak's and which are the leaf's **is
  itself public surface**: a file changing hands is a breaking change for any leaf
  that filled it.
- **`registerModule()`** and the framework registration seams driven by
  `initFramework()`.
- **`framework_*` Prisma models** and their published shapes.
- **Framework admin routes** — `/admin/framework/**` and `/api/v1/**/framework/**`.
- **Exported values from `lib/framework/**`** that a leaf is documented to call.
- **`DAYBREAK_VERSION`** and `system.daybreakVersion` on `GET /api/v1/admin/stats`.

**Deliberately NOT public surface** — changing these needs no changelog entry:
internals of `lib/framework/**` no leaf is documented to call, test-only changes,
`.context/` docs, and anything Daybreak merely inherits unchanged from Sunrise
(that belongs in Sunrise's changelog, and a leaf reads it there).

> Adding noise dilutes the signal a leaf relies on. The rule is the same one
> Sunrise applies to itself: if it does not change what a leaf can depend on, it
> does not belong in the changelog.

---

## Tags — always prefixed `daybreak-v`

**Daybreak tags are `daybreak-vX.Y.Z`. Never bare `vX.Y.Z`.**

This is not cosmetic. A Daybreak clone has Sunrise as its `upstream` remote, and
`git fetch upstream --tags` brings **Sunrise's** `vX.Y.Z` tags into the same
namespace — `v0.8.0` in a Daybreak clone is _Sunrise 0.8.0_. An unprefixed Daybreak
tag would be ambiguous in any clone holding both remotes, and would collide outright
the day Sunrise cuts the same number.

> ### ⚠️ Never `git push --tags`
>
> A dev clone holds Sunrise's tags. `git push --tags` would publish them onto
> Daybreak's remote, where they would look like Daybreak releases forever. A release
> pushes **one explicit ref**:
>
> ```bash
> git push origin daybreak-v0.2.0    # ✅ one tag, named
> git push --tags                    # ❌ never
> ```

---

## Cutting a release

Releases are cut by hand against this checklist. There is deliberately no
automation yet — the process should be exercised a few times before it is baked
into a workflow.

1. **Be on a clean, green `main`.** CI passing, nothing uncommitted.
2. **Bump both version files in one commit** — `lib/daybreak-version.ts` and
   `package.json`. The parity test
   (`tests/unit/lib/daybreak-version.test.ts`) fails if you bump one and forget the
   other, which is the point of it.
3. **Move the changelog's `[Unreleased]` section under a new `## [X.Y.Z] — YYYY-MM-DD`
   heading**, and add a fresh empty `[Unreleased]`. Read it as a leaf would: does it
   say what will land on them?
4. **Re-read the prose around what the release changed** — the step that is easy
   to skip and cost 0.2.0 four defects. A release is unusually good at falsifying
   sentences that were true when written, because it removes and moves things
   other prose cites as evidence. Nothing automated catches this: type-check and
   lint do not read prose, and `check:changelog-drift` correlates _identifiers_,
   which here never change — `/api/health` still exists, it just no longer
   carries what a docblock says it does.

   Three places, in this order:

   - **Docblocks in the files the release touched.** `/pre-pr` does not read
     these — its documentation step is `.context/`-scoped, so it prints CLEAN
     having looked at no comment at all (Sunrise #733). 0.2.0 shipped
     `lib/daybreak-version.ts` telling a leaf to fetch a field the same release
     removed.
   - **The leaf-facing docs for the surfaces that moved** — especially
     [`building-on-daybreak.md`](./building-on-daybreak.md), which is the copy a
     leaf actually follows. Its Versions table named the wrong endpoint for two
     of the three versions.
   - **The new release section itself**, re-read after any reshuffle. Consolidating
     duplicate `###` headings moved `Added` above `Removed` and falsified a
     "see Added below" written when it was true.

   The test is not "is the rule still right?" but **"is this still the witness?"**
   — grep the cited file, endpoint or field rather than reasoning from memory. The
   rule usually survives; the example is what rots. When repointing one, name the
   succession ("that witness used to be X, until …") so the next reader does not
   re-derive it.

5. **Open a PR** (`chore(release): Daybreak X.Y.Z`), merge it.
6. **Tag the merge commit on `main`** and push the single ref:

   ```bash
   git checkout main && git pull --ff-only
   git tag -a daybreak-v0.2.0 -m "Daybreak 0.2.0"
   git push origin daybreak-v0.2.0
   ```

7. **Create a GitHub release** pointing at the tag, with the changelog section as
   its body.
8. **Tell the leaves** — especially if the release moved a seam's ownership.

---

## Consuming a release (the leaf's side)

Full guide: [`building-on-daybreak.md`](./building-on-daybreak.md). The short form:

```bash
git remote add daybreak git@github.com:human-centric-engineering/daybreak.git
git fetch daybreak --tags
git merge daybreak-v0.2.0
```

A leaf merges **Daybreak**, never Sunrise directly — Daybreak carries Sunrise
through, along with the reconciliation work each platform sync needed. Merging
Sunrise into a leaf means solving that work a second time, differently, and
conflicting with Daybreak on the next merge.

---

## Notes for leaf forks

- **The parity test in `tests/unit/lib/daybreak-version.test.ts` is expected to fail
  in your repo** — the case asserting `DAYBREAK_VERSION === package.json.version`.
  That is correct: your `package.json` carries _your_ version. Delete that one case
  and keep the rest of the file. (Same pattern as Sunrise's `defaults.test.ts`: pin
  or drop the one row that does not apply, rather than deleting the file.)
- **Do not edit `lib/daybreak-version.ts` or `lib/sunrise-version.ts`.** Both merge
  through. Your version lives in `package.json`.
