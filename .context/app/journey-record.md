---
name: journey-record
description: The journey record — a person's session synopses and their own entries in one stream; where it lives, who may read and change it, the API, and what is still to come.
---

# The journey record

The journey record holds the app's account of the work and the person's own
writing, together and in time order (product description §3.16). Feature
`f-journey-record` (§19) builds it in five tasks. **t-145**, the store and its
API, and **t-146**, [drafting a synopsis](#drafting-a-synopsis), are the parts
described here. Later tasks add their sections as they land.

## What is in it

| Kind       | Written by                                         | State                                                                           |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `synopsis` | the `synopsis` seat, when a session closes (t-146) | `draft` until the person approves, edits or regenerates it (t-147), then `kept` |
| `own`      | the person, whenever they want                     | `kept` from the moment it is written                                            |

Module reflections, the third thing §3.16 names, land from phase 7, when
modules have interiors. They will add a kind.

**Nothing enters the record over the person's head (§12).** A draft is held but
is not in the record. Drafts are left out of the list (unless asked for), the
totals and the Markdown export, and no agent ever reads one. They are in the
GDPR bundle, because we hold them.

Each entry carries:

- a one-line `summary` (required of a synopsis);
- the `body`, which is her account of a synopsis or the person's own words;
- `outcomes`, each an `action`, `insight` or `tension` (`journeyOutcomesSchema`, `lib/app/journey-record/entry.ts`);
- the `modules` it touched;
- the `notes` its session wrote, each `{ slotSlug, version }`: references for keeping to confirm, never a reading (`journeyNoteRefsSchema`);
- `occurredAt`, which is a synopsis's session start, or when an own entry was written;
- `withheldFromAgent`, below.

## Where it lives, and why not in Daybreak's stream

`app_journey_entry`, a table of ours (owner ruling, 6 Oct 2026, at planning;
journal on `f-journey-record`). Sessions themselves live in Daybreak's
`framework_journey_event` ([`agent.md`](./agent.md) → Sessions), and the record
was first expected to as well. But Daybreak's schema declares that stream
**insert-only: never updated, never deleted, except on erasure**. The record
breaks that contract three ways:

- a draft is replaced;
- a kept entry is edited;
- anything in it can be removed (§12), and removing has to take the words with it, not append a tombstone beside them.

So this is the "element does not fit" case of the scaffolding rule
([`building-with-daybreak.md`](./building-with-daybreak.md)). It is ledgered in
[`divergences.md`](./divergences.md) (Row 29), with
[`daybreak#293`](https://github.com/human-centric-engineering/daybreak/issues/293)
proposing the element it stands in for.

**Only `lib/app/journey-record/` reads or writes the table.** The two
hand-written foreign keys both cascade:

- `userId` → `user`: erasure takes the record.
- `sessionId` → the session's `session.started` row: a synopsis goes with its session when that is forgotten (f-forget-session).

A CHECK ties the shape together: a synopsis names its session and has a
summary; an own entry names none and is always kept; `keptAt` is set exactly
when an entry is kept. A unique index gives a session one synopsis. The FKs and
the CHECK are drift-probed in `lib/app/leaf-db-drift.ts`.

## Who may read and change it

- **The person, and nobody else.** Every route is self-scoped
  (`lib/app/journey-record/ownership.ts`). Another person's entry id answers
  404, the same as an id that never existed. There is no admin door to it.
- **She reads it by default; the person can keep an entry from her** (owner
  ruling 4). `withheldFromAgent` marks an own entry no agent may read. t-149
  makes the recap and memory search honour it. Until then, no agent reads
  the record at all.
- **A synopsis is changed by keeping it, never by editing it in place.** The
  edit route refuses a synopsis with 409, because what keeping does to the
  person's notes (owner rulings 2 and 3) belongs to keeping (t-147). Any entry
  can be removed.

## The API

| Route                                   | Does                                                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/app/journey-record`        | The kept record, newest first, each synopsis with its session's window, plus totals over all of it. `?q=` `?module=` `?outcome=` `?kind=` narrow it; `?drafts=true` adds what is waiting. |
| `POST /api/v1/app/journey-record`       | `{ body, summary?, withheldFromAgent? }`: an own entry.                                                                                                                                   |
| `PATCH /api/v1/app/journey-record/:id`  | Change an own entry's words, summary or `withheldFromAgent`.                                                                                                                              |
| `DELETE /api/v1/app/journey-record/:id` | Remove any entry, words and all. Removing a synopsis does not redraft it.                                                                                                                 |
| `GET /api/v1/app/journey-record/export` | The kept record as a Markdown download, oldest first.                                                                                                                                     |

**Search and filters run in memory** over the person's whole record
(`lib/app/journey-record/query.ts`), as the notes do. The totals need all of it
anyway, and a search can then reach the outcomes. A search matches when every
word appears in the summary, body, outcomes or modules, with case and accents
folded. Revisit if one person's record passes a few thousand entries.

**What never reaches a log:** an entry's words, and a search. The read
overrides the route logger's URL to the path for exactly this reason.

## Drafting a synopsis

When a session ends, she writes a draft of what it was about
(`lib/app/journey-record/synopsis/`). It waits for the person to keep, change
or discard it (t-147), and until then it is not in the record and no agent
reads it.

### When a draft is written

- **When the session closes.** Sessions close lazily: the arrival that opens
  the next one writes the close ([`agent.md`](./agent.md) → Sessions). That
  arrival queues the closed session's draft once its transaction commits.
- **Off the request path.** The queue returns at once
  (`queueSynopsisDraft`), so an arrival never waits on a model. The arrival
  hands the work to its host's `keepAlive`: the conversation and opening
  routes pass Next's `after()`, and a turn passes its own. So a serverless
  function is not frozen once the response has gone. A failure is logged and
  lost: that session gets no draft.
- **Only a session of substance: three exchanges or more**
  (`MIN_SYNOPSIS_EXCHANGES`, `material.ts`). An exchange is a completed turn
  that answered a message of the person's, on either seat. Openings and recaps
  are hers, not an exchange, and never count. Fewer than three is a look-in,
  and an account of one would be padding. A session whose messages can no
  longer be read (its conversation deleted since) is not drafted either,
  rather than sending the model nothing and charging for it.
- **Once per session.** Only the arrival that writes a session's close queues
  its draft, so two arrivals never both ask. A session that already has a
  synopsis is skipped, and the unique index on `sessionId` refuses a second
  row from anywhere else. A draft the person removes is not redrafted, because
  the session never closes again.

### What it is written from

| Part                          | From                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `summary`, `body`, `outcomes` | the model, given both sides of the session's exchanges, oldest first, fenced as material. Each message is cut to 2,000 characters; the latest exchanges that fit in 24,000 are kept, whole, so a reply never stands without what it answered     |
| `modules`                     | the session's window in `framework_journey_event`: `node_*` and `module.*` events, once each, in the order first touched. Usually just `onboarding` in release 1                                                                                 |
| `notes`                       | what the session's turns wrote (`app_turn_slot_write`), kept only when the notes panel shows it (`getNotes`: no hidden slot, no voice leaning) and it is not removed, withheld or special category; each at the latest version the session wrote |
| `occurredAt`                  | the session's start                                                                                                                                                                                                                              |

The model is never asked for the modules or the notes. Every read names the
person: a message is read only through a conversation of theirs, so another
person's words cannot reach the prompt even through a corrupt link.

The reply is validated with Zod (`synopsisReplySchema`, `prompt.ts`): exactly
a summary, an account and outcomes, within the record's limits. Anything else
is asked for once more, then refused, and nothing is stored. The reply's
words are never logged.

### Who writes it

The agent in Daybreak's `synopsis` seat: `lelanea-synopsis`
(`lib/app/journey-record/synopsis/agent.ts`), seeded with the seat by
`prisma/seeds/app-lelanea/026-synopsis-seat.ts`. It wears her voice profile
(`lelanea-voice-core`) with instructions of its own, and its prompt is
composed from the profile as a turn's is. It is called one-shot through
Sunrise's `runStructuredCompletion` on its own provider and model, the way
Daybreak's slot extractor calls its agent. It is not a chat surface: it holds
no capabilities, stays `internal`, and is not in `SEATED_ROLES`, which lists
the seats a person speaks through.

- **The seed fills only an empty seat**, as seed 006 does for hers. An agent an
  operator bound there is reported and left alone.
- **Its provider and model are operator-owned.** They are seeded empty, so it
  resolves from the install's default chat model until someone picks one in
  the admin. Its instructions, profile link and `restricted` knowledge mode are
  reconciled on every run.
- **An empty seat drafts nothing.** A database that has not run `db:seed`
  since this landed has no synopsis agent, so it drafts no synopses.

### What it costs, and who pays

- **The person pays, as for a turn.** Their summary is of their conversation,
  so the cost row carries their id, tagged
  `{ seat: 'synopsis', kind: 'journey_synopsis' }`, and their meter counts it.
- **Refused rather than overdrawn.** Before the call, the draft asks the same
  question a turn asks (`mayStartGeneratedTurn`). A person at or over their
  monthly ceiling gets no draft. The comparison is strict, so a ceiling of zero
  refuses every draft. Generation paused refuses it too.
- **As for a turn, the check fails open on a read error,** and a draft that
  starts under the ceiling may cross it by its own cost.
- **A reply refused after its retry is not charged.** The runner throws
  without usage when nothing parsed. Those tokens are billed by the provider
  but never reach the meter: under-charged, never overdrawn. A truncated reply
  carries its usage and is charged.

**Known limit: a refused session gets no draft, ever.** It is drafted only at
its close, so one closed while the person was at their limit, while generation
was paused, or while the provider was down has no synopsis. That is what every
session before t-146 has. **Trigger to revisit:** people at their limit asking
where a session's account went. The remedy then is a catch-up pass, which
needs a marker for "drafting declined" so that a draft the person removed
stays removed.

`npm run smoke:app-synopsis` proves the wiring on the dev database with a real
model: a session of three real turns closes, and its stored draft is printed.

## Not yet

- Keeping (t-147), the timeline at `/app/journey` (t-148),
  and the recap and memory search reading the record (t-149).
- Editing a kept synopsis after the fact. §12 says anything in the record can
  be edited. That goes through keeping's path, so the person's notes follow
  the text (t-147).
