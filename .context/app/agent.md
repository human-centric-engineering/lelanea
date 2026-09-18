---
name: app-agent
description: The one agent — which model she is pinned to and why, where an admin changes it, why there is no fallback, the two seats she holds, her deadlines and the monthly spending limits, and what is known to be missing until the turn seam lands.
---

# The agent: what she runs on, and where she sits

There is one agent a person talks to — `lelanea-guide`, created by f-voice with
her fingerprint profile (see [`voice.md`](./voice.md)). This doc is about the
part of her that is not her voice: the model behind it, the seats she is bound
to, and what happens around a turn.

It grows with §08. What is here now is the pin, the seats, and the deadlines and
spending limits.

## What is pinned

| Agent                | Provider | Model                    | Fallback providers |
| -------------------- | -------- | ------------------------ | ------------------ |
| `lelanea-guide`      | `openai` | `gpt-4o-mini-2024-07-18` | none               |
| `voice-control-bare` | `openai` | `gpt-4o-mini-2024-07-18` | none               |

The values live in `lib/app/agent/pins.ts`; `prisma/seeds/app-lelanea/005-agent-models.ts`
writes them.

**A dated snapshot, never an alias.** Product description §8.2: _"Version pinning,
never latest. A model upgrade is a change to the product's voice and judgment,
and it should be a decision rather than an event that happens overnight."_ Before
the pin both agents had an empty provider and model and resolved, at turn time,
to whatever this install's default chat model was.

**Why this model.** The owner's ruling was to pin the model the golden set was
signed off on. That is on the record rather than remembered: of the three run
pairs queued on 17 Sept 2026, only the last completed without failing every case,
and its cost rows name `openai` / `gpt-4o-mini`. That string is an alias; the
provider reports serving it from `gpt-4o-mini-2024-07-18`, which is what is
pinned.

**Why both agents — and why the control is not "pinned" at all.** The golden set
compares her voice with a bare model. Leave the control floating and the
comparison measures two models rather than the fingerprint, with nothing on the
screen saying so. So the control **follows her**: once her row is settled, a
blank control is set to whatever she is on — the dev pin, or a model an admin
chose for her — and never to the dev pin on its own account. Its timeline entry
says so (`Matched to lelanea-guide's model`). A control somebody set is left
alone; if it differs from hers the seed says so, and `assertArmsComparable()`
refuses the next run.

### This is the dev pin — change it in the admin, not in the code

Production's model is chosen later, by evaluation (§8.2: nothing is promoted
without the golden set being re-run and listened to). So the pin is
**operator-owned**:

- The seed writes her provider and model only where **both are still blank**. A
  value somebody set is never written over — including a half-set one, which
  also leaves the control blank, because there is no whole pair to follow.
- **A pin somebody undid stays undone.** The seed leaves exactly one pin entry in
  her timeline, so blank _with_ that entry behind it is an admin's restore to the
  floating default, not a fresh agent — it is reported and left alone.
- To change her model: `/admin/orchestration/agents` → `lelanea-guide` → Model.
  **Change `voice-control-bare` to the same pair**, or the next golden-set run is
  refused with a message naming the mismatch.
- Editing the constants in `pins.ts` changes what a **fresh** install gets. It
  does nothing to an install that already has a pin, and re-running the seed will
  not "fix" that — it is the rule working.

The pin is an entry in her version timeline (`Pinned model and provider (seeded —
§08)`), written through the platform's own snapshot helpers, above a recorded
`Initial configuration`. A seed that wrote the column directly would have left a
timeline with no entry for the change. It does **not** take away the way back:
restoring v1 returns her to the floating default, as restoring any agent's first
version returns it to how it was created — a deliberate act on operator-owned
config, which leaves an entry of its own.

### Whether there is anywhere for her turns to go

An explicit provider is never re-picked and there is no fallback, so a pin to a
slug the install cannot reach ends every one of her turns. When the seed is about
to choose for her, two states look alike and get opposite answers:

| This install has…                           | The seed…                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| no active provider at all (a fresh install) | **pins, and warns.** `db:seed` always runs before setup, and the runner does not come back to an applied unit |
| active providers, none under `openai`       | **writes nothing and throws.** She is working there, on the install default; the pin would break her          |

The second is not recorded as applied, so it is tried again on the next seed —
**and the runner stops at a throw, so every seed unit that sorts after this one
waits with it**, the seats and Daybreak's own `framework/` units included. That
cost is accepted: the alternative is a unit recorded as applied that pinned
nothing, and an agent left floating with nobody told. The error says all of this,
and
the error names both ways out: configure OpenAI under the slug **`openai`**, or
choose her model in the admin — after which the seed sees a decision already made,
leaves it alone, and matches the control to it.

### The matrix row

The platform's provider-model matrix carries the alias only, so the seed adds
`openai-gpt-4o-mini-2024-07-18`. Without it the dated id is missing from the agent
form's Model dropdown — an admin opening her agent could not re-select the value
she is already on.

It follows the platform's own protocol: `isDefault: true` means seed-managed and
reconciled; edit the row in the admin and `isDefault` flips off and the seed
leaves it alone from then on. A row an admin already added for that model under
their own slug is theirs, and is left alone too.

Two of its values look wrong and are deliberate — both because a **positive**
number on a matrix row overrides what the registry already holds:

- **Cost: none.** See [How her model is priced](#how-her-model-is-priced). The
  price of that choice: the admin model list lets the matrix row _replace_ the
  registry entry rather than merge with it, so this model is listed there with no
  price beside an alias that shows one. A wrong number in every cost row is worse
  than a blank in a dropdown.
- **Context length: `n_a`.** The column is a coarse label the platform turns into
  a token count, and the chat handler trims history to it. `high` — what the
  platform's row for the alias says — is 200,000 against a 128,000-token model,
  so a long conversation is rejected by the provider instead of trimmed; `medium`
  (32,000) made her budget flip between 32k and 128k depending on whether a
  hydrate or the leaf's registration wrote last. `n_a` is 0, which falls through
  to the registry's exact 128,000 in every order — and where nothing exact
  exists, the handler reads 0 as "no token budget", not as a budget of nothing.

## Why there is no fallback

Owner ruling, 18 Sept 2026. The platform has no fallback _model_: failover swaps
the provider and asks the next one for the **same model string**. Her voice was
signed off on one model, so a second would need its own golden-set sign-off
before it could speak as her.

So: explicit provider, explicit model, empty fallback list. An explicit provider
is never re-picked by the platform, and with no list there is nowhere to fail
over to. When her model is unreachable the turn ends and says so, and everything
readable stays readable — that behaviour is §08 t-55.

The seed never writes `fallbackProviders`. Empty is the column's default; a
non-empty list is an operator's, and is logged as contradicting this ruling
rather than cleared.

## The side roles are not seeded

Not everything that calls a model speaks as her: the conversation summariser
resolves through the platform's `routing` default; slot extraction, the
facilitation supervisor and keyword enrichment through `chat`. The ruling is that
they sit on the cheapest current model, and **the platform already does that** —
the setup wizard fills blank defaults from the provider the operator actually
configures.

The first version of the model seed filled those two keys itself. It was removed:
the seed runs _before_ any provider exists, the wizard skips a slot that is
already taken, and an install that configured anything but OpenAI got every
unbound platform agent asking its provider for a model it does not serve.

Change them at `/admin/orchestration/settings`. **If you set one by hand, use an
id the platform's static map knows** (the alias `gpt-4o-mini`, not the dated
snapshot). A task default is read by paths that look the model up by bare id —
the workflow LLM runner (`lib/orchestration/engine/llm-runner.ts`) does it before
any leaf seam has run, and **throws `unknown_model` on a miss**. Her own turns do
not have that problem: an agent's explicit model goes through the resolver, which
wires the seam first.

## The seats

`prisma/seeds/app-lelanea/006-agent-seats.ts` binds her to two of Daybreak's six
facilitation seats: **`onboarding`** (first contact) and **`facilitator`**.
Daybreak ships the seats and the binding mechanism and leaves filling them to the
leaf; until this ran, its role route answered 404 for every role.

- It fills **empty seats only**. A seat holds one agent, and reassigning it is an
  unbind plus a rebind — so a seat another agent holds is an operator's decision,
  and is reported and left alone.
- It never reads or writes the other four seats, and has no removal pass.
- **Known limit: it cannot tell a seat left empty on purpose from one never
  filled.** Unbind her and leave the seat empty, and the next re-run of this unit
  (any edit to a file it hashes, Daybreak's `roles.ts` included) seats her again.
  To keep her out of a seat, take the role out of `SEATED_ROLES`.
- It does **not** run Daybreak's framework sync, as the journey-map seed does: a
  binding points at no row that only boot materialises. The role is checked
  against a constant in code, and the only row it needs is her agent.

**She is still `internal`, with no capabilities, so the role route still answers 404.** That is deliberate. Widening her also opens Sunrise's general consumer chat
route, which carries no turn id, no seat and no record of what produced a turn.
Both land with the turn seam (§08 t-54), not before it.

## How her model is priced

**A dated pin would otherwise cost every one of her turns at $0.** Sunrise's cost
tracker prices from an in-memory model registry. Its static map holds the alias
`gpt-4o-mini` and not the dated snapshot; the snapshot reaches the registry only
from an OpenRouter refresh or a hydrate from the matrix, and **nothing on the
chat path or in the evaluation worker calls either** — only the admin cost and
model pages and the estimators do, and Next can bundle the registry separately
per route, so warming one copy does not reliably warm another.

Measured on 18 Sept 2026, in a cold process, 3,000 tokens in and 300 out:

| State                                           | Alias    | Dated id     |
| ----------------------------------------------- | -------- | ------------ |
| Cold — the static map only                      | $0.00063 | **$0**       |
| After a matrix hydrate, row at a blended rate   | $0.00124 | $0.00124     |
| After the leaf seam has run, row at a null cost | —        | **$0.00063** |

So the leaf teaches the registry this one model's rate. Owner ruling, 18 Sept
2026 — over pinning the alias (priced, but it can be repointed) and over
accepting $0 until the turn seam lands (which zeroes the golden-set costs on
`/admin/app/voice` today).

- **The rate** is `PINNED_MODEL_INFO` in `lib/app/agent/pinned-model.ts`: $0.15 in,
  $0.60 out, per million. It is part of the pin — change `PINNED_MODEL` and the
  rates change in the same edit; a test holds the three values together.
- **What registers it** is `ensurePinnedModelPriced()`, in the same file — one map
  lookup when the rate is already there, one registration when it is not. It has
  two callers.
- **The first caller** is `lib/app/llm-providers.ts`. That seam exists for
  provider-eligibility rules and we register none. It is used for its **timing**:
  it is the one leaf hook Sunrise runs lazily, in whichever module graph is about
  to resolve a provider, before that call's cost is logged. Registering a model is
  synchronous, idempotent and restricts nothing, so Sunrise's own test that this
  seam ships with no eligibility rule still passes against the filled file.
- **The second caller is the voice preflight** (`lib/app/voice/preflight.ts`). The
  estimator prices from the registry and never resolves a provider, so the seam
  does not run on that path; without the call, the estimate on `/admin/app/voice`
  depended on OpenRouter answering.
- **The matrix row's cost is null, on purpose.** The column is one number for
  both directions, and on hydrate a positive value **overrides** a split price
  already in the registry — the second row of the table. Null falls through to
  the exact rate. Where no exact rate exists either, the model reads as unpriced,
  which the voice preflight flags rather than showing as cheap.

### What this does not cover

**A model an admin later pins through the agent form.** If that id is outside
Sunrise's static map, it prices at $0 in a cold process for the same reason, and
nothing here helps: the registration is for one named model. Pricing an arbitrary
id on the chat path is the platform's gap, reported upstream; §08 t-54 carries
the requirement that a miss on the turn path is surfaced rather than logged as
free. Until then, **changing her model means checking the new id is in the static
map, or adding its rate beside the pin.**

**A cost typed onto the matrix row.** The row is seed-managed until an admin — or
the model auditor's apply step — edits it, and from then on it is theirs. Give it
a cost and that single number overrides the split rate wherever a hydrate runs;
`ensurePinnedModelPriced()` leaves any positive rate alone, deliberately, because
the same rule is what lets OpenRouter's figure stand. Leave that cell empty.

**A registry refresh.** `refreshFromOpenRouter()` rebuilds the registry from the
static map plus OpenRouter's list, which drops our entry, and the seam is wired
once per process so it does not put it back. After a _successful_ refresh that is
harmless — OpenRouter lists this snapshot at the same rate, and delists one only
when the provider retires the model. A _failed_ refresh leaves the registry as it
was. Nothing on the chat path or in the evaluation worker refreshes at all; it
takes an admin page sharing the module instance. §08 t-54 owns the turn path and
can call `ensurePinnedModelPriced()` per turn, which closes even that.

The seam fill goes when Sunrise prices an id outside its static map on the chat
and evaluation-worker paths — reported as
[`sunrise#813`](https://github.com/human-centric-engineering/sunrise/issues/813),
which also carries the blended-rate and history-budget overrides described above.

## Deadlines and monthly limits

Owner ruling at claim (§08 t-53): no first words within **8 seconds** and the app
speaks up; a turn ends at **60 seconds**; **$5** per person per month to start —
and all of it changeable by an admin, limits per person especially. With no
revenue every conversation is pure cost and the right numbers will be learned
from use, so a constant that needs a deploy to change is the wrong shape. Sunrise
has per-agent, global and per-turn caps and no per-user concept, so the store is
ours.

**Change them at `/admin/app/agent`** (Lelañea → Deadlines & budgets).

| Setting                         | Stored in                             | Enforced by                                      |
| ------------------------------- | ------------------------------------- | ------------------------------------------------ |
| First-words deadline (8,000 ms) | `app_agent_settings`                  | §08 t-55 — the app says it is taking longer      |
| Whole-turn deadline (60,000 ms) | `app_agent_settings`                  | §08 t-55 — the turn ends plainly, retryable      |
| Default monthly limit ($5)      | `app_agent_settings`                  | f-safety acts on it; f-budget shows it           |
| One person's own limit          | `app_user_budget`, one row per person | the same, through `getEffectiveMonthlyCeiling()` |

**Nothing enforces any of these yet.** Until t-55, f-safety and f-budget land,
what proves the write is the admin page reading it back and
`tests/unit/lib/app/agent/settings.test.ts` (`HB9`). The page says so.

### How a reader gets them

`lib/app/agent/settings.ts`:

- `getAgentDeadlines()` — `{ firstWordsDeadlineMs, turnDeadlineMs }`.
- `getEffectiveMonthlyCeiling(userId)` — `{ ceilingUsd, source }`, where `source`
  is `override` or `default`.

Both read the database **on every call** (`B9`). Do not cache the result at
module scope or across requests: a value captured once makes an admin's change
take effect at the next deploy — the shape the ruling rejected — and on a
serverless host in some instances and not others.

### Who writes what (`fp4`)

- **The settings row is created once, by its migration** (an `INSERT` of the
  ruled values), and never written by a seed or a boot. The admin page is its only
  writer from then on. `DEFAULT_AGENT_SETTINGS` in `settings.ts` holds the same
  numbers only so the resolvers can answer — with a warning — if the row has been
  deleted by hand; saving the page puts it back. A test holds the migration and
  the constants equal. **Editing the constants changes nothing in a database that
  already has the row**, which is every database.
- **A person's own limit exists only while an admin wants one.** No row means the
  default applies. **Clearing deletes the row — it is never set to zero**, because
  zero is a real answer ("may spend nothing"). The `DELETE` is idempotent.
- The API refuses a non-positive deadline, a first-words deadline that is not
  shorter than the turn's, and a negative limit. Settings are written as a full
  replacement of all three values, which is what lets the pair rule be checked at
  the boundary. Deadlines are capped at 10 minutes and limits at $10,000 — bounds
  on a typo, not policy.

### Privacy

A person's own limit is about them: `ON DELETE CASCADE` on a hand-written FK to
`user` (pinned by a drift probe in `lib/app/leaf-db-drift.ts`), and exported to
them as the `budget` section. The settings row holds nothing about anyone and is
an exclusion with a reason they can read. **Who changed a value is in the admin
audit log** (`app_agent_settings.update`, `app_user_budget.set`,
`app_user_budget.clear`), deliberately not on the rows — that is what keeps the
exclusion's reason true for an administrator too.

### API

| Route                                                | Does                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `GET/PUT /api/v1/admin/app/agent/settings`           | read / replace the three values                    |
| `GET /api/v1/admin/app/agent/budgets`                | every account with its effective limit — one query |
| `PUT/DELETE /api/v1/admin/app/agent/budgets/:userId` | set / clear one person's limit                     |

All admin-only. The list's `?q=` is usually an email address, so every route on
this surface logs without the request URL (`_shared/route-logger.ts`, the same
fix as the waitlist's; the platform gap is `sunrise#685`).

## After a deploy

The pin, the matrix row and the seats are rows. They exist only where the seed
has run: `npm run db:seed` against each database. The deadlines and the default
limit are not seeded — their migration writes them, so `npm run db:migrate:deploy`
is what puts them there.

## Tests

| File                                                       | Pins                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/prisma/seeds/app-lelanea/agent-models.test.ts` | She is pinned to a dated pair and the control follows her — including onto a model an admin chose, even mid-run; a re-run writes nothing; the task defaults are never touched; a fresh install is pinned with a warning and a running install without the provider is refused; a missing or soft-deleted agent throws before anything is written |
| `tests/unit/prisma/seeds/app-lelanea/agent-seats.test.ts`  | Both seats filled; a seat another agent holds is left alone; no seat outside the two is touched                                                                                                                                                                                                                                                  |
| `tests/unit/lib/app/agent/pinned-model.test.ts`            | From a cold registry: the dated id costs $0, the leaf seam prices it exactly, a null-cost matrix row leaves that alone and a blended one would not; a hydrate never budgets more history than the model takes; no eligibility rule is registered                                                                                                 |
| `tests/unit/lib/app/agent/settings.test.ts`                | A fresh store answers 8,000 ms / 60,000 ms / $5 and the migration writes exactly the code's values; a change to the store changes the next read; an override beats the default, zero is an override, a cleared one falls back by deleting the row; the admin list enriches from one overrides query                                              |
| `tests/unit/lib/validations/app-agent-settings.test.ts`    | The three refusals: a non-positive deadline, first words not shorter than the turn, a negative limit                                                                                                                                                                                                                                             |
| `tests/unit/lib/app/voice/comparison.test.ts`              | The two arms still compose different prompts, and a model mismatch between them is refused                                                                                                                                                                                                                                                       |
