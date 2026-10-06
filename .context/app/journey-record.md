---
name: journey-record
description: The journey record — a person's session synopses and their own entries in one stream; where it lives, who may read and change it, the API, and what is still to come.
---

# The journey record

The journey record holds the app's account of the work and the person's own
writing, together and in time order (product description §3.16). Feature
`f-journey-record` (§19) builds it in five tasks. **t-145**, the store and its
API, **t-146**, [drafting a synopsis](#drafting-a-synopsis), and **t-147**,
[keeping one](#keeping-a-synopsis), are the parts described here. Later tasks
add their sections as they land.

## What is in it

| Kind       | Written by                                         | State                                                                         |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `synopsis` | the `synopsis` seat, when a session closes (t-146) | `draft` until the person keeps it, as written or changed (t-147), then `kept` |
| `own`      | the person, whenever they want                     | `kept` from the moment it is written                                          |

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
- `withheldFromAgent`, below;
- on the wire, `regenerationsLeft` (a draft's remaining redrafts, else null) and `sourceRemoved` (a kept synopsis written from an exchange since deleted).

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
  person's notes (owner rulings 2 and 3) belongs to keeping. A kept synopsis
  is changed through the keep route too, so the notes follow the text. Any
  entry can be removed.

## The API

| Route                                            | Does                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/app/journey-record`                 | The kept record, newest first, each synopsis with its session's window, plus totals over all of it. `?q=` `?module=` `?outcome=` `?kind=` narrow it; `?drafts=true` adds what is waiting. |
| `POST /api/v1/app/journey-record`                | `{ body, summary?, withheldFromAgent? }`: an own entry.                                                                                                                                   |
| `PATCH /api/v1/app/journey-record/:id`           | Change an own entry's words, summary or `withheldFromAgent`.                                                                                                                              |
| `DELETE /api/v1/app/journey-record/:id`          | Remove any entry, words and all. Removing a synopsis does not redraft it. This is how a draft is discarded.                                                                               |
| `POST /api/v1/app/journey-record/:id/keep`       | `{ confirm, edit? }`: keep a synopsis, as written or changed, or change one already kept. Returns the entry and what it did to each listed note.                                          |
| `POST /api/v1/app/journey-record/:id/regenerate` | `{ steer? }`: another draft in place of this one. Returns the new draft.                                                                                                                  |
| `GET /api/v1/app/journey-record/export`          | The kept record as a Markdown download, oldest first.                                                                                                                                     |

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
  and an account of one would be padding. The count is held to the exchanges
  whose words can still be read, so a session whose conversation was deleted
  since is not sent to the model and charged for what is left of it.
- **Once per session.** Only the arrival that writes a session's close queues
  its draft, so two arrivals never both ask. A session that already has a
  synopsis is skipped, and the unique index on `sessionId` refuses a second
  row from anywhere else. A draft the person removes is not redrafted, because
  the session never closes again.

### What it is written from

| Part                          | From                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `summary`, `body`, `outcomes` | the model, given both sides of the session's exchanges, oldest first, fenced as material. Each message is cut to 2,000 characters; the latest exchanges that fit in 24,000 are kept, whole, so a reply never stands without what it answered     |
| `modules`                     | `node_*` and `module.*` events in `framework_journey_event` from the session's start until the next one began (so a module opened after the last exchange counts), once each, in the order first touched. Usually just `onboarding` in release 1 |
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
- **Existing databases get it from a migration**,
  `20261016100100_app_synopsis_seat`, which writes the same agent and binding
  wherever she already exists and leaves an operator's agent or seat alone. On
  a fresh database the seed creates them. An empty seat drafts nothing.
- **Only the agent's primary provider is tried**, as Daybreak's slot extractor
  does. Its configured fallbacks are not, so a primary outage at a session's
  close leaves that session with no draft (the known limit below).

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

## Keeping a synopsis

A draft is only the app's account of what happened. The person keeps it as
written, changes it first, asks for another, or discards it
(`lib/app/journey-record/keep.ts`, `lib/app/journey-record/synopsis/regenerate.ts`). Keeping is also
their strongest lever over what the app believes about them. The draft lists
the visible notes its session wrote, and keeping says which of those are right
(owner rulings 2 and 3 at planning; the t-147 rulings on how).

### What keeping does to the notes

| The person                      | The notes still ticked                                                                                                                                        | The unticked notes        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| keeps it as written             | each is **confirmed**: a new version with the same reading, `user_confirmed`, confidence 10                                                                   | left exactly as they were |
| changes it, then keeps it       | the changed account is **re-read** against each: one it says differently is **corrected** to what it says; one it agrees with or doesn't mention is confirmed | left exactly as they were |
| changes a synopsis already kept | the same, over the notes it confirmed when kept                                                                                                               | not listed any more       |

A confirmation or correction is written through `correctNote` (`lib/app/slots/notes.ts`) with its own reasoning line, so the notes panel says it came from keeping the account. Rules that hold throughout:

- **Only a note still at the version the session wrote is touched.** One that
  has moved on since (a later session, a correction, a removal) is left alone.
  Confirming the newer reading would confirm something the account never
  listed.
- **Hidden, special-category, withheld, removed and retired notes are never
  touched.** They are never listed in the first place, but a slot can be
  reclassified after drafting. So keeping asks again: the notes panel must
  offer the note as correctable, and `correctNote` refuses on its own terms.
- **One already confirmed at full confidence is not written again**, so a kept
  synopsis can be kept twice without growing the note's history.
- **After keeping, a synopsis lists only the notes it confirmed**, at the
  versions it left them. A later change re-reads exactly those.
- **A changed account is always kept.** If the re-read can't run (paused, at
  the ceiling, no agent in the seat, or the call failed), the text is kept and
  the notes are left alone, because confirming them could confirm something
  the edit contradicts. The response says so (`notesUnread`).

### The re-read

Owner ruling 3 assumed Daybreak's slot extraction could run over a passage of
text. It cannot. Daybreak's notes are written only by the AI calling
`fill_slot` inside a turn, and its `extract.ts` only turns prose into a typed
value for a slot already chosen. So the re-read is our own call, in that
file's shape (`lib/app/journey-record/synopsis/reread.ts`), and Daybreak has been asked for the
element (see below).

- It goes through the synopsis seat (`lib/app/journey-record/synopsis/seat.ts`). It is gated and
  charged exactly as a draft is, tagged `kind: 'journey_synopsis_reread'`.
- It has instructions of its own rather than her voice, and runs at
  temperature 0. It reads; it doesn't write.
- Each ticked note gets a verdict: `agrees`, `differs` with the reading the
  account supports, or `silent`. A reply about a note it was not asked about
  is dropped. A note it skipped counts as `silent`. A malformed reply is
  asked for once more, then refused.

### Regenerating

The person can ask for another draft, optionally saying why ("shorter", "you
missed the part about my father"). The new draft replaces the old one and is
still a draft.

- **Same call as the first draft** (`askForDraft`, `draft.ts`), written from
  the same session. The last draft and the person's steer are added after the
  session, each fenced as material. The steer is weighed as a request about
  the writing, never as a fact about the session.
- **Modules and notes are not drafted again.** They were derived from the
  session, and a different wording changes neither.
- **Capped at three per draft** (`MAX_SYNOPSIS_REGENERATIONS`). A try is taken
  before the model is called, so a double submit drafts once. The second
  submit gets 409 `regenerating`. A call that fails gives its try back.
- **Refusals come back as 409**, with a `reason`: `not_a_draft`,
  `no_more_drafts`, `paused`, `ceiling_reached` or `no_agent`. A failed call
  is 503, and the draft is unchanged.

### Discarding

A draft is discarded by removing it (`DELETE`, above). The session is not
redrafted.

### Once

The keep is one conditional write (`claimSynopsisKeep`, on the row's
`updatedAt`), made before any note is touched. Of two submits, one matches
and keeps; the other finds the synopsis already kept with that text and
answers with it, having written nothing. A submit that loses to a
_different_ change gets 409 `changed_meanwhile`.

### When the person deletes what a synopsis was written from

Deleting an exchange, or a conversation, settles its session's synopsis in the
same transaction (owner ruling, 6 Oct 2026, at t-147;
`settleSynopsesOfDeletedExchanges`):

- **A draft is removed.** Nobody has kept it, it may quote what was deleted,
  and redrafting it would charge the person for their own deletion.
- **A kept synopsis is flagged** (`sourceRemovedAt`; `sourceRemoved` on the
  wire). It is the person's kept account, perhaps in their own words, so it
  is never taken silently. The flag tells them it was written from something
  they have since deleted. Changing it clears the flag.

The deleted-conversation sweep settles them the same way, whichever path
deleted the conversation.

**Known limit:** a draft written in the seconds between a session closing and
an exchange from it being deleted can land after the deletion settled. It is
then an ordinary draft the person can discard. **Trigger to revisit:** a
report of a draft quoting something deleted.

### What it costs

- The re-read and each redraft are charged to the person, as a draft is
  (`lib/app/journey-record/synopsis/seat.ts`). Approving never calls a model.
- Keeping with an edit and regenerating share a per-person sub-cap of 10 a
  minute (`lib/app/journey-record/rate-limit.ts`), on top of the
  `/api/v1/**` section cap.

### Asked of Daybreak

The re-read stands in for a "re-read this text against these slots" element
Daybreak doesn't have. It has been asked for, with `reread.ts` as the
reference implementation (link below once filed).

## Not yet

- The timeline at `/app/journey` (t-148), and the recap and memory search
  reading the record (t-149).
