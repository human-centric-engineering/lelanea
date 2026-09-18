---
name: app-agent
description: The one agent — which model she is pinned to and why, where an admin changes it, why there is no fallback, the two seats she holds, and what is known to be missing until the turn seam lands.
---

# The agent: what she runs on, and where she sits

There is one agent a person talks to — `lelanea-guide`, created by f-voice with
her fingerprint profile (see [`voice.md`](./voice.md)). This doc is about the
part of her that is not her voice: the model behind it, the seats she is bound
to, and what happens around a turn.

It grows with §08. What is here now is the pin and the seats.

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

**Why both agents.** The golden set compares her voice with a bare model. Pin her
alone and the control keeps floating, and from then on the comparison measures
two models rather than the fingerprint — with nothing on the screen saying so.
`assertArmsComparable()` refuses to queue in that state; pinning both is what
keeps it from arising.

### This is the dev pin — change it in the admin, not in the code

Production's model is chosen later, by evaluation (§8.2: nothing is promoted
without the golden set being re-run and listened to). So the pin is
**operator-owned**:

- The seed writes provider and model only where **both are still blank**. A value
  somebody set is never written over — including a half-set one.
- To change her model: `/admin/orchestration/agents` → `lelanea-guide` → Model.
  **Change `voice-control-bare` to the same pair**, or the next golden-set run is
  refused with a message naming the mismatch.
- Editing the constants in `pins.ts` changes what a **fresh** install gets. It
  does nothing to an install that already has a pin, and re-running the seed will
  not "fix" that — it is the rule working.

The pin is an entry in each agent's version timeline (`Pinned model and provider
(seeded — §08)`), written through the platform's own snapshot helpers, above a
recorded `Initial configuration`. A seed that wrote the column directly would
have left a timeline with no entry for the change, and "restore to v1" as a
one-click way back to the floating default.

### The matrix row

The platform's provider-model matrix carries the alias only, so the seed adds
`openai-gpt-4o-mini-2024-07-18`. Without it the dated id is missing from the agent
form's Model dropdown — an admin opening her agent could not re-select the value
she is already on.

It follows the platform's own protocol: `isDefault: true` means seed-managed and
reconciled; edit the row in the admin and `isDefault` flips off and the seed
leaves it alone from then on. A row an admin already added for that model under
their own slug is theirs, and is left alone too.

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

## The side roles

Not everything that calls a model speaks as her. The seed fills two of the
platform's default task models, **per key and only when blank**:

| Task key  | What resolves through it                                         | Filled with   |
| --------- | ---------------------------------------------------------------- | ------------- |
| `routing` | the conversation summariser                                      | `gpt-4o-mini` |
| `chat`    | slot extraction, the facilitation supervisor, keyword enrichment | `gpt-4o-mini` |

Change them at `/admin/orchestration/settings`.

**The alias here, deliberately**, where her own pin is dated. The settings form
validates every chat-task default against the in-memory model registry, whose
static map knows the alias and not the snapshot; a dated id stored here would
make the next save of that form fail on a field the admin never touched. These
roles extract and summarise — a repointed alias changes their cost before it
changes anything a person hears.

## The seats

`prisma/seeds/app-lelanea/006-agent-seats.ts` binds her to two of Daybreak's six
facilitation seats: **`onboarding`** (first contact) and **`facilitator`**.
Daybreak ships the seats and the binding mechanism and leaves filling them to the
leaf; until this ran, its role route answered 404 for every role.

- It fills **empty seats only**. A seat holds one agent, and reassigning it is an
  unbind plus a rebind — so a seat another agent holds is an operator's decision,
  and is reported and left alone.
- It never reads or writes the other four seats, and has no removal pass.

**She is still `internal`, with no capabilities, so the role route still answers 404.** That is deliberate. Widening her also opens Sunrise's general consumer chat
route, which carries no turn id, no seat and no record of what produced a turn.
Both land with the turn seam (§08 t-54), not before it.

## How her model is priced

**A dated pin would otherwise cost every one of her turns at $0.** Sunrise's cost
tracker prices from an in-memory model registry. Its static map holds the alias
`gpt-4o-mini` and not the dated snapshot; the snapshot reaches the registry only
from an OpenRouter refresh or a hydrate from the matrix, and **nothing on the
chat path or in the evaluation worker calls either** — only the admin cost and
model pages and the estimators do, each in its own module graph (Next bundles
the registry per route, so warming one copy warms no other).

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
- **Where it is registered** is `lib/app/llm-providers.ts`. That seam exists for
  provider-eligibility rules and we register none. It is used for its **timing**:
  it is the one leaf hook Sunrise runs lazily, in whichever module graph is about
  to resolve a provider, before that call's cost is logged. Registering a model is
  synchronous, idempotent and restricts nothing, so Sunrise's own test that this
  seam ships with no eligibility rule still passes against the filled file.
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

The seam fill goes when Sunrise prices an id outside its static map on the chat
and evaluation-worker paths.

## After a deploy

The pin, the matrix row, the task defaults and the seats are rows. They exist
only where the seed has run: `npm run db:seed` against each database.

## Tests

| File                                                       | Pins                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/prisma/seeds/app-lelanea/agent-models.test.ts` | Both arms pinned to one dated pair; a re-run writes nothing; admin-edited models and task defaults survive; a missing agent throws before anything is written                         |
| `tests/unit/prisma/seeds/app-lelanea/agent-seats.test.ts`  | Both seats filled, framework rows first; a seat another agent holds is left alone; no seat outside the two is touched                                                                 |
| `tests/unit/lib/app/agent/pinned-model.test.ts`            | From a cold registry: the dated id costs $0, the leaf seam prices it exactly, a null-cost matrix row leaves that alone and a blended one would not; no eligibility rule is registered |
| `tests/unit/lib/app/voice/comparison.test.ts`              | The two arms still compose different prompts, and a model mismatch between them is refused                                                                                            |
