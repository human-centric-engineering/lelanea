---
name: building-a-feature
description: The operational rhythm for building a Daybreak framework feature — plan-first → per-task gate loop → close-out. Read this before starting a feature.
parent: plan.md
---

# Building a Daybreak feature — the flow

> **Who this is for:** anyone (and any AI agent) picking up a feature from the
> **HCE Hub** (Daybreak project, slug `daybreak` — the pointer block is in
> [`CLAUDE.md`](../../../CLAUDE.md)). Since 2026-09-18 the Hub is the board and the system
> of record: claim / plan / start / complete / ship are Hub tool calls, and the process rules
> are served from `hub://process/core` and `hub://process/sunrise-fork`. The old markdown
> board in [`plan.md`](./plan.md) is frozen history — never edit it to claim or track work.
> **This doc is the _execution rhythm_** that goes with the Hub, distilled from
> building `f-bootstrap` and `f-module-core` so a new contributor doesn't repeat the
> learning curve. The best worked example to copy is
> [`f-module-core.md`](./f-module-core.md) (the detailed plan) plus its three PRs (#10/#11/#12).

## The loop, at a glance

**Claim + plan first → build each task through the gate loop → close out the feature.**
Never skip the plan. Never push to `main`. Fix review findings before merging. When a
feature merges, ship it in the Hub so the next person sees the truth.

## 1. Claim + plan first (don't jump to code)

1. **Claim it in the Hub.** `claim_feature` (after `next_task` / `get_feature` to see what's
   open). One owner per feature. _Do not_ edit `plan.md`'s Owner / Status columns — that
   board is frozen.
2. **Write the feature's detailed plan** at `.context/framework/planning/<feature>.md`,
   following the shape of [`f-module-core.md`](./f-module-core.md):
   - **Intent** — what and why (the binding _how_ is in
     [`framework-architecture.md`](./framework-architecture.md), Appendix A decisions).
   - **Reconcile the spec against the current repo.** The spec (rev 16) predates a lot of
     the code; verify every assumption — especially "assumed landed" Sunrise deps — against
     the actual tree before baking it in, and record each adaptation as a decision. See
     [`planning-retro.md`](./planning-retro.md) A1/B2.
   - **A promoted-tasks table** — `t-N`, files-likely-to-touch, deps, status, PR. Run the
     **sizing self-check**: a task whose only real content is scaffolding + one small file is
     a _commit_, not a PR — fold it into its dependent task (retro B1).
   - **Per-task "Done when"** that lists the gates as completion criteria (retro B4).
   - **The test strategy, up front.** vitest runs on `happy-dom` with **no live DB**: unit
     tests mock `@/lib/db/client` and forward `executeTransaction` to a `tx` mock; prove an
     end-to-end chain with a small stateful in-memory fake; use `smoke:*` scripts for real-DB
     fidelity. Never write "integration test against the dev DB" (retro B9).
3. **Present the plan to the feature owner before building** — especially task sizing and any
   genuine design/forkability decisions. Planning is collaborative; surface the choices, don't
   pre-commit.
4. **Record the plan in the Hub, then push the `<feature>.md` as a standalone docs PR _before_
   starting any task work.** `plan_feature` / `create_task` put the tasks and their done-whens
   on the Hub (that is the claim everyone can see); the new `<feature>.md` goes up as a
   docs-only PR that merges before t-1 begins. (Docs-only, so it skips `/security-review` and
   `/code-review` — see step 3 of close-out.) _Pre-Hub, the claim was a `plan.md` edit in the
   same PR; that column is now frozen._

## 2. Build each task — the gate loop

A **task is one PR** (~200–600 lines; cohesive, reviewable). For each:

1. **Branch off `main`** — `feat/<feature>-tN-<slug>`. **Never commit or push to `main`.**
2. **Build to the right shape, not the expedient one.** If it needs doing properly (a real
   seam, a correct data model), do that now — don't ship a review-passing-but-wrong version
   and defer the correct one.
3. **Run the gates, in this order:**

   ```
   commit → /pre-pr → /security-review → (npm run format) → push → open PR → /code-review
   ```

   - **`/pre-pr`** — type-check, lint, format, full test suite + coverage, migration-drift.
   - **`/security-review`** — before pushing, not after.
   - **Format before push** — `npm run format && npm run format:check`; CI's `format:check`
     is the source of truth (Markdown especially).
   - **Open the PR against Daybreak explicitly:** `gh pr create --repo
human-centric-engineering/daybreak …`. Bare `gh` targets the **Sunrise upstream** repo.
   - **`/code-review`** — run it to its full spec (the high-effort path is 8 finder angles + a
     verify pass). It has caught real defects on most PRs here; take it seriously.

4. **Fix confirmed findings as a transparent follow-up commit** (don't force-push over the
   reviewed commit — the review's effect should be visible in history). Document findings you
   accept or refute, and why.
5. **The owner merges.** `set_pr` on the task when the PR opens; `complete_task` when it
   merges. Do **not** track an "in-PR" status anywhere else — one transition, nothing to forget.

Every task inherits the repo rules in [`CLAUDE.md`](../../CLAUDE.md): `logger` not `console`;
the `@/` alias, never relative imports; validate external input with Zod; a new `User` relation
needs an `onDelete` policy; rate-limiting is automatic via `proxy.ts` (don't add a handler
limiter for a plain read). The **boundary** is enforced by ESLint + CI — build in
`lib/framework/`; core must never import it.

## 3. Close out the feature

When the **last task merges**, the feature is shipped — reconcile everything so the Hub
tells the truth (a merge changes what's claimable):

- `ship_feature` in the Hub with a closing summary; the Hub unblocks dependents itself. Record
  any decisions that haven't been recorded yet with `record_decision` (most should already be
  there — a decision is recorded when it stops moving, not at ship).
- In the feature's own doc, set frontmatter `status: shipped` and its `t-N` rows to `done`.
- Do **not** touch `plan.md` — its board and work-completed log are frozen at the Hub import.
- **Append this feature's execution lessons** to [`planning-retro.md`](./planning-retro.md) §B
  (feature-plan authoring) or §A (overall-plan authoring). That file is how the process
  improves — if you learned something the hard way, write it down so the next feature doesn't.

Docs-only changes (like this board reconciliation) still go on a branch + PR — never straight
to `main` — but they skip `/security-review` and `/code-review`.

## The disciplines underneath

- **Three tiers (Sunrise → Daybreak → app).** Build in `lib/framework/` + `.context/framework/`.
  Keep the **leaf surface reserved empty** (`lib/app/*`, `.context/app/`, `prisma/schema/app.prisma`)
  for the apps that fork Daybreak — filling it collides with a leaf's own code on upgrade. Full
  ownership table: [`README.md`](../README.md).
- **Fork-first informs upstream.** If a feature needs a generic capability Sunrise lacks, build
  it **correctly in the fork as its final generic shape**, prove it in situ, then **file an
  upstream Sunrise issue** (with the fork-build learnings) as the feature's _own_ deliverable —
  not a throwaway, and not delegated away.
- **Ship nothing a fork has to delete.** A fresh fork of Daybreak should boot clean — no example
  rows, no scaffolding to strip. Prove things in `tests/`, not by shipping demo data.

## Reference

- The **HCE Hub** (Daybreak project) — the board, the working model, how to claim; pointer block in [`CLAUDE.md`](../../../CLAUDE.md).
- [`plan.md`](./plan.md) — the pre-Hub board, frozen 2026-09-18; history only.
- [`f-module-core.md`](./f-module-core.md) — the worked example to copy (detailed plan → 3 PRs).
- [`planning-retro.md`](./planning-retro.md) — process lessons (read §A/§B before planning; add to them after).
- [`framework-architecture.md`](./framework-architecture.md) — the spec + binding decisions (Appendix A).
- [`README.md`](../README.md) — the three-tier ownership model.
- [`CLAUDE.md`](../../CLAUDE.md) — repo rules every task inherits.
