---
name: syncing
description: How Lelañea pulls a Daybreak release, and the three traps that make it go wrong.
parent: README.md
---

# Syncing Daybreak

```bash
git fetch daybreak --tags
git merge daybreak-v0.4.0        # tags are prefixed `daybreak-v`
npm install                      # the release may move dependencies
npm run db:migrate:status
npm run db:migrate:dev           # prod/CI: db:migrate:deploy
npm run db:drift-check
```

**Read [`../framework/CHANGELOG.md`](../framework/CHANGELOG.md) BEFORE merging.**
A seam changing hands between tiers is a breaking change and is called out there.
Which files are Daybreak's is itself versioned surface.

## The three remotes

| Remote     | Points at | Use                                                 |
| ---------- | --------- | --------------------------------------------------- |
| `origin`   | lelanea   | ours                                                |
| `daybreak` | daybreak  | **the only thing we merge**                         |
| `sunrise`  | sunrise   | reading and ancestry checks only — **never merged** |

A bare `vX.Y.Z` tag in this repo is a **Sunrise** tag; Daybreak's are prefixed
`daybreak-v`. They share a namespace, and the prefix is the only thing telling
them apart.

## Trap 1 — never merge Sunrise directly

Tempting when Sunrise ships something we want. Don't:

- We would get platform changes **Daybreak hasn't reconciled yet**, and solve
  that reconciliation ourselves — differently from how Daybreak will.
- We would then conflict with Daybreak's version of the same resolution on the
  next merge.

Wait for the Daybreak release. If something upstream is urgent, ask Daybreak to
sync.

## Trap 2 — never squash a sync PR

Use **"Create a merge commit"**. Squashing keeps every file but drops the second
parent, silently resetting the merge base: the tree is correct and
`lib/daybreak-version.ts` names the new release, but git now thinks we never
merged it. Nothing errors and nothing logs. The bill arrives at the _next_ sync,
which replays the whole preceding range and conflicts on changes already present
— by which time the cause is months of history away.

Daybreak paid exactly this on its v0.8.1 sync. `Fork Sync Integrity` fires on push
to `main` and prints the repair while the context is fresh.

Squash remains the sensible default for our own feature work.

## Trap 3 — leave `SUNRISE_UPSTREAM_URL` unset

`Fork Sync Integrity` looks for the tag `v<SUNRISE_VERSION>` — Sunrise's
namespace — resolved against whatever that variable points at. **Pointing it at
Daybreak is the mistake a leaf is most likely to make**: Daybreak versions itself
independently, so you may fetch _its_ `v0.9.0`, an unrelated release of a
different project.

Sunrise is public and reachable from here, so leave the variable unset. Without
it the check resolves Sunrise's own URL, which is what we want.

## Verifying a sync landed

```bash
git merge-base --is-ancestor daybreak-v0.4.0 HEAD && echo "in my history"
git merge-base --is-ancestor v0.12.0 HEAD && echo "Sunrise ancestry intact"
```

**A closed issue is not a landed seam, and a landed seam is not a deleted shim.**
If we ever carry a local patch of a Daybreak- or Sunrise-owned file, cite the
upstream issue at the patch site so the next sync's conflict resolves toward
upstream instead of re-deriving the patch.

## Two tests adjusted on purpose

Both assert a property a leaf is _supposed_ to violate. **Do not restore them.**

- `tests/unit/lib/daybreak-version.test.ts` — the `DAYBREAK_VERSION ===
package.json.version` parity case is removed; our version and the framework's
  are meant to diverge.
- `tests/unit/lib/app/defaults.test.ts` — three rows are pinned rather than
  deleted, so the seams still empty keep their protection: `leaf-brand.ts` (our
  brand values), `leaf-ci.ts` (our five always-run tests; the other two lists
  pinned `[]`), and the `lib/app/ci.ts` bridge row (Daybreak's entries followed
  by ours — the only row that proves the bridge still reaches the seam). Update
  them whenever the seam they pin changes.

## One Daybreak guard deliberately unwired from CI

`app:ci-checks` in `package.json` — Sunrise's fork-owned CI seam — runs
`framework:boundary` only. Daybreak wires `framework:changelog` there too, and
**we removed it on purpose** ([`daybreak#258`](https://github.com/human-centric-engineering/daybreak/issues/258)).

The guard's first rule flags any top-level `lib/app/*.ts|mjs` change as
"Daybreak public surface — add an entry to `.context/framework/CHANGELOG.md`".
That is right in Daybreak's repo, where such a diff means a seam changed hands.
In a leaf it fires on every PR that fills a seam Daybreak reserved for us —
`leaf-bootstrap.ts`, `eslint.config.mjs`, `capabilities.ts`, `jobs.ts`, any of
them — and the remedy it names is an edit to Daybreak's release log, which we
must not make. First hit: PR #31, the first `lib/app/*` change after the 0.3.0
sync made the guard a real gate.

**What we gave up:** the guard's append-only-history rule on
`.context/framework/CHANGELOG.md` no longer runs in our CI. We only ever
receive that file through a sync, and `changelog-structure.test.ts` still
guards its shape, so the loss is small. Run `npm run framework:changelog` by
hand on a sync PR if you want the history rule's opinion.

**On conflict:** the line will conflict whenever Daybreak changes
`app:ci-checks`. Take Daybreak's version, then drop `framework:changelog` from
it again — unless the release notes say the guard is now leaf-aware, in which
case keep theirs. That is the deletion trigger for this section.
