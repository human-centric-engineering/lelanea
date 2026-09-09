---
name: divergences
description: Every Lelañea edit to a file Daybreak or Sunrise owns, why it was forced, and what would let us delete it.
---

# Divergence ledger

Lelañea owns the `leaf-*` seams, `.context/app/`, `components/app/`,
`prisma/schema/app.prisma`, `app/brand-theme.css`, and any new file it creates.
Everything else arrives from Daybreak (which carries Sunrise through) and merges
on every sync.

**A row here is the price of editing one of those files.** Without it, the next
sync meets the change as a conflict with no explanation, and the tempting
resolution — take upstream — silently reverts a decision somebody made on
purpose. So: every edit to a file we do not own gets a row, in the same PR as
the edit (`sunrise.divergences`).

**Filling a seam is not a divergence.** `lib/app/leaf-*.ts`,
`lib/app/reserved-tiers.ts`, `app/brand-theme.css` and the rest of the empty
`lib/app/*` scaffolds exist precisely to be filled, and they merge cleanly.
Only files an upstream tier owns _and keeps evolving_ belong here.

**Every row carries a deletion trigger** — the specific thing that would make it
removable. A ledger without them only grows.

## How to use this on a sync

Read the rows before you merge, not after. For each conflict in a file named
here, the "on conflict" column says what to do; the default is to re-apply our
change on top of upstream's, never to take one side wholesale.

---

## Row 1 · `app/layout.tsx` — brand fonts on `<html>`

|                      |                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**             | `app/layout.tsx` (Sunrise)                                                                                                                                                                                                                                                                                                                                                                              |
| **Change**           | Imports `brandFontVariables` from `app/fonts.ts` and adds it as `className` on `<html>`.                                                                                                                                                                                                                                                                                                                |
| **Forced by**        | `next/font` returns a class that must be applied to a real element; there is no seam that applies one. `lib/app/` is out — the platform's own ESLint boundary bans runtime `next/*` imports there and names `app/` as the remedy. A route-group layout would miss body-portaled overlays (`.context/ui/surface-theming.md` constraint 1), leaving every dialog and toast in the browser's default face. |
| **On conflict**      | Keep both. Take upstream's `<html>` attributes and re-add `className={brandFontVariables}`. If upstream has introduced its own `className` there, compose rather than replace.                                                                                                                                                                                                                          |
| **Upstream status**  | Not filed. This is ordinary fork work that a seam would tidy, not a defect.                                                                                                                                                                                                                                                                                                                             |
| **Deletion trigger** | Daybreak or Sunrise ships a font seam — any scaffold whose value the root layout applies to `<html>`. Move the three loaders into it and delete this row.                                                                                                                                                                                                                                               |

## Row 2 · `app/layout.tsx` + `hooks/use-theme.tsx` — the system preference stays a default

|                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Files**            | `app/layout.tsx` (the no-flash script) and `hooks/use-theme.tsx` — both Sunrise                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Change**           | Both stop writing the resolved system preference to `localStorage`. The hook now also follows `prefers-color-scheme` changes for as long as nothing is stored. Only `setTheme` writes. The storage key, the `<html>` class and the hook's public shape are untouched.                                                                                                                                                                                                                    |
| **Forced by**        | Upstream persisted the _default_ as though it were a choice, so from the second visit onward "hasn't chosen" and "chose light" were the same stored state, and a later OS switch was never followed. Decision D4 (owner, 8 September 2026) is that the system preference is the default and only the toggle persists. In vanilla Sunrise the bug is invisible — both themes are near-greyscale; against Lelañea's oyster white and near-black charcoal it is the whole first impression. |
| **On conflict**      | Keep ours. The two files must agree: the script's resolution and the hook's initial state are the same expression, and if they diverge the first paint disagrees with the first render. If upstream has rewritten theme handling entirely, check whether it now distinguishes "no choice" from an explicit one — if it does, take upstream and delete this row.                                                                                                                          |
| **Upstream status**  | Filed: [daybreak#236](https://github.com/human-centric-engineering/daybreak/issues/236). Reported as a defect with this repo as the reference implementation; we did not volunteer the platform's fix (`B7`). Daybreak may fix it at its own tier or hand it to Sunrise — either closes this row.                                                                                                                                                                                        |
| **Deletion trigger** | daybreak#236 lands: theme resolution that treats an absent `localStorage` value as "follow the system" rather than writing to it, whether as a fix or behind a seam. Then both edits revert to upstream. Check on the sync that carries it, not before — a partial fix moving only the hook still needs our layout-script change.                                                                                                                                                        |
