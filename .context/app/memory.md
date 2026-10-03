# The memory index

What a person says, embedded so a conversation now can find what they said
months ago by meaning, for that person only (f-memory t-129; product
description §5, §3.19, §12 "Deletion is real").

**The code:** `lib/app/memory/memory-index.ts`. **The table:**
`app_memory_embedding` (`prisma/schema/app.prisma`, migration
`20261008100000_app_memory_embedding`). **The proof on a real database:**
`npm run smoke:app-memory-index`.

## Anti-patterns first

- **Never read or write `app_memory_embedding` outside `memory-index.ts`.**
  `tests/unit/lib/app/memory/index-boundary.test.ts` (always-run) fails on a
  second reader. One reader is what keeps every read per person and what keeps
  the table swappable for Daybreak's (below). Need something new from the
  index? Add a function to the module.
- **Never take the person from a model's arguments or a request body.** Every
  function takes a `MemorySubject` (`{ userId }`), and the caller fills it from
  its own context: the turn, the session, a capability's execution context.
- **Never copy words into the table.** A row holds a vector and the id of its
  source. A search reads the words from `ai_message`, so deleting the message
  deletes the words everywhere at once.
- **Never add a source kind without its own cascading foreign key.** "An
  embedding goes with its source" (owner ruling 2, journal on `f-memory`) is
  carried entirely by `ON DELETE CASCADE`: there is no deletion code on any
  path. A kind whose source is wiped rather than deleted (a note's placeholder,
  t-107) must call `forgetMemory()` from that wipe as well.
- **Never apply its migrations with `migrate dev`.** Two FKs, two CHECKs and the
  HNSW index are hand-written, so the generated SQL drops them (`B13`). Author
  with `--create-only`, strip the drops, apply with `npm run db:migrate:deploy`,
  and run `npm run db:drift-check`, which probes each one in
  `lib/app/leaf-db-drift.ts`.

## What goes in

The person's own messages in a seat conversation (`contextType` =
`facilitation`), at least `MIN_INDEXED_CHARS` long once trimmed. Replies,
tool results and conversations outside the seats are never embedded.

- **On the turn.** `recorded()` in `lib/app/agent/turns.ts` calls
  `queueMessageIndex()` when the platform's `start` event names the person's
  message. It runs off the reply's path and never fails the turn; a failure is
  logged and left for the backfill.
- **By the backfill.** `app:memory-index-backfill` (`lib/app/jobs.ts`, per org,
  every 5 minutes) embeds a batch of messages that have no row: everything said
  before the index existed, and anything the turn path missed. It stops at the
  first failure, since that is almost always the embedder.

The "is this indexable" test is one SQL predicate (`INDEXABLE`) both paths use.
Testing length in JS on one path and in SQL on the other would let a message
the two measure differently hold a backfill slot forever.

Each embedding is costed by Sunrise's embedder, attributed to the person and
the conversation, with `kind: memory_embedding` (a search's query embedding is
`memory_search`). Both count against the person's monthly ceiling and show as
the `memory` part of a turn's cost (`classifyCostRow`, `metering.ts`).

## Who can find it

`searchMemory(subject, query, { limit, maxDistance? })` returns the person's own
messages nearest in meaning, with their words. The SQL requires the person on
the index row **and** on the message's conversation, and the org. It compares
only vectors made by the model that embedded the query, so after the embedding
model changes, older messages are unsearchable until re-embedded.

**Known limit:** the HNSW index ranks across everyone, and the person filter
applies after it, so on a large table a person with few messages can get fewer
than `limit` hits (pgvector's `ef_search`). Revisit with iterative scans or a
partial index if a person's search comes back short.

The capability that lets the AI call this is t-130. It decides what reaches a
prompt, including whether a turn the crisis path answered is ever surfaced.

## What takes it out

| When                                                                                         | How                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A message is deleted, including by deleting an exchange (`slots.md`, "Deleting an exchange") | `messageId` → `ai_message`, `ON DELETE CASCADE`       |
| A conversation is deleted (Sunrise's route, retention)                                       | its messages cascade, and their vectors with them     |
| The account is erased (`eraseUser()`)                                                        | `userId` → `user`, `ON DELETE CASCADE`                |
| The org is deleted                                                                           | `orgId` → `org`, `ON DELETE CASCADE`                  |
| A source stays but its words go (t-107's notes)                                              | `forgetMemory()`, called by whatever wipes the source |

## Data rights

- **Art. 15:** the `memory` section of the subject-access export lists which of
  the person's messages are indexed, when, and by which model. Never the vector,
  which means nothing to the person it describes; the words are in their
  conversations section (`lib/app/leaf-data-export.ts`).
- **Art. 17:** the `userId` cascade. No erasure hook.
- **Org export:** `appMemoryEmbeddings`, the same entries for every member,
  never the vectors.

## Swapping it for Daybreak's

The table is a leaf stand-in for
[daybreak#287](https://github.com/human-centric-engineering/daybreak/issues/287)
(owner ruling 1). The module's surface mirrors that ask: `indexMessage` /
`queueMessageIndex` to add, `searchMemory` to find, `forgetMemory` to remove.
When Daybreak's index ships in a release we sync: point those functions at it,
re-embed (or migrate) what this table holds, drop the table and its migration's
objects in a new migration, and delete the drift probes, the always-run
boundary test and the `memory` export sections that name it.
