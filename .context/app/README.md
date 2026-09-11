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

Add a `.context/app/<feature>.md` per feature as they land, and list it here.

## Conventions worth keeping

- **Our release notes go here**, not in the root `CHANGELOG.md` (Sunrise's, and
  append-only-guarded) or `.context/framework/CHANGELOG.md` (Daybreak's).
- **Our planning goes here**, not on the board in
  `.context/framework/planning/` — that tracks Daybreak's own features.
- **Our tables are `app_*`.** `framework_*` is Daybreak's and `ai_*` / core
  tables are Sunrise's; the boundary CI keys on those prefixes.

## Known next steps

Carried deliberately from the fork, so they are recorded rather than
rediscovered. Re-checked against the tree and the repo settings at t-19.

- **The privacy policy is still Sunrise's template.** `/privacy` renders the
  starter template's generic policy, kept on purpose and labelled as interim by
  the notice D8 required — deleting it would leave the site with no policy at
  all, and writing one ourselves would put a legal document on lelanea.com that
  no lawyer has seen. It closes when her own policy is written, not before. The
  Terms of Use cross-reference it (clause 12) and the authored file flags it as
  an open review note. See `app/(public)/privacy/page.tsx` and
  [`divergences.md`](./divergences.md) row 10.
- **No provider keys are configured.** OpenAI, Resend and Google OAuth were
  deliberately not inherited from Daybreak; add Lelañea's own when a feature
  first needs one. Still true: `.env.local` carries only the database, the
  auth secret and the app URL, and the repository has no Actions secrets.
- **Two of the three CI variables are still unset.** `CI_TEST_SCOPE` is set to
  `changed`. On a private 2-core/8GB runner, consider `CI_NODE_HEAP_MB` and
  `CI_LINT_CHUNKS` too — see [`../architecture/ci.md`](../architecture/ci.md).
  Leave `SUNRISE_UPSTREAM_URL` unset (see [`syncing.md`](./syncing.md), trap 3).
