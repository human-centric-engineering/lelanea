---
name: journey-record
description: The journey record — a person's session synopses and their own entries in one stream; where it lives, who may read and change it, the API, and what is still to come.
---

# The journey record

The journey record holds the app's account of the work and the person's own
writing, together and in time order (product description §3.16). Feature
`f-journey-record` (§19) builds it in five tasks. **t-145**, the store and its
API, **t-146**, [drafting a synopsis](#drafting-a-synopsis), **t-147**,
[keeping one](#keeping-a-synopsis), and **t-148**, [the view](#the-view), are
the parts described here. Later tasks add their sections as they land.

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

| Route                                            | Does                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/app/journey-record`                 | The kept record, newest first, each synopsis with its session's window, plus totals over all of it, and `notes`: each note an entry on the page lists, as the notes panel holds it now. `?q=` `?module=` `?outcome=` `?kind=` narrow it; `?drafts=true` adds what is waiting. |
| `POST /api/v1/app/journey-record`                | `{ body, summary?, withheldFromAgent? }`: an own entry.                                                                                                                                                                                                                       |
| `PATCH /api/v1/app/journey-record/:id`           | Change an own entry's words, summary or `withheldFromAgent`.                                                                                                                                                                                                                  |
| `DELETE /api/v1/app/journey-record/:id`          | Remove any entry, words and all. Removing a synopsis does not redraft it. This is how a draft is discarded.                                                                                                                                                                   |
| `POST /api/v1/app/journey-record/:id/keep`       | `{ seen, confirm, edit? }`: keep a synopsis, as written or changed, or change one already kept. Returns the entry and what it did to each listed note.                                                                                                                        |
| `POST /api/v1/app/journey-record/:id/regenerate` | `{ steer? }`: another draft in place of this one. Returns the new draft.                                                                                                                                                                                                      |
| `GET /api/v1/app/journey-record/export`          | The kept record as a Markdown download, oldest first.                                                                                                                                                                                                                         |

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
  It is checked again just before each write, since a re-read can take
  minutes and a turn may write meanwhile.
  Confirming the newer reading would confirm something the account never
  listed.
- **Hidden, special-category, withheld, removed and retired notes are never
  touched.** They are never listed in the first place, but a slot can be
  reclassified after drafting. So keeping asks again: the notes panel must
  offer the note as correctable, and `correctNote` refuses on its own terms.
- **One already confirmed at full confidence is not written again**, so a kept
  synopsis can be kept twice without growing the note's history.
- **After keeping, a synopsis lists only the notes it confirmed**, at the
  versions it left them. A later change re-reads exactly those, as far as they
  are still ticked: `confirm` is always the list still ticked, so a change sent
  with `confirm: []` unlists every note and reads none. The view (t-148) shows
  the ticks on a kept synopsis too.
- **The last check before a write is a read, not a lock.** A turn that writes
  the same note in the milliseconds between that read and the write can still
  be overwritten. Closing it needs an expected-version append from Daybreak's
  `appendSlotValue`, which is Daybreak's file. **Trigger to revisit:** a note
  confirmed by keeping found to have buried a newer reading.
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
- **Capped at three per draft** (`MAX_SYNOPSIS_REGENERATIONS`). The cap counts
  calls to the model: a try is taken, with the lease, before the model is
  called, so a double submit drafts once and the second gets 409
  `regenerating`. A try is given back only when the model was never asked; a
  call that fails still spends it, or a steer that always fails could call
  the model without end.
- **Refusals come back as 409**, with a `reason`: `not_a_draft`,
  `no_more_drafts`, `paused`, `ceiling_reached`, `no_agent`, `regenerating`
  or `changed_meanwhile`. A failed call
  is 503, and the draft is unchanged.

### Discarding

A draft is discarded by removing it (`DELETE`, above). The session is not
redrafted.

### Once, and finished

The keep is one conditional write (`claimSynopsisKeep`, on the row's
`updatedAt`), made before any note is touched. It takes a lease on the
synopsis (`workingSince`, five minutes) and records what its notes are owed
(`notesPending`: `confirm`, or `reread` when the text changed).

- **What the person saw is what is kept.** The keep carries `seen`, the
  entry's `updatedAt` on the page, and is conditional on it, so a stale page
  (one showing a draft since redrafted in another tab) keeps nothing and gets
  409 `changed_meanwhile`.
- **A double submit keeps once.** Of two submits, one matches and keeps; the
  other finds the synopsis already kept with that text and answers with it,
  having written nothing.
- **A different change arriving while one is settling** meets the lease and
  gets 409 `busy`: try again in a moment. One that lost to a change already
  finished gets 409 `changed_meanwhile`.
- **Nothing owed is forgotten.** The notes are settled after the claim, in
  writes of their own. If that fails, the synopsis is kept with its notes still
  owed and the lease given back, and the next keep of it, even one changing
  nothing, finishes the work. So does the next keep after a re-read that could
  not run. A lease left by a crash is taken over once it is five minutes old.
- **Regenerating takes the same lease**, so a second redraft, at once or while
  the first is being written, calls nothing and gets 409 `regenerating`.

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

**A draft being written when the exchange is deleted** is not there for the
deletion to remove. So drafting and redrafting read the session's turns again
once the draft is stored, and remove a draft that lost an exchange meanwhile
(`lostExchanges`, `material.ts`; the draft's outcome is `deleted_meanwhile`).
Between them, the deletion finds a draft stored before it, and the re-read
finds a deletion settled before that. What is left is the two writes landing
within the same few milliseconds.

### What it costs

- The re-read and each redraft are charged to the person, as a draft is
  (`lib/app/journey-record/synopsis/seat.ts`). Approving calls no model,
  unless it finishes a re-read an earlier keep could not run.
- Keeping and regenerating share a per-person sub-cap of 10 a minute (`lib/app/journey-record/rate-limit.ts`), on top of the
  `/api/v1/**` section cap.

### Asked of Daybreak

The re-read stands in for a "re-read this text against these slots" element
Daybreak doesn't have:
[`daybreak#295`](https://github.com/human-centric-engineering/daybreak/issues/295),
with `reread.ts` as the reference implementation. When it lands, delete
`reread.ts` and call Daybreak's.

## The view

`/app/journey` (`app/(lelanea)/app/journey/page.tsx`,
`components/app/journey/`) is the record as a timeline, after the
prototype's `renderJourney`.

- **One read, on the server.** The page calls `getJourneyRecord` (with
  drafts) and the map, and hands both to the timeline. The search and the
  filters live in the URL, so narrowing re-renders the page; every change ends
  in `router.refresh()`. Nothing patches the page in the browser.
- **The notes travel with the record.** The read lists, once, each note any
  entry on the page names: its heading, current reading and version, and
  whether keeping may still write to it (keep.ts's own rule: correctable, and
  holding words rather than the special-category sentinel). It comes from `getNotes`, so a note
  hidden or removed since it was listed is not on the page at all, and one
  withheld at capture shows no reading. A note that has moved on since the
  session wrote it is shown unticked and cannot be ticked, because keeping
  would leave it alone anyway.
- **Stops, newest first, one open at a time.** The newest starts open. A
  waiting draft is its session's own stop, with keep, change, ask for another
  (while any are left) and discard. A kept synopsis lists the notes kept with
  it. That list is not headed "confirmed": a keep whose re-read could not run
  leaves its notes listed but unconfirmed, and the wire does not tell the two
  apart. An own entry can be edited, removed, or kept from Lelañea.
- **A keep that could not read the notes says so.** The keep route's
  `notesUnread` is shown under the stop: the account was kept and the notes
  were left alone, and keeping it again finishes the read.
- **The ticks follow the notes.** Keeping moves each confirmed note on a
  version, so when the listed notes change the ticks start again from every
  usable note ticked. Without that, a second change after a keep would send
  `confirm: []` and unlist every note.
- **Nothing is live while the page catches up.** An action stays busy until
  the refresh after it lands, so a stop just kept or removed cannot be acted
  on again from its old state.
- **"What's next" is pinned last and never counted.** It points at the
  module the person is in, or the first on the map they have not finished
  (`lib/app/journey/next.ts`). Every module stays open, and the copy says so.
- **The stats are the record's totals**, before any narrowing. There is no
  "module closed": sessions close, modules do not (§6.12).
- **A stop with no module is the usual case in release 1**, and says so
  rather than looking empty.

## Not yet

- The recap and memory search reading the record (t-149).
