# The memory index

What a person says, and the notes the app keeps about them, embedded so a
conversation now can find what they said months ago by meaning, for that person
only (f-memory t-129, t-107; product description §5, §3.19, §12 "Deletion is
real"). The AI reaches it through one tool, `search_person_memory` (t-130).

**The code:** `lib/app/memory/memory-index.ts` (the index) and
`lib/app/memory/search-capability.ts` (the tool). **The table:**
`app_memory_embedding` (`prisma/schema/app.prisma`, migrations
`20261008100000_app_memory_embedding` and
`20261009100100_app_memory_note_source`). **The proof on a real database:**
`npm run smoke:app-memory-index` (the index) and `npm run
smoke:app-search-memory` (the tool, notes, and each way a note goes).

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
  source. A search reads the words from `ai_message` or `framework_slot_value`,
  so deleting the source deletes the words everywhere at once.
- **Never add a source kind without its own cascading foreign key.** "An
  embedding goes with its source" (owner ruling 2, journal on `f-memory`) is
  carried by `ON DELETE CASCADE` wherever a source is deleted.
- **Never wipe a note version in place without `forgetWipedNotes(tx, …)` in the
  same transaction.** A placeholder is an update, so no cascade fires.
  `wipeTurnWrites()` and `deleteNote()` both call it; a third way of wiping a
  note must too.
- **Never embed a note's `reasoningNote`.** It is not masked (daybreak#269).
  Only `value` is read.
- **Never apply its migrations with `migrate dev`.** Three FKs, two CHECKs and
  the HNSW index are hand-written, so the generated SQL drops them (`B13`). Author
  with `--create-only`, strip the drops, apply with `npm run db:migrate:deploy`,
  and run `npm run db:drift-check`, which probes each one in
  `lib/app/leaf-db-drift.ts`.

## What goes in

### What the person said

The person's own messages in a seat conversation (`contextType` =
`facilitation`), at least `MIN_INDEXED_CHARS` long once trimmed. Replies,
tool results and conversations outside the seats are never embedded.

- **On the turn.** `recorded()` in `lib/app/agent/turns.ts` calls
  `queueMessageIndex()` when the platform's `start` event names the person's
  message. It runs off the reply's path and never fails the turn; a failure is
  logged and left for the backfill.
- **By the backfill.** `app:memory-index-backfill` (`lib/app/jobs.ts`, per org,
  every 5 minutes) embeds a batch of messages that have no row: everything said
  before the index existed, and anything the turn path missed. A failure is
  blamed on a message only when the next message embeds: two failures in a row
  mean the embedder is down, so the run stops and blames nobody, and an outage
  of any length leaves nothing behind. A message blamed `MAX_BACKFILL_ATTEMPTS`
  times is left out (counted in process memory, so a restart gives it three
  more), so one the embedder never takes cannot hold back the rest.
- **Not with a model the index cannot store.** The embedder charges a call
  whether or not its vector can be stored. Both paths ask the active model's
  recorded size first (`getActiveEmbeddingModelSummary`). With no model active
  the platform's fallback chain does not guarantee a size, so the first vector
  of the wrong size is the answer: that model is remembered for the life of the
  process and not used again.

The "is this indexable" test is one SQL predicate both paths use, written out
in each and held equal by a unit test. Testing length in JS on one path and in
SQL on the other would let a message the two measure differently hold a
backfill slot forever.

Each embedding is costed by Sunrise's embedder, attributed to the person and
the conversation, with `kind: memory_embedding` (a search's query embedding is
`memory_search`). Both count against the person's monthly ceiling. An
embedding made on the turn path carries the turn's `turnId`, so the per-turn
meter counts it as that turn's `memory` part (`classifyCostRow`,
`metering.ts`); a backfilled one belongs to no turn and counts only in the
month.

### The notes kept about them (t-107)

The **head** version of every note the person can see in their own panel (owner
ruling, 4 Oct 2026, journal on `f-memory`), headings the AI coined included.
Every note statement carries the same five `QUALIFIES` lines, held equal by a
unit test: a live head, not a placeholder, at least `MIN_INDEXED_CHARS` long, and not hidden
or special-category in **either** tier (Daybreak's `framework_slot_definition`
or our `app_slot_definition`, the stricter of the two, as the panel reads them).

- **A special-category note is never embedded.** Its stored value is the
  masking sentinel, which holds nothing to find. Excluding the slug also covers
  a value stored before the slot was reclassified.
- **A revision replaces the vector.** `indexNote(subject, slotSlug)` embeds the
  current head and drops the vector of every superseded version, decided at
  delete time from `supersededAt`. Never from the head the call read before it
  embedded: a revision landing mid-embed would make that stale, and the slower
  call would delete the newer version's vector.
- **On write:** `fill_slot` (`capture.ts`), a correction (`correctNote`) and a
  discovery answer (`discovery-store.ts`) each call `queueNoteIndex()`, off the
  write's path.
- **By the backfill**, alongside messages: heads with no vector. The same run
  first drops the vector of any note that stopped qualifying (superseded,
  hidden since, or wiped in a race with its own embedding).

## Who can find it

`searchMemory(subject, query, { limit, maxDistance?, excludeMessageIds?,
attribution? })` returns the person's own messages and notes nearest in meaning,
with their words, merged by distance. Each kind's SQL requires the person on
the index row **and** on its source (the message's conversation, the note
version), and the org; the note query also carries the `QUALIFIES` lines, so a
placeholder or a hidden note is never returned even before its vector is
dropped. It compares only vectors made by the model that embedded the query, so
after the embedding model changes, older entries are unsearchable until
re-embedded.

**Known limit:** the HNSW index ranks across everyone, and the person filter
applies after it, so on a large table a person with few messages can get fewer
than `limit` hits (pgvector's `ef_search`). Revisit with iterative scans or a
partial index if a person's search comes back short.

### The AI's tool: `search_person_memory` (t-130)

`lib/app/memory/search-capability.ts`, granted to the guide by seed 024 and the
migration `20261009100000_app_search_person_memory_capability` (the
[agent page](./agent.md#the-tools-the-guide-holds) has the pattern). A tool and
not a context contributor, because a contributor never sees the message being
answered and its block is cached for 60 seconds.

- **Its only argument is the query.** The person is `context.userId`.
- **Facilitator seat only.** A call from the onboarding seat or from no turn is
  refused with a message the AI can speak past.
- **Labelled.** Each result carries `kind` (`their_words` or `note`), `when`
  (a date in words, UTC) and `whose`, a sentence telling the model how to use
  it: their words are quoted only as theirs; a note is its understanding of
  them, never quoted as something they said.
- **Leaves out the message the turn is answering** (`app_turn.userMessageId`),
  which is already in front of the AI and would otherwise be the nearest hit.
- **At most `MEMORY_RESULTS_PER_CALL`, within `MEMORY_MAX_DISTANCE`.** The
  distance was set on the dev database, where a short query ("my dad") sits
  well inside it from a sentence on the same subject and an unrelated one
  sits outside. `npm run smoke:app-search-memory` prints the distances.
- **The audit row keeps a count**, never the query or the words.
- **The account under the reply** says "Looked back at what you’ve said
  before" (`account.ts`).

**What a search leaves behind is cleared on deletion.** Sunrise stores every
tool result as a `role: 'tool'` message and replays it on later turns, so a
search leaves a copy of what it found in the conversation it ran in.
Removing a note, deleting an exchange and forgetting a deleted conversation
each call `clearStoredSearchResults(tx, …)` (`stored-results.ts`) in their own
transaction: every stored `search_person_memory` result in the person's
conversations is overwritten with `CLEARED_SEARCH_RESULT`, its metadata
emptied. The row is kept, because a tool call with no result is refused by the
providers on replay. All of them, not only those that quoted what went:
matching on the deleted words could miss one. The AI can search again.

**Crisis turns.** A hard-tier turn never reaches the chat handler
(`turns.ts`), so the person's message is never stored and never indexed. A
soft-tier turn runs normally: its message is stored, stays in the transcript,
and is indexed like any other.

## What takes it out

| When                                                                                         | How                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A message is deleted, including by deleting an exchange (`slots.md`, "Deleting an exchange") | `messageId` → `ai_message`, `ON DELETE CASCADE`             |
| A conversation is deleted (Sunrise's route, retention)                                       | its messages cascade, and their vectors with them           |
| The account is erased (`eraseUser()`)                                                        | `userId` → `user`, `ON DELETE CASCADE`                      |
| The org is deleted                                                                           | `orgId` → `org`, `ON DELETE CASCADE`                        |
| A note version is deleted outright (erasure's cascade to slot values)                        | `slotValueId` → `framework_slot_value`, `ON DELETE CASCADE` |
| A note is removed, or the exchange that wrote it is deleted (`slots.md`)                     | `forgetWipedNotes(tx, …)` in the wipe's own transaction     |
| A note is revised                                                                            | `indexNote()` drops the earlier version's vector            |
| A note stops qualifying any other way (hidden since, a race)                                 | the backfill's prune; a search never returns it meanwhile   |

## Data rights

- **Art. 15:** the `memory` section of the subject-access export lists which of
  the person's messages and note versions are indexed, when, and by which
  model. Never the vector,
  which means nothing to the person it describes; the words are in their
  conversations section (`lib/app/leaf-data-export.ts`).
- **Art. 17:** the `userId` cascade. No erasure hook.
- **Org export:** `appMemoryEmbeddings`, the same entries for every member,
  never the vectors.

## Swapping it for Daybreak's

The table is a leaf stand-in for
[daybreak#287](https://github.com/human-centric-engineering/daybreak/issues/287)
(owner ruling 1). The module's surface mirrors that ask: `indexMessage` /
`indexNote` and their `queue…` forms to add, `searchMemory` to find,
`forgetMemory` / `forgetWipedNotes` to remove. Notes are data-slot values, a
Daybreak element, so this is the half Daybreak will most want back.
When Daybreak's index ships in a release we sync: point those functions at it,
re-embed (or migrate) what this table holds, drop the table and its migration's
objects in a new migration, and delete the drift probes, the always-run
boundary test and the `memory` export sections that name it.
