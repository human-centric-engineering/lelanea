---
name: app-docs
description: Index for Lelañea's own documentation — the leaf tier's substrate.
---

# Lelañea documentation

This is the **leaf tier's** documentation tree. Daybreak and Sunrise both reserve
`.context/app/` and ship nothing into it, which is exactly why everything we put
here survives every upgrade without a conflict.

## The three substrates

| Tree                           | Owner    | You                         |
| ------------------------------ | -------- | --------------------------- |
| `.context/app/`                | Lelañea  | write freely — this is ours |
| `.context/framework/`          | Daybreak | read; it merges through     |
| everything else in `.context/` | Sunrise  | read; it merges through     |

Start with [`building-on-daybreak.md`](../framework/building-on-daybreak.md) —
Daybreak's guide to being a leaf — then [`../substrate.md`](../substrate.md) for
the platform beneath. The `CLAUDE.md` banner is the short version of both.

## Our docs

| Doc                                  | Covers                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| [`syncing.md`](./syncing.md)         | Pulling a Daybreak release, and the three traps around it                     |
| [`local-dev.md`](./local-dev.md)     | Running locally alongside a Daybreak checkout                                 |
| [`divergences.md`](./divergences.md) | Every edit we carry to a Daybreak- or Sunrise-owned file, and why             |
| [`brand-theme.md`](./brand-theme.md) | The palette, the three typefaces, and how a surface gets branded              |
| [`content.md`](./content.md)         | Lelañea's authored words: the files, the loader, the API, the renderer        |
| [`waitlist.md`](./waitlist.md)       | The public waitlist: the model, the routes, the admin list, Art. 15 / Art. 17 |
| [`shell.md`](./shell.md)             | The four-column app shell at `/app`: panes, state, and adding a view          |

Add a `.context/app/<feature>.md` per feature as they land, and list it here.

## Conventions worth keeping

- **Our release notes go here**, not in the root `CHANGELOG.md` (Sunrise's, and
  append-only-guarded) or `.context/framework/CHANGELOG.md` (Daybreak's).
- **Our planning goes here**, not on the board in
  `.context/framework/planning/` — that tracks Daybreak's own features.
- **Our tables are `app_*`.** `framework_*` is Daybreak's and `ai_*` / core
  tables are Sunrise's; the boundary CI keys on those prefixes.

## Known next steps

Carried deliberately from the fork, so they are recorded rather than rediscovered:

- **The public landing page is still Sunrise's copy.** `/` renders the starter
  template's hero, feature grid and FAQ — 23 mentions of "Sunrise" — because that
  is product content, not a brand seam. The seams themselves are correct: the
  title, both footers, the meta description and every email already say Lelañea.
  Replacing the copy is ordinary app work; see `CUSTOMIZATION.md` §6 for the
  route-shim pattern that keeps our content in app-owned files.
- **No provider keys are configured.** OpenAI, Resend and Google OAuth were
  deliberately not inherited from Daybreak; add Lelañea's own when a feature
  first needs one.
- **CI variables are unset.** On a private 2-core/8GB runner, consider
  `CI_TEST_SCOPE`, `CI_NODE_HEAP_MB` and `CI_LINT_CHUNKS` — see
  [`../architecture/ci.md`](../architecture/ci.md). Leave `SUNRISE_UPSTREAM_URL`
  unset (see [`syncing.md`](./syncing.md), trap 3).
