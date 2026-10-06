---
name: journey-record
description: The journey record — a person's session synopses and their own entries in one stream; where it lives, who may read and change it, the API, and what is still to come.
---

# The journey record

The journey record holds the app's account of the work and the person's own
writing, together and in time order (product description §3.16). Feature
`f-journey-record` (§19) builds it in five tasks. **t-145**, the store and its
API, is the part described here. Later tasks add their sections as they land.

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

## Not yet

- Drafting (t-146), keeping (t-147), the timeline at `/app/journey` (t-148),
  and the recap and memory search reading the record (t-149).
- Editing a kept synopsis after the fact. §12 says anything in the record can
  be edited. That goes through keeping's path, so the person's notes follow
  the text (t-147).
