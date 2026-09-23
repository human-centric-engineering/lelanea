---
name: app-agent
description: The one agent — which model she is pinned to and why, where an admin changes it, why there is no fallback, the two seats she holds, how she is reached, what every turn records (turn id, seat, fingerprint version, cost) and what a repeated turn gets, how a turn ends when she can't answer (the endings vocabulary, the deadlines, a dropped connection, the pause switch, the status read), and the monthly spending limits.
---

# The agent: what she runs on, and where she sits

There is one agent a person talks to — `lelanea-guide`, created by f-voice with
her fingerprint profile (see [`voice.md`](./voice.md)). This doc is about the
part of her that is not her voice: the model behind it, the seats she is bound
to, and what happens around a turn.

It grows with §08. What is here now is the pin, the seats, how she is reached,
what a turn records, what happens when she can't answer, and the deadlines and
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
readable stays readable — see [When she can't answer](#when-she-cant-answer).

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

Until §08 t-54 she was `internal` with no capabilities, so the role route answered
404 on both seats. See [How she is reached](#how-she-is-reached).

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
the registration cannot help: it is for one named model. Pricing an arbitrary id
on the chat path is the platform's gap, reported upstream. What §08 t-54 does is
make the miss **visible**: the turn record says `unpriced` with no cost, and the
log says so at `warn` — see [A turn costed at nothing](#a-turn-costed-at-nothing).
So **changing her model still means checking the new id is in the static map, or
adding its rate beside the pin** — but a turn that slips through is no longer
recorded as free.

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
takes an admin page sharing the module instance. The turn hook cannot close
that gap from its side — it is registered from the boot graph, and warming a
registry there warms the boot graph's copy, not the route's — so it does the
other half: if a member's turn ever is costed at $0 this way, the turn record
says `unpriced` rather than free (§08 t-54, below).

The seam fill goes when Sunrise prices an id outside its static map on the chat
and evaluation-worker paths — reported as
[`sunrise#813`](https://github.com/human-centric-engineering/sunrise/issues/813),
which also carries the blended-rate and history-budget overrides described above.

## How she is reached

`prisma/seeds/app-lelanea/007-agent-reachable.ts` (§08 t-54) makes her `public` —
Daybreak's facilitation surface refuses any agent that is not — and grants her
`search_knowledge_base`. The tool arrived with the instruction to use it
(`VOICE_AGENT_SYSTEM_INSTRUCTIONS`): an instruction to look with no tool produces
a confident claim to have looked. Her `restricted` knowledge access still applies,
so the tool sees only what t-25's designation rule lets her quote.

- **Visibility is operator-owned.** The seed widens her only while she is still
  `internal` and her timeline has no `Made reachable by members (seeded — §08)`
  entry. Narrow her in the admin and a re-run leaves it; her seats answer 404
  until she is public again.
- **The grant is filled once.** A binding that exists — switched off included —
  is an operator's and is left alone. Grants are not in the agent snapshot, so
  restoring an earlier version does not take the tool away.

The members' way in is `POST /api/v1/framework/facilitation/{onboarding|facilitator}/chat/stream`,
body `{ message, turnId? }`.

### The four tools the guide holds

Three seeds, because they grant different things. 007 grants a slug and nothing
else; 013's two bindings each carry an exposure allowlist, and that config has
to be written **with** the binding — a grant created first and configured second
is permissive in between; 014 creates the capability's own row as well as the
grant, because `suggest_resource` is the app's tool rather than Daybreak's or
Sunrise's, and a row with no grant is a tool nobody holds.

| Tool                    | Seed | Does                                                                              |
| ----------------------- | ---- | --------------------------------------------------------------------------------- |
| `search_knowledge_base` | 007  | looks in her material, each result labelled by whose it is                        |
| `get_state`             | 013  | reads back what is already understood about this person                           |
| `fill_slot`             | 013  | writes what the agent has newly learned, once per turn                            |
| `suggest_resource`      | 014  | hands the person one of Lelañea Fulton's films or pieces of writing, by id (t-77) |

**014 reaches a fresh database; a migration reaches every existing one.** The
seeder is opt-in in production (`docker-compose.prod.yml`, `profiles: ['seed']`)
while the migrator runs before every `web` start, so the row and the grant also
ship as `prisma/migrations/20260927100000_app_suggest_resource_capability`
(t-93), which inserts each only where it is absent. Migrations run before the
seed, including on `db:reset`, so the migration now writes the capability row
first even on a fresh database and 014 finds it already there. What 014 still
owns is the `update` branch — re-applying the code-owned fields whenever the
definition changes, which a new migration then has to carry to the databases
already holding the old one — and the grant on a fresh database, where the guide
does not exist yet when migrations run. **Its `create:` branch is no longer
what writes the row on a fresh database**, so the five operator-owned literals
in it (`name`, `description`, `category`, `rateLimit`, `isActive`) have to
change in the migration too; a test pins them equal. Do not delete the branch:
an admin who deletes the capability row leaves it absent for good, and `create`
is then the only thing that can put it back
([`database-changes.md`](./database-changes.md)).

`suggest_resource` is read-only — an id in, the library's record out
(`lib/app/resources/suggest.ts`) — and sits on `READ_ONLY_CAPABILITY_SLUGS`.
The model never supplies a title: it names an id it was shown in its context
block (`lib/app/resources/offering.ts`, spliced into the voice block beside the
slot vocabulary, for the same reason — a tool nobody is told about is never
used), the id is looked up server-side, and an unknown one is refused with a
structured error rather than thrown. Everything the person then sees — the chip
beside the reply, the account line, the drawer pinned to it — is the file's
words. The offering block is empty until Lelañea Fulton's list lands (t-76),
and then nothing is offered, which is the truth.

**Not on the control agent.** `voice-control-bare` holds no tools and gets no
context block (the comparison sends none), so the offer cannot reach it.

`fill_slot` is the **one** tool she holds that writes, and the ceiling it is
admitted under is in [`safety.md`](./safety.md) — "nothing she holds may delete
anything, or act on anyone else's behalf". What she may read back, what bounds
what she writes, and why a retried turn cannot record one thing twice are in
[`slots.md`](./slots.md), "Capture".

Both slot tools arrived with the instruction that tells her when to use them,
for the reason the search tool did: a tool with no instruction is one she may
never reach for, and an instruction with no tool produces a confident claim to
have done it.

### Where else she can be reached

**Not through Sunrise's consumer chat routes.** `public` would also open Sunrise's general consumer
chat route (`POST /api/v1/chat/stream`, by slug) and list her in `GET
/api/v1/chat/agents`. A turn there would skip the turn hook: no crisis check, no
ceiling, no turn id, no record. The authorization seam cannot refuse it, because
that route names no resource. So f-safety t-61 carries a generic seam in both
routes (`lib/orchestration/chat/consumer-exclusions.ts`, divergences Row 21), and
`lib/app/leaf-bootstrap.ts` registers her slug. The stream route answers her slug
exactly as it answers an agent that does not exist, and the listing omits her.
Admin chat and embed don't consult the seam.

**One more door, closed only by configuration.** Daybreak's module chat route
(`POST /api/v1/framework/modules/{slug}/chat/stream`) streams a module's primary
agent directly, also without the turn hook, and it doesn't consult this seam
either. She is bound to no module today. **Don't make her a module's primary
agent**: that would open the door again. The route's missing turn hook is the
twin daybreak#265 already names.

## What a turn records

Every turn on a facilitation seat goes through the turn hook — Daybreak's route
hands it to `runFacilitationTurn()`, and `lib/app/leaf-bootstrap.ts` registers
`runRecordedTurn()` (`lib/app/agent/turns.ts`) into it at boot. The seam is ours,
carried in Daybreak's route: [`divergences.md`](./divergences.md) Row 18,
[`daybreak#265`](https://github.com/human-centric-engineering/daybreak/issues/265).

**The record is `app_turn`, one row per turn id per person** — the answer to
"which model and which prompt produced this turn, and what did it cost":

| Column                                   | Says                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `turnId`, `clientSupplied`               | the client's id, or one minted here (`srv_…`) when it sent none              |
| `seat`, `agentSlug`                      | where the turn was taken, and who answered                                   |
| `fingerprintVersion`                     | her voice version, read from her **composed** prompt at claim — null if none |
| `modelId`, `providerSlug`                | what the platform reported on `done`                                         |
| `inputTokens`, `outputTokens`, `costUsd` | the chat call; `costUsd` is null when `pricing` is `unpriced`                |
| `pricing`                                | `priced`, `unpriced` or `local`                                              |
| `userMessageId`, `assistantMessageId`    | the two `ai_message` rows — ids, never the words                             |
| `status`, `attempts`, `errorCode`        | `running` / `completed` / `failed`; a re-run bumps `attempts`                |

Also tagged: **the person's message** carries `{ turnId, seat, fingerprintVersion }`
under `metadata.app`. The platform puts `messageMetadata` on the user row only;
her reply has the model and provider as columns, and the turn row joins the two.

### Which cost rows carry the turn (hypothesis b, checked at the call sites)

`costLogMetadata` is `{ turnId, seat }`. Read in
`lib/orchestration/chat/streaming-handler.ts`,
`lib/orchestration/chat/summarizer.ts`,
`lib/orchestration/capabilities/dispatcher.ts` and
`lib/orchestration/capabilities/built-in/search-knowledge.ts`:

| Cost row                                          | Tagged                                                                                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the chat call, every tool-loop iteration          | yes                                                                                                                                                                                                   |
| the rolling summary                               | yes                                                                                                                                                                                                   |
| a tool dispatch (`search_knowledge_base` and any) | yes — the dispatcher merges it under its own `slug`/`success`                                                                                                                                         |
| the embedding of a knowledge search query         | yes — `search-knowledge.ts` merges it under `kind: 'knowledge_search'`                                                                                                                                |
| an attachment (`vision`)                          | yes (the facilitation route sends none today)                                                                                                                                                         |
| **the embedding of her reply**                    | **no.** `queueMessageEmbedding()` takes only agent / conversation / user. Its row carries `metadata.messageId`, which is the turn's `assistantMessageId` — so it is joinable to the turn, not tagged. |

So "every cost row carries the turn id" is **not** true, and nothing should be
built as though it were: sum a turn's cost by `turnId` **plus** the reply-embedding
row whose `messageId` is the turn's `assistantMessageId`.

### What a second request with the same id gets

| The id's turn is…        | The request…                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| new                      | runs                                                                                                                                      |
| completed                | gets the recorded reply — every pass of it, and its citations — as `start` / `content` / `citations` / `done`; no model call, no cost row |
| still running            | `409`, `details.reason: TURN_IN_FLIGHT` — never raced                                                                                     |
| failed, or abandoned     | runs again under the same id                                                                                                              |
| used for different words | `409`, `details.reason: TURN_ID_REUSED`                                                                                                   |

- **Scoped to the person.** `@@unique([userId, turnId])` is the claim; the same id
  from someone else is a new turn and says nothing about theirs.
- **No `turnId` behaves as before**: a minted id is never sent again, so every
  request runs — but it is still recorded and tagged.
- **Abandoned** means `running` for longer than `staleClaimMs()` — the admin's
  whole-turn deadline plus a minute's grace (`STALE_CLAIM_GRACE_MS`), read per
  request. The deadline itself settles a turn that runs too long, so only a
  crashed process, or a database down for both tries of a settle, leaves one
  `running`. A settling write that fails is tried once more. A settle names its
  attempt, so an attempt that outlived its claim writes nothing over the one
  that replaced it. **Known limit:** the window is the deadline in force when the
  _retry_ asks, not the one the running turn started under — an admin who cuts
  the deadline sharply mid-turn can let a retry take over a turn that is still
  running (two model calls for one id). Storing each turn's deadline would close
  it; not done, for a rare operator action.
- **A turn that finishes with no reply to link** is settled `failed`
  (`reply_not_linked`), not `completed` — the id can run again rather than
  answering every retry with an error.
- **A connection lost mid-turn is replayed, not re-run** (owner ruling, 18 Sept
  2026; §08 t-55). The turn finishes server-side and is recorded `completed`, so
  the retry gets the whole answer as a replay — one model call, one cost row, one
  message from the person. See [A dropped connection](#a-dropped-connection).
- **A replay whose reply was deleted** ends rather than inventing one — recorded
  as `turn_reply_unavailable`, sent as the plain `unavailable` ending.
- **A retried failed turn leaves the person's message in the transcript twice.**
  The platform writes it before calling the model, on every call, and offers no
  way to reuse the first. Recorded on f-conversation. The transcript read
  collapses the two to one (§10 t-64, [`conversation.md`](./conversation.md)).

- **While generation is paused**, a replay is still served — it calls no model.
  Anything that would run the model gets the `paused` ending instead.

### A turn costed at nothing

A turn that used tokens and came back at $0 — its model had no rate in the
registry that priced it, or its provider reported no usage — is recorded as `pricing: unpriced` with **`costUsd`
null**, never `0`, and logged at `warn` (`Agent turn was costed at nothing`). On a
provider configured as local it is `local`, cost as reported: really free, and not
the same fact.

It is judged from the turn's own `done` event, **not by asking the registry**:
the hook runs in the boot graph, whose registry is a different copy from the one
that priced the turn, and would answer for the wrong copy. The platform's own
cost row for an unpriced turn still says $0; the turn record is what knows better.

### Sessions

There are none, deliberately. Daybreak has no session concept and a facilitation
conversation resumes forever, so turns are metered one by one with timestamps
(`startedAt`, `completedAt`). A "sitting" is derivable later by whoever needs one
(f-recap, f-journey-record) without a retrofit.

### Privacy

A turn record is about the person: `ON DELETE CASCADE` on a hand-written FK to
`user` (drift probe in `lib/app/leaf-db-drift.ts`), and exported to them as the
`turns` section. The message ids are deliberately not foreign keys: deleting a
conversation keeps the metering and loses the words, and a replay says so.

## Reading the meter

§08 t-56; product description §3.20, §7.2, §11. Before this, everything a turn
wrote could be read only from a database console — indistinguishable, for a
meter, from not metering (`HB9`). `lib/app/agent/metering.ts` is the read side
that f-budget's usage view, f-conversation's per-turn drawer and the admin cost
view share. **It enforces nothing**; ceilings are f-safety's.

### The cost log is the only source of dollars

Every dollar and token is summed from Sunrise's `ai_cost_log`, **read in place**.
Nothing is copied into an `app_` table: a second table of dollars is a second
answer, and it drifts from the first. `app_turn` is read only for what the cost
log does not know — model, provider, fingerprint version, seat, status — never for
its own `costUsd`, which is the chat call alone.

Three rules every aggregate keeps:

- **Totals reconcile to the cost rows.** A breakdown's `totals` are computed
  apart from its groups, so they stay whole when `truncated` is true.
- **A row with no user is platform cost** — knowledge ingestion, scheduled and
  triggered work, and the rows of an **erased** account (the FK is `SET NULL`, so
  after erasure its spend is indistinguishable from platform spend). Counted in
  every admin total, reported as `platformCostUsd` and as the `null` group of a
  by-user breakdown. Never dropped, never attributed. A member's own read does not
  include it.
- **Seat is the row's tag, else its conversation's.** Rows written before t-54
  carry no `seat`; for those, a conversation with `contextType = 'facilitation'`
  gives its `contextId`. The untagged reply embedding is seated the same way.
  Neither: the `null` group — unseated.

**$0 is not "free".** A row that used tokens and cost $0 on a provider not
configured as local was priced by a registry with no rate for its model (see
[A turn costed at nothing](#a-turn-costed-at-nothing)). Every read counts these as
`unpricedRows`; a total containing any is a floor.

### What a breakdown is

`{ by, window, totals, groups, truncated }`, over a half-open UTC window
`[from, to)` — this month so far when omitted, at most 366 days. Each group is
`{ key, costUsd, inputTokens, outputTokens, costRows, unpricedRows }`; `key` is a
user id, conversation id, seat, model id or `YYYY-MM-DD` (UTC). Groups are
largest spend first, capped by `limit` (default 100, max 500) — by day, the
newest `limit` days, returned oldest first. By user, each group also carries `user: { name, email }`, read in one query.

### One turn's record

`getTurnMeter(userId, turnId)`: the turn row's model, provider, fingerprint
version, seat, status, attempts and pricing, and **every cost row it caused** —
the rows tagged with its id plus the embedding of her reply (joined by
`assistantMessageId`, see [which cost rows carry the
turn](#which-cost-rows-carry-the-turn-hypothesis-b-checked-at-the-call-sites)).
Each row says its `part`: `reply` · `summary` · `tool` · `knowledge_search` ·
`reply_embedding` · `attachment` · `other`. `replyCostUsd` is the `reply` rows,
`sideCostUsd` the rest. **A re-run's rows are included** — a failed first attempt
was spent too. Rows are scoped to the person: turn ids are unique per person, not
globally.

### API — what f-budget and f-conversation build on

| Route                                                        | Who    | Returns                                                               |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------- |
| `GET /api/v1/app/usage`                                      | member | own month to date: totals, `ceiling`, `remainingUsd`, `fractionUsed`  |
| `GET /api/v1/app/usage/breakdown?by=&from=&to=&limit=`       | member | own breakdown by `conversation` · `seat` · `model` · `day`            |
| `GET /api/v1/app/usage/turns/:turnId`                        | member | own turn's record; 404 for any id they did not take                   |
| `GET /api/v1/admin/app/metering?by=&userId=&from=&to=`       | admin  | anyone's or everyone's breakdown, adding `by=user`; `platformCostUsd` |
| `GET /api/v1/admin/app/metering/users/:userId`               | admin  | that person's month to date; 404 for nobody                           |
| `GET /api/v1/admin/app/metering/users/:userId/turns/:turnId` | admin  | that person's turn's record                                           |

Member routes key every read on the session's id — `ownership: 'self'`, not
`'policy'`, because the policy widens to everyone for an admin. An admin reads
others through the admin routes. All `no-store`. A member route never logs the
turn id, which a client may choose. `fractionUsed` is `null` on a $0 ceiling, and
above 1 when over it.

The conversation join is an **ownerless-surface exception, by design**
(`lib/app/leaf-ci.ts`): it reads only `contextType` / `contextId` of a conversation
a cost row already points at, and which rows are read is decided on the cost log.

### Watch item: no `(userId, createdAt)` index

The month-to-date read filters `ai_cost_log` by person and time. Sunrise indexes
`userId` alone, and an index we added to a Sunrise table would be dropped by the
next generated migration (`B13`). Fine at current volume. **Trigger to revisit:
the month-to-date query appearing in slow-query logs** — then it is an upstream
request to Sunrise, not a leaf migration.

## When she can't answer

§08 t-55; product description §8.1. A person may be mid-sentence about their
marriage when the provider rate-limits. Before this, the turn waited on a
120-second library default and then surfaced whichever error code won. Now it
ends within the admin's deadline, in plain words, and everything readable keeps
working. **There is no fallback model** (see [Why there is no
fallback](#why-there-is-no-fallback)): nothing is silently swapped, so there is
nothing to disclose.

### The endings — what f-conversation builds against

Every frame from her seat reaches the browser through `toClientStream()`
(`lib/app/agent/endings.ts`). A turn that ends without her answer ends on **one
`error` frame whose `code` is one of four**:

| `code`        | Means                                                                           | Default copy says                                                    |
| ------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `unavailable` | she could not answer — every platform code but the three below                  | your message is kept; try again; the rest of the app works           |
| `timed_out`   | the whole-turn deadline passed (or the provider timed out)                      | it was stopped; your message is kept; try again                      |
| `paused`      | an operator paused conversations on purpose                                     | paused on purpose; everything you can read still works               |
| `not_sent`    | the message itself was refused — the input guard's block, or a conversation cap | it couldn't be sent; sending it again won't help; put it another way |

- **Unknown codes map to `unavailable`, never through.** The platform's code and
  its text — written for an operator, and on some paths carrying a slug, a model
  or an env var name — never reach the browser. The turn record keeps the
  platform's code in `errorCode`, for diagnosis.
- **The per-turn cost cap's own frame** (`budget_exceeded_per_turn`, which
  carries spend figures) is replaced by `unavailable` as well.
- **The agent's monthly `budget_warning`** (a dollar figure) is dropped: an
  operator's number, not a member's. Other warnings pass through.
- **"Try again" is real** (`HB10`): the client resends with the **same turn id**.
  A failed or timed-out turn runs again under it; one that completed is replayed.
- **Still thinking** is not an ending: `{ type: 'warning', code: 'still_thinking' }`,
  sent once when no words have come by the first-words deadline. The turn goes on.
- **`not_sent` is the one a retry cannot cure** (§10 t-65; owner ruling, 19
  Sept 2026). Mapped by name from `input_blocked`, `conversation_cap_reached`
  and `conversation_length_cap_reached` — the three places the platform refuses
  the message rather than fails to answer it. The caps refuse before the person's
  row is written; the guard's block comes after it, so that message is in the
  transcript on reload. `output_blocked` is not here: that is her reply refused,
  and a re-run can answer differently. The status read skips all of them.
- **The copy is neutral on purpose.** The words in her register, and the banner,
  are f-conversation's — see [`conversation.md`](./conversation.md#when-she-cant-answer-in-the-pane).
- **One more code, `crisis`, is not an ending of this kind.** It is built by the
  crisis path ahead of everything above — before the pause, the claim and the
  model — and carries the resource a person in danger is shown: as an `error`
  when the turn ends there, as a `warning` when her turn follows. It depends on
  none of this. See [`safety.md`](./safety.md).
- **And `ceiling_reached` ends a turn but is not mapped either** (f-safety t-59).
  The turn seam builds it when the person has used their month's budget — see
  [The monthly limit](#the-monthly-limit) — and it carries figures the three do
  not: `ceiling: { spentUsd, ceilingUsd, resetsAt }` (`resetsAt` an ISO instant,
  UTC). A platform frame that said `ceiling_reached` would still map to
  `unavailable`.

### The deadlines

Read per request from `app_agent_settings` (`getAgentDeadlines()`), so a change at
`/admin/app/agent` applies to the next turn (`lib/app/agent/deadlines.ts`):

- **First words** (8 s): no `content` yet → one `still_thinking` warning. Not an
  abort — a slow answer is still her answer.
- **Whole turn** (60 s): the model call is aborted through the seam's own signal,
  the turn is settled `failed` with `errorCode: timed_out` **before** the reader is
  told, and the reader gets `timed_out` at once. A retry sent the moment it arrives
  is therefore a re-run, not a 409.
- **Once the platform reports an outcome the deadline stands down.** A `done` (or
  a failure) disarms it before the outcome is written, so a deadline passing
  mid-write cannot say `timed_out` after a whole answer, nor leave a saved reply
  on a failed turn that the retry would bill again.

**What a timed-out turn leaves in the transcript** (hypothesis a, checked in
`streaming-handler.ts`): the person's message, and the platform's error-marker
assistant row — `[An error occurred and the response could not be completed.]`,
`metadata: { error: true, errorCode: 'aborted' }`. Any words streamed before the
deadline are **not** persisted; the marker is the only assistant row. The abort is
classified as a client abort — the signal is aborted — so **no circuit-breaker
failure is recorded**. A re-run under the same id writes the person's message a
second time (the t-54 known limit, recorded on f-conversation), and a marker row
that lands after the re-run's own message is possible if the aborted call is slow
to unwind. The transcript read hides `metadata.error` rows (§10 t-64,
[`conversation.md`](./conversation.md)).

### A dropped connection

Owner ruling, 18 Sept 2026: a dropped connection does not stop her answer.

- The seam passes **its own** abort signal to `streamChat`, replacing the
  request's (`extras.signal` — a change to the turn seam, divergences Row 18). Only
  the whole-turn deadline fires it.
- The upstream is **pumped from the moment the turn starts**, independent of its
  reader; the reader takes frames from a buffer. A reader that leaves detaches,
  nothing more is buffered for it, and the pump runs on to `done` (or the
  deadline). The turn is recorded `completed`, so the retry is a replay.
- **The run is handed to the host** through `turn.keepAlive` — the route passes
  Next's `after()` (hypothesis c). On Vercel a function may be frozen once its
  response ends; `after()` keeps it alive until the turn settles, within the
  route's max duration (the 60 s deadline is well inside it). `after` cannot be
  imported under `lib/app/**`, which is why the route offers it rather than the
  hook calling it. A host that refuses is logged and costs only that guarantee.
- A request aborted **before** its stream is read no longer needs special
  handling (t-54's `aborted` settle is gone): the turn is already running.

### The pause switch

`LELANEA_GENERATION_PAUSED`, a Sunrise feature flag (hypothesis b: it fits —
DB-backed, admin-toggleable, no store of our own). **Flip it at `/admin/features`**.
On, every turn on her seats gets the `paused` ending **before anything is claimed
or any model is called** — no turn row, no cost row — and the same turn id simply
runs once it is off. Replays are still served.

- Created off by `prisma/seeds/app-lelanea/008-generation-pause-flag.ts`, and
  **never written again**: an operator's pause survives a re-seed.
- **Not the circuit breaker.** The breaker is per-process memory and holds nothing
  between requests on a serverless host. Availability is learned from the switch
  and from turn outcomes, both rows.
- Fails open: a flag read that errors counts as not paused. A database that cannot
  be read fails the turn by itself a moment later, as `unavailable`.

### The monthly limit

f-safety t-59. Before a turn claims anything — after the crisis check and the
pause switch — the seam asks `mayStartGeneratedTurn(userId)`
(`lib/app/agent/ceiling.ts`): is month-to-date spend (`getMonthToDate()`) under
the person's effective limit (their override, else the default)? **At or over
it**, the turn ends on one `ceiling_reached` frame carrying what they spent, the
limit, and the reset date (the first instant of the next UTC month). No turn row,
no model call, no cost row.

- **The crisis path is never behind it.** The crisis check runs first, so a
  person over their limit who writes that they are in danger still gets the
  resource (`tests/unit/lib/app/safety/turn-crisis.test.ts`).
- **A replay is still served.** A completed turn resent under its id calls no
  model and costs nothing, exactly as under the pause.
- **The turn that crosses the line completes — so a person can overshoot by one
  turn's cost.** The check runs before the turn, never during it: that is the
  price of never cutting a reply off mid-sentence, and it is accepted. `spentUsd`
  may therefore be above `ceilingUsd`. **Strictly, one turn's cost per turn in
  flight**: cost is recorded when a model call ends and nothing is reserved at
  the check, so turns started together (two tabs, a client that does not wait)
  each pass it. Trigger to revisit: a month-to-date well past a ceiling in the
  admin cost view — then count the person's running turns before allowing
  another (found by /code-review).
- **A limit of $0 means nothing may be spent** — every turn ends on the ceiling.
- **Fails open**, like the pause: a meter read that errors lets the turn run and
  logs a warning. A database that cannot be read fails the turn by itself.
- **The default copy says why and what is left**: everything readable and
  writable still works, and replies return on the reset date (`HB10`). It offers
  no "ask for more" — there is no mechanism behind one (`B31`). The pane renders
  it in her register from the figures (`ceilingEnding` in
  `lib/app/conversation/copy.ts`, f-budget t-96; see
  [`conversation.md`](./conversation.md)), so these neutral words are only the
  fallback. One difference is deliberate: on a **$0 limit** the neutral copy
  still names the reset date, and her words do not, because the limit will
  still be nothing after it.
- **One interface, so billing can replace it.** "May this person start a
  generated turn; if not, why" is all the seam knows; `TurnAllowance` has room
  for another reason.
- **Only her seats.** Sunrise's consumer chat route (`POST /api/v1/chat/stream`)
  does not pass through this seam, so she is kept off that route instead. See
  [Where else she can be reached](#where-else-she-can-be-reached).
- **Cost per turn: one month-to-date aggregate** over `ai_cost_log` by user and
  time, beside the two primary-key reads for the limit. Fine at current volume;
  the same trigger as the [index watch item](#watch-item-no-userid-createdat-index)
  applies — if it shows in slow-query logs, cache the answer per person for the
  length of a turn deadline.

### The status read

`GET /api/v1/app/agent/status` (any member; `no-store`) →
`{ generation: 'available' | 'unavailable' | 'paused' }`
(`lib/app/agent/availability.ts`). What the conversation pane, and later a banner,
ask:

- `paused` — the switch is on.
- `unavailable` — the most recent turn **anyone** finished in the last five minutes
  failed because the model could not answer or ran out of time. A hint: the next
  turn is still tried. Failures about the person's own turn (`input_blocked`, the
  caps, `reply_not_linked`, `budget_exceeded_per_turn`) are skipped. Install-wide
  and anonymous — it never says whose turn it was.
- `available` — otherwise.

Indexed by `app_turn.completedAt` (migration `20260920100000_app_turn_completed_at_idx`).

### Everything readable stays readable

The authored-content routes and the journey map touch no model and no pause:
`tests/unit/lib/app/agent/reading-survives.test.ts` calls them with the provider
layer throwing and with the switch on, and the smoke calls them on a running
server in both states.

## Her voice on a seat

Her overlays and exemplars reach a facilitation turn: `lib/app/context-contributors.ts`
registers her voice block for `facilitation` (the type Daybreak's route pins) as
well as `voice`. The seat picks the moment — `SEAT_SITUATIONS` in
`lib/app/voice/context-contributor.ts`:

| Seat          | Moment           |
| ------------- | ---------------- |
| `onboarding`  | `first-meeting`  |
| `facilitator` | none — core-only |

**Only while the seat is hers.** The type covers all six of Daybreak's seats, so
the contributor checks the seat's binding and gives any other agent an empty
block, never her voice.

The facilitator seat is every moment after the first, and which one is a fact
about the person's journey that no turn carries yet. Guessing would be inventing
a register — the overlays' own rule is not to — so it gets the authored core-only
block until a turn can say which moment it is.

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
| First-words deadline (8,000 ms) | `app_agent_settings`                  | `deadlines.ts` — a `still_thinking` warning      |
| Whole-turn deadline (60,000 ms) | `app_agent_settings`                  | `deadlines.ts` — `timed_out`, failed, retryable  |
| Default monthly limit ($5)      | `app_agent_settings`                  | `ceiling.ts` — `ceiling_reached` before a turn   |
| One person's own limit          | `app_user_budget`, one row per person | the same, through `getEffectiveMonthlyCeiling()` |

**The deadlines are enforced** (§08 t-55, [When she can't answer](#when-she-cant-answer)).
**So are the limits** (f-safety t-59, [The monthly limit](#the-monthly-limit)):
at or over, a turn ends on `ceiling_reached` before it starts. What a person
sees of their spend before then is f-budget's.

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
this surface logs without the request URL (`app/api/v1/admin/app/agent/_shared/route-logger.ts`, the same
fix as the waitlist's; the platform gap is `sunrise#685`).

## After a deploy

The pin, the matrix row, the seats, her visibility, her search grant and the
pause switch are rows.
They exist only where the seed has run: `npm run db:seed` against each database —
until it has, her seats answer 404. The deadlines, the default limit and the turn
table are not seeded — their migrations write them, so `npm run db:migrate:deploy`
is what puts them there.

**The turn hook is registered at boot.** A server that booted before it existed
runs every facilitation turn through the pass-through — unrecorded, and billed
twice on a retry. `npm run smoke:app-turn` says so directly rather than failing
on a symptom.

## Tests

| File                                                                                                                                  | Pins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/prisma/seeds/app-lelanea/agent-models.test.ts`                                                                            | She is pinned to a dated pair and the control follows her — including onto a model an admin chose, even mid-run; a re-run writes nothing; the task defaults are never touched; a fresh install is pinned with a warning and a running install without the provider is refused; a missing or soft-deleted agent throws before anything is written                                                                                                                                         |
| `tests/unit/prisma/seeds/app-lelanea/agent-seats.test.ts`                                                                             | Both seats filled; a seat another agent holds is left alone; no seat outside the two is touched                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/unit/lib/app/agent/pinned-model.test.ts`                                                                                       | From a cold registry: the dated id costs $0, the leaf seam prices it exactly, a null-cost matrix row leaves that alone and a blended one would not; a hydrate never budgets more history than the model takes; no eligibility rule is registered                                                                                                                                                                                                                                         |
| `tests/unit/lib/app/agent/settings.test.ts`                                                                                           | A fresh store answers 8,000 ms / 60,000 ms / $5 and the migration writes exactly the code's values; a change to the store changes the next read; an override beats the default, zero is an override, a cleared one falls back by deleting the row; the admin list enriches from one overrides query                                                                                                                                                                                      |
| `tests/unit/lib/app/agent/turns.test.ts`                                                                                              | Against a stateful fake: a completed turn replays with no model call and no cost row; in flight is refused; failed and abandoned re-run; another person's id neither collides nor leaks; a reused id with other words is refused; no id behaves as before; cost row and message are tagged; an unpriced turn is null-cost beside a priced one, and apart from a local one                                                                                                                |
| `tests/unit/app/api/v1/framework/facilitation/turn-seam.test.ts`                                                                      | The route at rest calls `streamChat` with exactly its old arguments and ignores a `turnId`; wired, it hands a registered hook the turn, merges its extras, and turns a refusal into 409 before any stream                                                                                                                                                                                                                                                                                |
| `tests/unit/lib/app/voice/context-contributor.test.ts`                                                                                | (§08 t-54 cases) the assembled system prompt of an onboarding seat turn carries the first-meeting register and her passages; the facilitator seat gets the core-only block                                                                                                                                                                                                                                                                                                               |
| `tests/unit/prisma/seeds/app-lelanea/agent-reachable.test.ts`                                                                         | Public as a timeline entry, search granted; a re-run writes nothing; an admin's narrowing and a switched-off grant stay; a missing agent or capability throws before writing                                                                                                                                                                                                                                                                                                             |
| `scripts/app/smoke-turn.ts` (`npm run smoke:app-turn`)                                                                                | Against a running server and the dev DB: one turn id sent twice through the real route is one model call, a cost row > 0 on her pinned model tagged with turn id and seat, one turn record, one user message; a connection dropped mid-answer still completes and replays; her model pointed at an unreachable endpoint ends `unavailable` with no provider text, keeps the message, reads stay 200 and the id re-runs; paused refuses with no row and no cost                           |
| `tests/unit/lib/app/agent/turns.test.ts` (§08 t-55 cases)                                                                             | With fake timers: `still_thinking` at the first-words deadline and the turn carries on; `timed_out` at the whole-turn deadline, settled failed before the reader hears, the same id re-runs; changed settings apply to the next turn; a dropped reader still completes and replays; the model runs under the seam's signal; a provider error's slug and env name reach no frame; the pause refuses before any model call, replays still served                                           |
| `tests/unit/lib/app/agent/endings.test.ts`                                                                                            | Every code in the platform's registry (read from its source) maps into the vocabulary; unknown codes map to `unavailable`                                                                                                                                                                                                                                                                                                                                                                |
| `tests/unit/lib/app/agent/ceiling.test.ts`, `turns.test.ts` and `tests/unit/lib/app/safety/turn-crisis.test.ts` (f-safety t-59 cases) | At or over the limit a turn ends on `ceiling_reached` with figures and reset date, with no turn row, no model call and no cost row (fails if the check moves after the claim); under it nothing changes; the crossing turn completes; a per-person override beats the default; a replay is still served; the meter failing lets the turn run; a crisis hit over the limit still gets the resource                                                                                        |
| `tests/unit/lib/app/agent/availability.test.ts`                                                                                       | Paused beats everything; the latest finished turn decides, within the window; a person's own turn trouble is not read as an outage                                                                                                                                                                                                                                                                                                                                                       |
| `tests/unit/lib/app/agent/reading-survives.test.ts`                                                                                   | Content and journey-map routes 200 with the provider layer throwing, and with the switch on                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/unit/lib/validations/app-agent-settings.test.ts`                                                                               | The three refusals: a non-positive deadline, first words not shorter than the turn, a negative limit                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests/unit/lib/app/voice/comparison.test.ts`                                                                                         | The two arms still compose different prompts, and a model mismatch between them is refused                                                                                                                                                                                                                                                                                                                                                                                               |
| `tests/unit/lib/app/agent/metering.test.ts`                                                                                           | Which person's id is bound into every query (a member's twice in each, an admin's `null`); dimension, window and limit are parameters, never SQL text; truncation leaves totals whole; bigint/string/NULL aggregates coerce to numbers; a by-user breakdown names people in one read; month to date against the ceiling, over it, and at $0; a turn's rows found by person and tag or reply embedding, classified, summed, never from the turn row's own `costUsd`                       |
| `tests/unit/app/api/v1/app/usage/authorization.test.ts`                                                                               | With the other person's spend and turn shown first through the admin routes: a member's usage, breakdown (even naming them in the query) and turn read return only their own — another's turn is the same 404 as one that never was; members are refused the admin routes; unauthenticated is 401 everywhere and nothing is read                                                                                                                                                         |
| `tests/unit/app/api/v1/app/usage/routes.test.ts`, `tests/unit/app/api/v1/admin/app/metering/routes.test.ts`                           | Windows default to this month; each refusal (no or unknown dimension, `by=user` for a member, backwards or over-a-year window, too many groups, malformed ids) is a 400 that reads nothing; 404 for a person who does not exist; `no-store`; no turn id in the log                                                                                                                                                                                                                       |
| `scripts/app/smoke-metering.ts` (`npm run smoke:app-metering`)                                                                        | Against the dev DB, no server: on a fixture of tagged, pre-tagging, unpriced, reply-embedding, user-less and another person's rows, every dimension's totals reconcile to the rows and its groups sum to them; user-less rows are exactly `platformCostUsd`; a tag's seat beats the conversation's and untagged rows take the conversation's; a member sees only their own; a turn is its tagged rows plus its reply embedding. Breaking the seat fallback or the person filter fails it |
| `scripts/app/smoke-turn.ts` (§08 t-56 step 3b)                                                                                        | After a real turn, `/api/v1/app/usage/turns/:turnId` shows her pinned model and provider, the recorded fingerprint version and seat, and a non-zero cost equal to its cost rows, reply embedding included; month to date includes it                                                                                                                                                                                                                                                     |
