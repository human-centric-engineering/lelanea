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
       └─ resolveCrisisResource(locale, tier)  resource.ts — authored content
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

`content/lelanea_crisis_resources.json`, loaded and validated by
`lib/app/content/crisis-resources.ts` (only `lib/app/content/**` may import the
JSON). It is **a draft awaiting Lelañea's sign-off**: `provenance.status` is
`draft`, and every resolved resource carries `status: 'draft'` until the file
says `signed_off`. The sign-off covers the wording **and a check that every
number still answers.**

- **By region, from the language preference.** Nothing records where a person
  is, so the region is the region subtag of the highest-weighted
  `Accept-Language` tag (`preferredLanguageTag()` in
  `lib/app/waitlist/locale.ts`, shared with the waitlist): `en-GB` → `GB`.
- **The fallback is never a guess.** No preference, a tag with no region (`en`),
  a non-country region (`es-419`) or a region the table does not list all get
  the international directory (Find A Helpline) plus "your local emergency
  number" without a number. A wrong named number is worse than a directory that
  is always right.
- **The directory is listed everywhere**, last where a region is known — for a
  person who is travelling.
- Regions today: GB, IE, US, CA, AU, NZ. Adding one is an edit to the JSON; the
  schema refuses a duplicate region or one with no services.

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
- **The copy is neutral and authored.** Rendering it in her register is
  f-conversation's; every string in `resource` comes from the file, never from a
  model.
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
- **`kind: 'misuse'`** (t-60): an inline guard flagged a message on one of her
  seats. The row holds only the guard and the mode it acted in (`guard`,
  `guardOutcome`); `categories` is empty. See [Misuse](#misuse--attempts-are-seen-never-obeyed).

## Proving it

- `tests/unit/lib/app/safety/` — the case sets (hard, soft, idiom, the golden
  set's anxious-not-in-danger prompt, evasion by zero-width and full-width
  characters), the regional resolution and its fallbacks, each context-check
  failure, and the seam: a hard hit with the model call throwing and with
  generation paused calls no model; a soft hit's frame precedes her first words.
- `npm run smoke:app-crisis` — in-process against the dev database with **every
  `*_API_KEY` removed**: the real turn seam answers a hard hit with the UK
  resource, calls no model, records the event without the words, and the event
  goes with the account.

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

**Her tools cannot delete anything.** `READ_ONLY_CAPABILITY_SLUGS`
(`lib/app/agent/pins.ts`) is the only list her grant may draw from, and the
grant is typed against it. `tests/unit/lib/app/agent/pins-misuse.test.ts` names
every write capability the install ships and fails if one is added. The chat
path refuses any tool name the model emits that she was not advertised
(Sunrise's `tool_not_advertised`). The smoke drives that refusal for her with a
stub model asking for `write_user_memory`, and reads her real advertised set.

**Her search results say whose material they are.** The platform lets
`system`-scoped documents through to every restricted agent, so her search can
return the platform's reference corpus. `LabelledSearchKnowledgeCapability`
(`lib/app/safety/labelled-search.ts`) is mounted over the built-in slug by
`lib/app/capabilities.ts`. For her agents only, it adds an `origin` sentence to
each result: "Lelañea's material", "Not Lelañea's material…", or, when the
check fails, "Origin could not be checked…". The label is on the tool message
the model reads, and the test asserts it there.

**Her guards observe; attempts reach a person.** Seed
`app-lelanea/009-misuse-observed`:

- sets her `inputGuardMode` / `outputGuardMode` to `log_only`, only while they
  are unset. An admin's `block` is left alone and the smoke reports it.
- creates one Daybreak `escalation` policy per seat: input guard, `flagged`,
  `medium`, so a detection notifies a reviewer and writes a
  `facilitation_escalation.triggered` audit entry. It is created once, and an
  operator's edit or switch-off is never undone.

`lib/app/guard-event-contributors.ts` registers `recordGuardDetection`
(`lib/app/safety/misuse.ts`), which writes the `misuse` row for any guard on her
seats. The record is what happened; the policy decides who is woken.

This also closes the `input_blocked` misfit §08 left in the endings: nothing on
her seats blocks, so no heuristic hit can look like an outage.

**After a deploy, reseed** (`npm run db:seed`). The guard modes and the
escalation policies exist only where unit 009 has run.
