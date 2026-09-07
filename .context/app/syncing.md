---
name: syncing
description: How Lelañea pulls a Daybreak release, and the three traps that make it go wrong.
parent: README.md
---

# Syncing Daybreak

```bash
git fetch daybreak --tags
git merge daybreak-v0.3.0        # tags are prefixed `daybreak-v`
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
git merge-base --is-ancestor daybreak-v0.3.0 HEAD && echo "in my history"
git merge-base --is-ancestor v0.11.2 HEAD && echo "Sunrise ancestry intact"
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
- `tests/unit/lib/app/defaults.test.ts` — the `lib/app/leaf-brand.ts` row is
  pinned to our brand values rather than deleted, so the seams still empty keep
  their protection. Update it whenever `leaf-brand.ts` changes.
