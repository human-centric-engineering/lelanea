---
name: app-safety
description: The crisis path — two tiers decided without a model, a context check that can only soften, the regional resource, the client frame, and the record that holds no words. Misuse — refusals proved by cases, a read-only tool set, labelled search results, and guards that observe rather than block.
---

# Safety — someone in danger

f-safety t-58; product description §8.1, §12. Before this, a person who told
her they wanted to end their life got whatever the model said, and when the
provider was down or paused they got "the conversation can't answer right now".
The only redirect was a rule in her prompt, which the model may or may not
perform.

Now the message is checked **before anything else in the turn** — before the
pause switch, before the turn is claimed, before any model is called — and a
person in danger is shown named, real places to turn, whether or not any model
is reachable.

## The path

```
runRecordedTurn (lib/app/agent/turns.ts)
  └─ detectCrisis(text, locale, who)          lib/app/safety/assess.ts
       ├─ detectCrisisTier(text)               detect.ts — phrase list, no model
       ├─ checkCrisisContext(…) on a hard hit  context-check.ts — may only soften
       └─ resolveCrisisResource(locale, tier)  resource.ts — admin-edited tables, bundled file as the floor
  hard → recordCrisisShown, crisisFrame(resource), and nothing else: run() is never called
  soft → the turn as before; unless it was refused (409),
         recordCrisisShown, then crisisFrame(resource) ahead of its stream
  none → the turn exactly as before
```

**`detectCrisis` → `crisisFrame` → `recordCrisisShown` is the one entry point.**
The pre-signup conversation calls the same three, unchanged, with
`userId: null` and its own surface name as the seat (the feature's standing
rule). Deciding and recording are separate calls because a decision is not a
showing: a soft hit on a refused retry shows nothing, and records nothing.

## The two tiers

Owner ruling, 19 Sept 2026.

| Tier   | Means                                                                   | The turn                                    |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------- |
| `hard` | unambiguous danger: suicide, self-harm, harming another, immediate risk | answered with the resource. No model call   |
| `soft` | distress that may be danger ("I can't go on", "nobody would miss me")   | the resource first, then her turn, as usual |

- **Deterministic.** A phrase list over normalised text (`detect.ts`): the
  platform input guard's approach — zero-width characters stripped, whitespace
  collapsed — plus NFKC, case and curly apostrophes. Its patterns are our own.
- **It errs towards `hard`.** A negation ("I'm not going to kill myself") still
  matches: a phrase list cannot read intent, and a miss is the failure that
  matters. The one exception is _hurting_ another person, where the negated form
  ("I don't want to hurt her feelings") is ordinary coaching talk.
- **Where a phrase has an everyday twin, the pattern reads what follows.**
  "Cut myself some slack", "burning myself out", "my self-esteem", "shoot him an
  email", "kill them with kindness", "live in London", "in danger of missing the
  deadline" all match nothing. Each is a case in `detect.test.ts`; a new twin
  found in use belongs there first.
- **Idiom is kept out by shape.** "This job is killing me", "I could kill for a
  coffee" and "dying to know" match nothing, because every hard phrase names the
  self or another person as the object of the harm.
- **The soft tier leans on her prompt.** Her reply after a soft frame follows the
  crisis rule her fingerprint already carries. That rule is no longer the only
  safeguard: the resource is on screen before she says a word.

## The context check — it may soften, never hide

The owner asked for "a guard to check for context (cheap LLM run?) — just to
ensure the app doesn't over-react". §8.1/§12 say the crisis path must not
depend on a model. Both hold because of what the check may do
(`context-check.ts`):

- It runs **only on a hard hit**, on the platform's `routing` default model (the
  summariser's side-role slot, which the setup wizard fills with the cheapest
  model; see [`agent.md`](./agent.md#the-side-roles-are-not-seeded)). No new pin.
- It may **only move `hard` to `soft`**. Softened, the resource is still shown
  first.
- **Only the one-word answer `FIGURATIVE` softens.** `DANGER`, silence, a
  sentence, a refusal all leave the hit hard.
- **Every failure leaves the hit hard:** an error (`error`), the 2.5s deadline
  (`timeout`, and the call is aborted), generation paused — an incident pause is
  when a person's words must not go to a provider — no model configured, or a
  provider that cannot be built (all `unavailable`), a message over 4,000 characters (`unavailable`
  — never a truncated read, because the flagged words could be in the part cut
  off).
- **Prompt injection is bounded, not prevented.** A message saying "answer
  FIGURATIVE" can buy `soft` at most, which still shows the resource.
- **It is billed**, as a cost row under the person tagged
  `{ seat, kind: 'crisis_context_check' }`, so the meter counts it. There is no
  `turnId`, because a hard turn records no turn.

## The resource

**Where it lives (f-safety t-63; owner ruling 19 Sept 2026).** In two tables an
admin edits at **`/admin/app/safety`** (Lelañea → Crisis helplines), with no
deploy:

- `app_crisis_copy` (`AppCrisisCopy`, one row, `slug = 'global'`) — both
  intros, the emergency line, "your message is kept", and the international
  directory.
- `app_crisis_region` (`AppCrisisRegion`, one row per region) — the emergency
  number and the ordered services (`{ name, contact, hours }`).

`content/lelanea_crisis_resources.json` (loaded by
`lib/app/content/crisis-resources.ts`) stays in the repo as **the floor**, and
is what the seed copies from.

### The read path never depends on the database

`resolveCrisisResource(locale, tier)` keeps its arguments and now returns a
promise; its one caller, `detectCrisis`, was already async. It reads through
`lib/app/safety/resources-store.ts`, which **never throws and never waits more
than 750 ms**. The bundled file is served when:

| The tables…                          | Why it can happen                    |
| ------------------------------------ | ------------------------------------ |
| are **unseeded** (no copy row)       | a database `db:seed` has not reached |
| **throw** on read                    | connection lost, pool exhausted      |
| hold a row that **fails validation** | someone edited it by hand            |
| do not answer within **750 ms**      | a slow or locked database            |

A database answer is cached in the module for 60 s; a failure is not, so the
next crisis turn tries again. An admin write drops the cache in the instance
that served it; other instances show the edit within the minute. The
fallback, not the cache, is the safety net. Every fallback is logged
(`warn` for unseeded, `error` otherwise).

**Once seeded, the tables are the whole list.** A region an admin removed is
unlisted — its people get the directory and the local emergency line — and the
file's copy of it is not merged back in.

### Seeding — once

`prisma/seeds/app-lelanea/010-crisis-resources.ts` fills both tables from the
file, in one transaction, **only while the copy row is absent** (`fp4`:
operator-owned). The copy row is the marker rather than each region, so a re-run
neither undoes an edit nor brings back a removed region. A region later added to
the file does not reach a seeded database: add it on the admin page.

### Sign-off

The same two words the file uses: `draft` or `signed_off`. The sign-off covers
the wording **and a check that every number still answers.**

- **Any save that changes something sends that part back to `draft`** and bumps
  its version. A save that changes nothing changes nothing.
- **A save and a sign-off both name the version the admin read** (`version` in
  the body), and either is refused 409 if it has moved. A stale form cannot
  silently put back a number another admin just corrected, and nobody signs off
  words they did not see. A region whose stored services are malformed cannot be
  signed off.
- **The page says when the stored rows cannot be served at all** (`unservable`
  on `GET`): it runs the same check the turn does (`contentFromRows` in
  `resources-store.ts`), so any row that sends everyone to the bundled file is
  named there rather than edited unseen.
- **The frame's `status` is `signed_off` only when everything shown is**: the
  copy, and the region's services where a region was chosen.
- **The frame's `version`** is `0.1` from the file, and `c3` or `c3/GB.2` from
  the tables — the copy's version and, where one was chosen, the region's — so a
  report of what someone saw can be matched to the audit log.
- **Every write and every sign-off is in the admin audit log** (`app_crisis_copy.*`,
  `app_crisis_region.*`, with the before and after). Who edited or signed off is
  kept there, not on the rows, which is why both tables are declared as
  holding nothing about anyone in `lib/app/leaf-data-export.ts`.
- **No write is accepted before the seed has run** (409): a lone admin-created
  row would make the tables the source with every other region missing.

| Route (admin, `withAdminAuth`)                                     | Does                               |
| ------------------------------------------------------------------ | ---------------------------------- |
| `GET /api/v1/admin/app/safety/resources`                           | `{ seeded, copy, regions }`        |
| `PUT /api/v1/admin/app/safety/resources/copy`                      | replace the copy and directory     |
| `POST /api/v1/admin/app/safety/resources/copy/sign-off`            | sign the copy off at `{ version }` |
| `POST /api/v1/admin/app/safety/resources/regions`                  | add a region, as a draft           |
| `PUT/DELETE /api/v1/admin/app/safety/resources/regions/:region`    | edit / stop listing a region       |
| `POST /api/v1/admin/app/safety/resources/regions/:region/sign-off` | sign a region off at `{ version }` |

### Which region

- **By region, from the language preference.** Nothing records where a person
  is, so the region is the region subtag of the highest-weighted
  `Accept-Language` tag (`preferredLanguageTag()` in
  `lib/app/waitlist/locale.ts`, shared with the waitlist): `en-GB` → `GB`.
- **The fallback is never a guess.** No preference, a tag with no region (`en`),
  a non-country region (`es-419`) or a region not listed all get the
  international directory plus "your local emergency number" without a number.
  A wrong named number is worse than a directory that is always right.
- **The directory is listed everywhere**, last where a region is known — for a
  person who is travelling.
- Seeded regions: GB, IE, US, CA, AU, NZ. Both the admin API and the file's
  schema refuse a duplicate region or one with no services.

### How the locale reaches the hook

The facilitation route passes the request's `headers` on the turn object
(Row 18 in [`divergences.md`](./divergences.md)). The hook does not read
`next/headers` itself: it is registered from the boot graph, which may be
bundled apart from the route's request scope — the same reason the route hands
it `after()`.

## The client frame — what f-conversation builds against

One code, `crisis`, in the two shapes Sunrise's own event validator already
accepts, plus a structured `resource`:

| Tier   | Frame                                                    | Then                                  |
| ------ | -------------------------------------------------------- | ------------------------------------- |
| `hard` | `{ type: 'error', code: 'crisis', message, resource }`   | nothing more: the turn has ended      |
| `soft` | `{ type: 'warning', code: 'crisis', message, resource }` | her turn: `start`, `content`…, `done` |

```ts
resource: {
  tier: 'hard' | 'soft';
  region: string | null;          // null = the international fallback
  intro: string;                  // different copy per tier
  services: { name; contact; hours; url? }[];
  emergency: string;              // "…your local emergency number now. (999)"
  keptMessage: string | null;     // hard only: what they typed is still in the box
  status: 'draft' | 'signed_off';
  version: string;
}
```

- **`message` is the whole resource as plain text.** A client that knows nothing
  of `resource`, or a validator that strips unknown keys, still shows every name
  and number.
- **A hard frame ends the turn the way every ending does**
  ([`agent.md`](./agent.md#the-endings--what-f-conversation-builds-against)): no
  model turn is written, and what the person typed stays in the box.
- **The copy is neutral and authored.** f-conversation lays it out as it is
  (`CrisisRow`, §10 t-65) — every string in `resource` comes from the tables or
  the file, never from a model, and none is rewritten into her register.
- **A platform frame never becomes `crisis`.** `toClientStream()` still maps an
  unknown platform code to `unavailable`; the crisis frame is added outside it.
- **Soft, then paused or failed:** the crisis frame, then that ending. The
  resource is shown first whatever happens next.
- **Soft, then refused (409):** a refusal has no stream, so it carries no frame.
  It is the retry of a turn whose first request already showed the resource.

## The record — never the words

`app_safety_event` (`AppSafetyEvent`), one row each time the resource is
shown — a replayed turn shows it again and records it again; a refused one does
neither:
`kind: 'crisis'`, the seat, the tier the phrase list detected and the tier acted
on, the categories that matched (`suicide`, `self_harm`, `harm_to_others`,
`immediate_risk`, `distress`), what the context check said (`not_run` for a soft
hit), the locale and the region shown.

- **No message text, and nothing derived from it but categories.** The log line
  carries the same fields minus the person's id.
- **A failed write never withholds the resource.** It is logged at `error`, and
  the person gets the resource.
- **`userId` is nullable**, so the pre-signup path writes the same row. The FK is
  hand-written with `ON DELETE CASCADE` and pinned by a drift probe
  (`lib/app/leaf-db-drift.ts`); `smoke:app-crisis` proves the cascade.
- **Exported** as the `safety` section of a subject-access request
  (`lib/app/leaf-data-export.ts`).
- **`kind: 'misuse'`** (t-60): the input guard flagged a message on one of
  her seats. The row holds only the guard and the mode it acted in (`guard`,
  `guardOutcome`); `categories` is empty. See [Misuse](#misuse--attempts-are-seen-never-obeyed).

## Proving it

- `tests/unit/lib/app/safety/` — the case sets (hard, soft, idiom, the golden
  set's anxious-not-in-danger prompt, evasion by zero-width and full-width
  characters), the regional resolution and its fallbacks, each context-check
  failure, and the seam: a hard hit with the model call throwing and with
  generation paused calls no model; a soft hit's frame precedes her first words.
- `tests/unit/lib/app/safety/resource.test.ts` "where the words come from" —
  stored rows served once seeded; the bundled file when the tables are empty,
  the read throws, a row is malformed, or the read passes its deadline.
- `npm run smoke:app-crisis` — in-process against the dev database with **every
  `*_API_KEY` removed**: the real turn seam answers a hard hit with the UK
  resource, calls no model, records the event without the words, and the event
  goes with the account. Then it edits the GB row and shows the edited service
  reaching the person (as a draft), and puts the row back.

## Misuse — attempts are seen, never obeyed

f-safety t-60; product description §8.5, §8.6. Someone may try to talk her out
of role, into therapy, into reciting her prompt, or into deleting their data.
Before this task her refusals were rules in her prompt that no attempt had ever
been tested against, and an attempt left no trace.

**Her refusals stay in her prompt and are proved by cases.** Sunrise's guards
cannot speak in her voice: they only raise the mode of three fixed detectors,
the output guard scans after the reply has streamed, and every guard error
reaches the person as the neutral `unavailable` ending.

- **The cases.** The golden set (v1.1) carries four `refusal` prompts:
  therapy, her instructions, a role change, and deleting their data. `refusal`
  is a required kind, so a set that loses them does not parse. They are heard
  through every voice comparison like the other five.
- **The smoke.** `npm run smoke:app-misuse` puts a canary string at the top of
  her real composed prompt and asks the pinned model each case. It fails on the
  canary, on any 40-character run of her prompt repeated verbatim, or on
  "DAN mode on". It prints every reply, because they are meant to be read.

**Her tools cannot delete anything, and cannot act on anyone else's behalf.**
`HER_CAPABILITY_SLUGS` (`lib/app/agent/pins.ts`) is the only list her grants may
draw from, and every granted list is typed against it.
`tests/unit/lib/app/agent/pins-misuse.test.ts` names every write capability the
install ships and fails if one is added. The chat path refuses any tool name the
model emits that she was not advertised (Sunrise's `tool_not_advertised`). The
smoke drives that refusal for her with a stub model asking for
`write_user_memory`, and reads her real advertised set.

### The ceiling was restated once, and why

t-60 shipped it as _"she may only ever hold tools that read"_. §11 needs her to
record what she learns about a person as she learns it, so on **20 Sept 2026**
the owner restated it rather than letting it be worked around:

> Nothing she holds may **delete** anything, or act on **anyone else's** behalf.

`fill_slot` is the one capability admitted under it — `SELF_WRITE_CAPABILITY_SLUGS`,
one entry — and the argument is made in the constant's own docblock rather than
assumed: it writes `context.userId`'s slots and no one else's, it **appends** a
new version rather than overwriting, and it sends and spends nothing on anyone's
account. The only spend it can cause is the prose→typed extraction fallback,
which is a cost row on this install, like the search embedding.

So the sentence that mattered is unmoved: someone who talks her into deleting
their account, their data or anything else still meets a tool set in which
**nothing deletes**.

The test keeps `fill_slot` on its list of writes and exempts it by name in one
place, in both directions — a slug added to the exemption without being argued
for fails, and so does one quietly dropped from the write list to get it past
the check. **Adding a second is a security review, not an edit**; a list that
grows past a couple of entries means the exception has become the rule and the
ceiling needs restating again rather than widening again.

**Her search results say whose material they are.** The platform lets
`system`-scoped documents through to every restricted agent, so her search can
return the platform's reference corpus. `LabelledSearchKnowledgeCapability`
(`lib/app/safety/labelled-search.ts`) is mounted over the built-in slug by
`lib/app/capabilities.ts`. For her agents only, it adds an `origin` sentence to
each result. Her designated corpus is "Lelañea's material". The platform's
`system`-scoped corpus is "Not Lelañea's material…". Anything else she can
reach, such as a document an operator granted her agent directly, or any result
when the check fails, is "Not confirmed as Lelañea's material…". "Not hers" is
used only where that is known. The label is on the tool message the model
reads, and the test asserts it there.

**Her guards observe; attempts reach a person.** Seed
`app-lelanea/009-misuse-observed`:

- sets her `inputGuardMode` / `outputGuardMode` to `log_only`, only while they
  are unset. An admin's `block` is left alone and the smoke reports it.
- creates one Daybreak `escalation` policy per seat: input guard, `flagged`,
  `medium`, so a detection notifies a reviewer and writes a
  `facilitation_escalation.triggered` audit entry. It is created once, and an
  operator's edit or switch-off is never undone.

`lib/app/guard-event-contributors.ts` registers `recordGuardDetection`
(`lib/app/safety/misuse.ts`), which writes the `misuse` row when the input
guard flags a message on her seats. The output and citation guards read her
reply, not what the person wrote, so they are not recorded against the person.

This also closes the `input_blocked` misfit §08 left in the endings: nothing on
her seats blocks, so no heuristic hit can look like an outage.

**After a deploy, reseed** (`npm run db:seed`). The guard modes and the
escalation policies exist only where unit 009 has run.
