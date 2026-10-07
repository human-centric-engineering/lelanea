---
name: app-conversation
description: The conversation pane — the transcript read back through a leaf route with each reply joined to its turn row, the leaf event schema that keeps the crisis frame's resource, the stream client that mints the turn id, the pacing that makes the reply arrive as typed, what the pane does when the agent can't answer, the account under every reply — composed from parts, the seam §11 and §13 add to — and the microphone: a voice note transcribed and discarded, the route, its two switches, and what happens to the audio (nothing).
---

# The conversation — talking to the agent from the shell

§10 t-64; product description §3.3, §8.1. Before this, `/app` showed the
designed composer with every control disabled and one line saying the
conversation would arrive later. The guide's seat had been answering since §08 shipped,
and the only thing that called it was a smoke script.

Now a person types, presses Enter, sees their words as a turn, sees the agent
think, and watches the reply arrive a word at a time. Close the tab and open it again
and the whole conversation is there.

## The pieces

```
components/app/shell/conversation-pane.tsx     the pane; calls useConversation ABOVE its folded return
components/app/conversation/
  use-conversation.ts                          state: entries, the live turn, the draft, send()
  transcript.tsx                               the scroll container and the turns, one flat keyed list
  turns.tsx                                    UserTurn · ReplyTurn · ThinkingRow · EndingRow · HerMark
  composer.tsx                                 the card, live: Enter sends, Shift+Enter breaks a line
  use-typed-text.ts                            the word-at-a-time reveal
  turns.module.css                             `rise` and the thinking dots' `breathe`
lib/app/conversation/
  client.ts                                    streamTurn() · streamOpening() · fetchTranscript() · mintTurnId()
  events.ts                                    the leaf SSE event schema
  transcript.ts                                readTranscript() · assembleTranscript()
  opening.ts · opening-id.ts                   the AI's opening after onboarding (t-122)
  recap.ts · recap-account.ts                  the recap that opens each new session (f-recap t-142)
  copy.ts                                      every word the pane says of its own
app/api/v1/app/conversation/route.ts           GET — the transcript, read back
app/api/v1/app/conversation/opening/route.ts   POST — the AI's opening or a recap, streamed (t-122, t-142)
```

## The transcript read — `GET /api/v1/app/conversation?seat=`

Member only, `no-store`, `ownership: self`. `seat` defaults to `facilitator`
and accepts `onboarding`; anything else is a 400. The pane always names one:
the `onboarding` seat while the discovery questions are ahead of the person,
`facilitator` after (f-onboarding t-105, see
[`onboarding.md`](./onboarding.md#the-conversation-mirrors-the-answers-back-t-105)). No conversation yet is an empty
transcript with `conversationId: null`, **not a 404**: the pane renders either
way.

**Why a leaf route.** Sunrise's `GET /api/v1/chat/conversations/:id/messages`
returns `id/role/content/createdAt` and nothing else, and a member has no way
to learn the surface conversation's id in the first place. Everything the
drawer (t-66) needs — model, provider, fingerprint version, seat, tokens,
cost and whether it was priced, the error code — is on `app_turn` (§08 t-54),
joined to the message rows by `userMessageId` / `assistantMessageId`.

**Which conversation.** The one the next turn would resume:
`resolveFacilitationSurface`, the same door the stream route opens. No surface
(the seat unbound, the agent's visibility narrowed, a stage policy) reads as an empty
transcript. The message rows are read through Sunrise's
`conversationVisibilityWhere` — the ownerless-surfaces guard asks for it —
composed with `AND` and narrowed to the caller's own id, so neither the shared
arm nor an admin's ownerless arm can widen a transcript.

**The shape:**

```ts
{ seat, conversationId: string | null, entries: TranscriptEntry[],
  opening?: boolean, openingTurnId?: string }

{ kind: 'user',  id, text, at, turnId: string | null }
{ kind: 'reply', id, text, at, turnId, citations, turn: TurnAccount | null }
// TurnAccount: turnId, seat, status, attempts, modelId, providerSlug,
//   fingerprintVersion, register, registerSource, leanings, recap, inputTokens, outputTokens,
//   costUsd (null = unpriced, never 0), pricing, errorCode, startedAt, completedAt
```

`opening` is on the facilitator seat only: whether the pane should ask for the
AI to speak first now, and `openingTurnId` the id it will run under. On an
empty transcript that is the welcome, when `openingDue` says so
([`onboarding.md`](./onboarding.md#the-ai-opens-the-first-conversation-t-122));
on a conversation under way, the recap, when `recapDue` says so
([below](#the-recap--the-ai-opens-each-new-session-f-recap-t-142)).

`turn` is `null` on a reply written before the seam existed. A tool-using
turn writes one assistant row per pass; consecutive assistant rows become one
reply whose `id` is the last row's — the terminal row the turn names and the
one carrying the citations — joined the way `readTurnReply` joins them.

### Two corrections the platform cannot make

Both recorded on this feature by §08 ([`agent.md`](./agent.md) → "What a
second request with the same id gets", "The deadlines"):

- **A retried failed turn writes the person's message twice.** The platform
  writes it before every model call and offers no way to reuse the first. A
  user row whose `metadata.app.turnId` matches the most recent user entry —
  looked for past any reply rows, since a tool-using turn that failed at its
  second pass leaves its first pass's fragment behind — replaces that entry
  and everything since it, when it is the row the turn row names: the attempt
  that ran.
- **A timed-out turn leaves the platform's error-marker row** —
  `[An error occurred and the response could not be completed.]`,
  `metadata.error: true`. Not a reply; dropped. The turn row's `errorCode`
  is the record.
- **A turn that failed on a later pass leaves its earlier passes' rows.** A
  tool-using turn persists one assistant row per pass; failing at the second
  leaves the first's fragment with no reply linked to it. Fragments of a turn
  row settled `failed` with no reply linked are dropped rather than shown as a
  finished, accountless answer — except `reply_not_linked`, where the agent
  answered and only the link failed. A turn still `running` keeps its rows too:
  its final row is written a moment before the link. Pre-seam rows have no turn
  row and are kept.

The AI's opening after onboarding (t-122) needs no correction: the agent
opens it through Sunrise's `openingTurn`, so it has no user row, and its reply
stands first, joined to its turn row by `assistantMessageId`. A session recap
(t-142) has no user row either, and lands mid-conversation, so it is placed by
its window: see [the recap](#the-recap--the-ai-opens-each-new-session-f-recap-t-142).

All are pure (`assembleTranscript`) and pinned in
`tests/unit/lib/app/conversation/transcript.test.ts` against fixtures that
first show the thing corrected is there.

## The recap — the AI opens each new session (f-recap t-142)

Product description §3.8: a person who told her something specific last week
is met with it this week, and never asked it again. Owner ruling, 6 Oct 2026
(journalled on f-recap): the recap is the **facilitator's own opening turn**,
one per new session. It does not use the `synopsis` seat or
`get_progress_synopsis`, which stay free for f-journey-record's session
synopses. `lib/app/conversation/recap.ts` builds it on the welcome's mechanism
([`onboarding.md`](./onboarding.md#the-ai-opens-the-first-conversation-t-122)),
so it is a turn through `runFacilitationTurn`: metered, deadlined, recorded,
crisis-screened, steered to the seat's register and leanings, and opened
through `openingTurn` with nothing stored in the person's name.

**Once per session, keyed on the turn id.** It runs under
`recapTurnId(session.id)` (`app_recap_v1_<session id>`, `opening-id.ts`), so
the ledger gives it once per sitting: a reload replays the recorded reply with
no model call, a second tab is `turn_in_flight`, and a failure runs again, at
most `MAX_OPENING_ATTEMPTS` times. The hook hashes and screens the fixed
`RECAP_MESSAGE` alone, so a re-run whose material has moved on is still the
same turn. New words need a new version in the id, as the welcome's do.

**When it is owed** (`planRecap`; `recapDue` adds "someone to speak, and its
reply not already in the transcript" — completed, or `reply_not_linked`, which
the transcript shows; a running one is still offered, so the pane adopts its
replay. The route refuses a `reply_not_linked` one too, whichever tab asks):

- the facilitator seat, past the gate, handed off;
- a session in which **nothing has been said yet** on the seat: no turn
  stamped with it other than the recap, no message of the person's since it
  began (a turn whose arrival failed is stamped with none), and no crisis
  answered since. Whoever speaks first in a sitting, it is never the recap
  after them; the pane also lets it go when the person sends first;
- an **earlier session with an exchange**: a completed turn, stamped with an
  earlier session, that answered a message of theirs. The latest such session
  is the one looked back to, so a sitting where they only looked in is passed
  over rather than recapped as empty.

The first-ever arrival has no earlier exchange, so it keeps the welcome; the
two never compete. The transcript read asks the welcome first on an empty
transcript and the recap otherwise — an empty one too, since a conversation the
person deleted leaves their sessions behind it. The recap checks "said in this
session" first, alone, because that one query answers most reads.

**What it carries** travels with the turn as its system message, after
`RECAP_MESSAGE`, because the context block is cached per person for a minute
and never sees the turn. It is read inside the turn's run, which the hook calls
only for the request that claimed it, so a replay or an in-flight refusal reads
none of it. Read for this person only, fenced, and bounded (`MAX_RECAP_*`):

| Material                      | Read from                                                                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The account they kept         | that session's kept synopsis (`readKeptSynopsisOfSession`, f-journey-record t-149): its line, its account and its outcomes, each on one unquoted line, cut, and said to be an account and not their words. When there is one, it stands in for their raw words |
| Their own words, oldest first | only when they kept no account of that session: the user messages of their turns stamped with it, joined under their own conversation; the latest few (`MAX_RECAP_MESSAGES`), each cut                                                                         |
| Notes captured since          | `getNotes()`, so hidden slots and leanings are already gone; removed notes left out; the stored reading on one line, so a special-category one is its sentinel and none can forge a `> ` line                                                                  |
| The journey since             | `node_entered` / `node_completed` in `framework_journey_event` since that session began; "began" / "moved on from" a module, never "completed" (§6.12)                                                                                                         |

A deleted exchange's words are gone from the message table, so they never
come back here. The material is reference, not instructions, and the ask says
so; the fence markers are stripped from anything the person wrote, the kept
account included.

**What they kept stands in for what they said** (f-journey-record t-149; owner
ruling 4 at planning). The raw words were f-recap's deterministic stand-in
until the record existed. Now, when the person kept an account of the session
looked back to, the recap reads that instead: they approved it, or rewrote it,
so it is what they hold to be true of that session. **It is never put on a
`> ` line.** The fixed ask quotes "their words" from those lines only, and a
kept account is often her draft kept as written, so quoting it as something
they said would put her words in their mouth (review round 1). It is carried as
reference, said to be an account and not their words, for the recap to name in
its own words; the ask is unchanged and the ledger's hash still holds. Known
limit: the ask still says to quote, so a recap may quote an outcome's phrase
anyway (seen once in the smoke). Changing the ask means a new version in the
recap's turn id. Never read:

- **a draft**, which is not in the record until they keep it;
- **an account flagged as written from an exchange they have since deleted**
  (`sourceRemovedAt`), which may quote what they deleted. It waits for them to
  change it, which clears the flag. Meanwhile the recap falls back to their
  words, and the deleted ones are gone from those already.

Another person's account is never read, even one naming the same session id:
the read names the person.

**The framing** (`RECAP_MESSAGE`): quote a few of their words exactly, from the
`> ` lines only; say briefly what changed; ask one open question about what has
shifted; never ask for anything the notes hold; no list, no dates.

**Nothing understood invisibly.** What it drew on — the session's start,
whether it drew on the account they kept or their words (`source`; an account
stored before t-149 has none and reads as words), how many of their messages,
the notes' headings and how many journey steps, never the material — is kept
on `app_turn.recap` (`recapAccountSchema`) by the
request that claimed the turn, sent on its `done` frame, and read back on
reload. The account under the reply leads with it: "Opened this session with a
recap of the last one, drawing on…" (`account.ts`). A replay says what the
answering attempt drew on, not what the material says now.

**In the transcript.** A recap has no row of the person's before it and lands
below the last session's reply, so `assembleTranscript` places it by its window:
from its claim (less `NO_USER_ROW_GRACE_MS`, which the reply lookup grants it
too) to its linked reply, or to when it failed, and never past the person's
next message. Its rows are its own reply, never the tail of the one above; a
failed recap's rows are dropped; and once a reply's terminal row is read, any
assistant row before the person speaks again is an earlier attempt's fragment
and is dropped.

**The pane** takes the id from `openingTurnId` and runs it when idle, below
what is there. A reply that lands replaces whatever the read showed of it — a
recap still running when the pane was read has its rows so far in the read, and
the replay it is answered with is the whole of it; one that does not land takes
nothing away. A dropped connection reads the transcript again and adopts it
whole, provided the pane still holds what it held when it asked.

**Not yet:**

- A tab left open across the gap is not recapped: the recap is decided on the
  pane's read, and the person's next turn then speaks first.
- Deleting the last exchange of a session (t-127) deletes the recap after it
  too: an exchange's window runs to the person's next message, and the recap
  sits inside it.
- A failed recap attempt's fragment, re-run, joins the reply above it when that
  reply has no linked final row (`reply_not_linked`). Bounding it needs the
  message clock compared with the settle clock, which `turn-record.ts` warns
  can skew and drop a real reply; three rare conditions together did not earn
  that risk (code review round 1).
- A member's own turn may use a recap's id (`openingTurnId` is in the read),
  which spoils that session's recap and groups that turn as one. It touches
  only their own conversation. Refusing the reserved prefixes belongs in the
  turn hook, which must still accept them from the opening and recap routes
  (code review round 3).
- If the session looked back to has lost its started row (f-forget-session),
  no earlier session is tried: the recap waits for the next exchange. Whether a
  forgotten session leaves a tombstone is f-forget-session's decision.
- The material is the person's own words and notes, in their own
  conversation, framed as reference in the turn's system message, which
  Sunrise's input guard does not scan for an opening turn (as for the welcome).

**Proved on a real database** by `npm run smoke:app-recap`: a first session
with a real turn and a note, moved thirteen hours back; the next arrival opens
a second session and owes the recap; the real hook and model quote what they
said and do not ask for the note; the row keeps the account; the transcript
stands it as its own reply with the account naming it; asked again, it replays
with no second model call. Then (t-149) they speak in the second session and an
account of it is drafted: the third session's material does not read the
draft. Once they keep it, the material carries it, on no quotable line,
instead of their words; it is in the memory index and search finds it on
Postgres (which proves the version stamp round-trips); and the real model's
recap names a phrase only the kept account holds.

## The turn — `streamTurn()`

`POST /api/v1/framework/facilitation/facilitator/chat/stream` with the seam's
shape, `{ message, turnId }`. The client never handles a conversation id;
resume-by-context is the route's.

**The turn id is minted in the browser** (`crypto.randomUUID()`), once per
message, and stays bound to the words. That is what makes "try again" safe
(§08 t-54): a failed or timed-out turn re-runs under it, a completed one
replays with no second model call. See
[When the agent can't answer](#when-the-agent-cant-answer--in-the-pane) for the retry.

**A refusal is not a stream.** `404` (no surface), `409` (`TURN_IN_FLIGHT`,
`TURN_ID_REUSED`) and `429` arrive as JSON envelopes; `streamTurn` reads the
status before touching the body and throws `TurnRefused` with the envelope's
`details.reason` or `code` (the two reasons are in the import-light
`lib/app/agent/turn-codes.ts`, so the browser can branch on them without the
turn seam's Prisma import).

**A stream that closes with no terminal frame** — a connection that dropped —
is `unavailable` here. The turn carries on server-side and is recorded
`completed` (§08 t-55), so the same id gets the whole answer.

**The status read** — `GET /api/v1/app/agent/status` → `available |
unavailable | paused` — is `fetchGenerationStatus()`, asked on mount and after
every ending, never on a timer.

## The event schema — `events.ts`

The leaf's own, over Sunrise's `lib/api/sse-parser.ts`, and **not** Sunrise's
`parseChatStreamEvent`: Zod objects are non-strict, so a field the admin schema
does not model is silently stripped — and the crisis frame's `resource`
([`safety.md`](./safety.md) → "The client frame") is exactly such a field.
Pinned: `tests/unit/lib/app/conversation/events.test.ts` runs the same frame
through both parsers and asserts only ours keeps it.

What the agent's seats can send is narrower than the platform's union, because every
frame passes `toClientStream()` first: `error` is one of the endings, `crisis`
(with its `resource`) or `ceiling_reached` (with its `ceiling` figures), never
a platform code; `budget_exceeded_per_turn` never arrives;
nothing on the agent's seats requires approval. Those variants are not modelled. An
unrecognised frame is `null` — skipped, never fatal. A `resource` that is not
the authored shape drops to `undefined` and the frame still arrives, because
`message` is the whole resource as text.

## What the pane does with each frame

| Frame                      | Then                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`                    | the draft clears — the words leave the box only once the server has them (§8.1)                                                                                                                                 |
| `content`                  | the reply grows; the thinking row becomes its bubble on the first one                                                                                                                                           |
| `warning` `still_thinking` | the thinking row's label changes; no second frame                                                                                                                                                               |
| `warning` `crisis` (soft)  | the authored `resource` laid out as an `alert` row ahead of the reply, live and once folded; its `message` — the whole resource as text — where the resource did not parse                                      |
| `status`                   | the platform's operator strings — never shown                                                                                                                                                                   |
| `capability_result(s)`     | slugs collected for the drawer (t-66); an answering `fill_slot` also arms the notes refresh below (t-73); an answering `suggest_resource` carries the offered resource as `data`, collected for the chip (t-77) |
| `citations`                | carried on the reply (t-66)                                                                                                                                                                                     |
| `content_reset`            | the reply starts over                                                                                                                                                                                           |
| `done`                     | the live turn folds into `entries` as a reply, with an account built from the frame; the notes panel is told, if the turn wrote (t-73)                                                                          |
| `error`                    | an `ending` entry: the words back in the box, bound to the turn id, and the ending's words where the reply would have been (below); a hard `crisis` frame lays the resource out instead                         |

The account built live from `done` carries model, provider, tokens,
`costUsd`, and the turn's `register` and `registerSource` (the leaf's own
fields on the frame, f-registers t-125; the detail's "Began in a … register"
sentence); `fingerprintVersion` and `pricing` are `null` until the read route
has them on reload — the frame does not carry either. A `costUsd` of `0` on
the frame (what a replay says for an unpriced turn) is recorded as `null`,
never `0`: zero reads as free, and only the turn row knows.

## When the agent can't answer — in the pane

§10 t-65; product description §8.1; the contract is
[`agent.md`](./agent.md#the-endings--what-f-conversation-builds-against).

**The words go back into the box, not into the transcript as well.** §8.1: _a
message that fails to send stays in the box, retryable, with the conversation
intact around it._ On any ending the box gets the words back (`start` had
cleared it) and the ending row stands where the reply would have been — no
bubble, which would show the words twice. The one exception is a box already
holding a newer thought: that draft is left alone, and the failed words stay in
the transcript as their bubble, so they are never nowhere.

**A second try is the same turn.** The id stays bound to the words
(`kept` in `useConversation`); `send` with the same words posts the same id,
and the earlier attempt's ending row is removed — the retry supersedes it, as
the transcript read collapses the attempts to one. Different words are a
different turn and mint a new id, which is why `TURN_ID_REUSED` cannot happen
from this client; if it ever does, it reads as `unavailable` and the id is
dropped.

| The turn ended on                      | The row says (`CONVERSATION_COPY`)                  | The id                          |
| -------------------------------------- | --------------------------------------------------- | ------------------------------- |
| `unavailable`                          | `endings.unavailable`                               | kept                            |
| `timed_out`                            | `endings.timed_out`                                 | kept                            |
| `paused`                               | `endings.paused`                                    | kept                            |
| `not_sent`                             | `endings.not_sent` — no retry offered               | dropped                         |
| `409 TURN_IN_FLIGHT`                   | `stillWorking` — the agent is still on it           | kept, no new one minted         |
| `409 TURN_ID_REUSED`                   | `endings.unavailable`                               | dropped                         |
| a network failure, or a dropped stream | `endings.unavailable`                               | kept                            |
| `ceiling_reached`                      | `ceilingEnding(figures)` — spent, limit, reset date | kept — a replay is still served |
| `crisis` (hard)                        | the resource, laid out                              | kept                            |

**The copy is in Lelañea Fulton's register, in one module** (`lib/app/conversation/copy.ts`
→ `endings`, `stillWorking`, `banner`): short sentences, one thought to a line
(each `\n` is a beat and is rendered as its own line), no stacked apology, the
next move handed back. Like the voice core, these are proposals in her register
until Lelañea Fulton has read them. The frame's neutral words stay on the entry as the
fallback for a code the pane does not know.

**The monthly limit is the fifth ending, and a function** (`ceilingEnding`,
f-budget t-96), because the frame carries figures. Three beats like the others:
what was spent against the limit, the date replies return (the reset, read in
UTC), and that the words are still in the box and everything readable and
writable still works — the part a person will not assume. **Explain and
wait**: no control is drawn beside it and nothing invites a reply, because
there is no "ask for more" behind either (owner, 22 Sept 2026; `B31`).

- **A date is named only where the month keeps the promise.** A limit of
  nothing — `isNothingLimit` in `lib/app/agent/endings.ts`, the gate's own
  `<= 0`, shared with the frame's neutral copy — ends the turn on the same frame
  with next month's `resetsAt`, but the limit is a setting and will be the same
  on the 1st, so "I can reply again from 1 October" would be false. It says the
  limit is set to nothing. **Not** "prints as `$0.00`": the gate lets a turn
  start under any positive limit, so a $0.004 limit does bring a reply back
  after the reset.
- **What the amounts say is one function, `ceilingAmounts`** (`endings.ts`,
  t-140), asked by the neutral words and `ceilingEnding` alike, so the two
  cannot disagree:
  - **Spend with no price on file reads "at least".** The gate carries the
    month's `unpricedRows` onto the frame; above zero, `ceilingEnding` says "at
    least $4.07 of your $4.00 limit" and the frame "(at least $4.07 of
    $4.00)" — the same floor rule as every other figure of spend (`budget.md`,
    ruling 4). An absent or unusable count reads as a floor too:
    "at least" is true of an exact figure, and an exact figure may be short.
  - **A limit under half a cent is not stated**, because it prints as `$0.00`:
    the spend is, "against a limit of less than a cent". The crossing turn
    completes, so that spend can be a real $0.12. A spend under half a cent
    states no amounts at all. The date stays either way, for the reason above.
- **Without the limit, the frame's own words.** `ceilingEnding` returns `null`
  when the limit did not parse, and the row shows the frame's `message` — built
  by the server from figures it knew, true, and naming them and the date. The
  ending's own words without the limit could not tell a limit of nothing from a month used
  up.
- **Every figure is optional, one at a time.** `ceilingFiguresSchema` in
  `events.ts` validates each figure on its own — an amount must be a
  non-negative number, the reset an ISO instant — and drops only the one that
  fails; `useConversation` keeps what arrived on the entry as `ceiling`. An
  unknown spend costs the amounts and keeps the date; an unknown reset falls
  back to "the start of next month". The row never prints `$undefined` or
  `Invalid Date`. The validation is there once; `ceilingEnding` trusts it.

**The crisis resource is laid out verbatim** (`CrisisRow`): the intro, every
service — name, contact (a link where the file gives a URL), hours — the
emergency line, and on a hard frame the `keptMessage` line. Nothing is
rewritten: these are the words a person reads at the worst moment they will
bring to the app, and they wait on Lelañea Fulton's sign-off as they are
([`safety.md`](./safety.md#the-client-frame--what-f-conversation-builds-against)).
A hard frame ends the turn before `start`, so the box never emptied; a soft
frame's resource stands ahead of the agent's turn, live and once folded. Where the
frame's `resource` did not parse, its `message` — the whole resource as text —
is shown instead, so a shape mismatch never costs the names and numbers.

**The line above the composer** (`StatusLine`): one line in the muted ink at
the transcript's measure, no red, no icon, a `status` region. `paused` and
`unavailable` from the status read show it; `available`, or a turn that
completes, clears it. Asked on mount and after every ending; there is no
interval, and a test reads the hook's source to say so.

## The account under a reply

§10 t-66; product description §3.3 (the worked example is the register);
guardrail _"nothing is understood invisibly"_. Under every completed reply,
once it has been shown to its end: the time, one line saying what the turn
did, and a chevron to the detail (`AccountRow`; the prototype's `.disclose` /
`.detail`). **Collapsed by default** (owner ruling, 19 Sept 2026) — open, a
transcript reads as a trace.

**Composed from parts — the seam §11 and §13 add to.** `lib/app/conversation/
account.ts` holds a list of sources, `ACCOUNT_SOURCES`, each a small function
from the reply's data (`AccountInput`: when, the capabilities called, the
citations, the resources offered, the turn row) to one `AccountPart` — a
clause for the line and a sentence for the detail. `accountLine` joins the
clauses; `accountDetail` puts one sentence to a line and the figures last.
Modules instructed (§13) add a source; the row does not change.

| The turn…                             | Line                                               | Detail                                                                           |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| called `search_knowledge_base`        | Looked something up in her material                | …and drew on N passages of it. (the citations on the reply)                      |
| called `get_state`                    | Looked at what is already understood about you     | the same                                                                         |
| called `fill_slot`                    | Added something to what is understood about you    | …You can see it, and correct it.                                                 |
| called `suggest_resource` (t-77)      | Pointed you to “<title>”                           | …— a video / an audio piece / an article of hers you can open beside this reply. |
| …for an id the library has since lost | Offered something that is no longer in her library | the same                                                                         |
| called a capability with no words yet | Used <slug, as words>                              | the same — named, never hidden                                                   |
| called nothing                        | Nothing was written from this turn                 | the same, as a sentence                                                          |

**The offer itself is a chip under the reply** (`SuggestionChips` in
`turns.tsx`), before the account row: the library's title, its kind and its
length, on a button that opens the resources drawer pinned to it
(`openDrawer('resources', { pin })`, [`shell.md`](./shell.md)). Live, the
suggestion is read off the `capability_result` frame's `data`
(`lib/app/resources/suggestion.ts`, import-light for the browser); on reload,
the transcript read resolves it from the trace's `arguments.id` against the
library (`suggestionsFromProvenance`); on a replay, `readTurnReply` resolves
per call and the replay puts the record back on that call's frame, aligned, so
all three paths give the same chip. Nothing the model wrote reaches any of
them.

**Which capabilities answered the turn, on all three paths.** Live, from the
`capability_result(s)` frames. On reload, from the terminal assistant row's
`provenance.capabilityCalls` — one trace per call the model made, `slug` and
`success` and a truncated preview, written always-on by the platform as its
audit substrate — which the read already selects, and collapses onto the
reply's `capabilities`. On a replay (the same id sent again after a completed
turn), `readTurnReply` reads the same traces and `replay()` sends them as one
`capability_results` frame ahead of the words, so a replayed reply's account
says what a reload's does. The platform's `tool` rows — whose content is the
whole result, every chunk a search returned — are never selected (review
round 2: they were, for one boolean, on every pane open).

**Only a call that answered counts.** The platform traces every call the
model made, including one it refused (`tool_not_advertised`, a name the model
invented; `tool_unavailable`) or that threw (`execution_error`).
`lib/app/agent/capability-answers.ts` asks `success` of the frame and of the
trace, and a call that did not answer is not something the turn did. Telling
a person a lookup happened when it did not would be the wrong kind of honest
(review round 1). A test proves one fixture gives the same account live and
read back, and that a refused call reaches neither.

**Two figures, one source.** The detail's tokens and cost are the reply's:
the `done` frame's `tokenUsage` / `costUsd` live, and the turn row's copy of
the same on reload — `turns.ts` records the frame's figure, so the two are
equal by construction (the task's hypothesis, answered from the code rather
than a smoke: `buildDoneEvent` prices the terminal model call). Neither
carries the side costs — a search's embedding, a summary — which only
`GET /api/v1/app/usage/turns/:turnId` sums. So the detail says _"This turn
used about 4,100 tokens and cost $0.01."_ — the reply, not a total — and:

- **`unpriced` says the cost is not known.** Never $0, which reads as free
  ([`agent.md`](./agent.md#a-turn-costed-at-nothing)). A `local` model says it
  cost nothing to run, which is a different fact.
- **Under a cent is said as such**; otherwise dollars to the cent.
- **Tokens to two figures** — _about 4,100_, a size rather than a count.
- Live, before the row exists, pricing is unknown and the cost is the frame's.

**Words, not system language.** No model id, no seat, no slug in the line or
the detail; the time is a clock reading in the reader's zone. Asserted on
fixtures where the model and the seat are present in the data.

**No row** under a reply written before the seam (no turn row to account
from), and none under a turn that ended without a reply — an ending is not a
reply.

## The microphone — a voice note, transcribed and discarded

§10 t-67; product description §3.3 (the mic in the composer's foot); owner
ruling 19 Sept 2026: **transcribe and discard, text only, said at the
microphone**. Speech-to-text existed in the platform for the embed widget and
the admin chat, and nowhere for a signed-in member.

**The route.** `POST /api/v1/app/agent/transcribe` — `withAuth`,
`ownership: self`, multipart (`audio`, optional `language`) →
`{ text, durationMs, language? }`. Built from the pieces the two platform
routes use: `enforceContentLengthCap` before the body is read,
`validateTranscribeUpload` (25 MB, audio MIME), the platform's `audioLimiter`
keyed `audio:app:<userId>` — the one expensive sub-flow, and the one case
CLAUDE.md asks a handler to cap itself — `getAudioProvider()`, and one
`logCost` row with the person's id, `operation: 'transcription'`, tagged
`{ seat }` in its metadata (the platform's `logCost` takes `metadata`; the
chat handler's `costLogMetadata` pass-through is not on this path, so the tag
is set here). The validator wants an `agentId`; it is the voice agent's, set server-side,
and a caller's is ignored. Awaited, so the meter has the row before the
person has the words. `GET` on the same route →
`{ voiceInput: 'available' | 'off' | 'no_provider' }`, `no-store`.

**Two switches, both honoured before the provider is asked.**
`AiOrchestrationSettings.voiceInputGloballyEnabled` — an operator's off switch
that needs no deploy; no row means on, the platform's default — and the voice
agent's `enableVoiceInput`. Either off → `403 VOICE_DISABLED`, zero provider
calls, and the microphone is not offered. `no_provider` (allowed, nothing to
transcribe with) → the microphone is not offered either; a POST would be
`503 NO_AUDIO_PROVIDER`.

**The agent's flag is operator-owned** (`fp4`). Seed
`prisma/seeds/app-lelanea/012-agent-voice-input.ts` turns `enableVoiceInput`
on for `lelanea-guide` once, as an entry in its version timeline (the field
is versioned) with `VOICE_INPUT_CHANGE_SUMMARY`, inside one transaction with
the update — the reachability seed's shape. Off with that entry behind it is
an admin who turned it off, and a re-run leaves it alone. A missing agent
throws. **After a deploy: `npm run db:seed` per database.**

**What happens to the audio: nothing.** The clip goes to the provider and
nowhere else — no file write, no row with its bytes, no log line with its
bytes or its text. The route logs the person's id, the provider, the model,
the duration and the byte count. The route's tests assert the single write
and run the platform's `assertNoAudioPersistence` guard over it.

**The control** (`VoiceNote`, `components/app/conversation/voice-note.tsx`),
re-derived from the admin `MicButton` rather than imported (`fp5`): the
mechanism that transfers is the platform's `useVoiceRecording` hook
(`MediaRecorder` lifecycle, a supported MIME, the length clamped at two
minutes, a denied permission told apart from a failed capture); the styling,
the copy and the level meter do not. One disc in the composer's foot: the
mic, a square while recording, a spinner while the words are on their way;
a `status` row beside it says _Recording · 0:12_, _Turning it into words…_,
or why a clip could not be. **The words land at the caret** in the box,
replacing any selection, spaced from what is around them, for the person to
read and edit — **never sent for them**. Its accessible name says the
recording is never kept. A clip shorter than 300 ms — the disc pressed twice
— is not sent.

**Degrading, not erroring.** No `MediaRecorder` → the disabled disc with its
reason as its name. A permission prompt answered no → the disc stays live,
named with that reason, and a press asks again: Chrome reports a _dismissed_
prompt the same way as a refused one, so a disabled disc would lock the
microphone until a reload (review round 1). A clip that could not be
transcribed → the box untouched, the reason in the status row, the disc live
for another go. The two-minute cap is enforced by the control from the hook's
`elapsedMs` — the hook's own auto-stop drops the clip — and a recording under
way can always be stopped, even once a turn is in flight; only _starting_
waits. The words land in whatever the box holds when they arrive, not what it
held at the press. The composer offers the control only when the
route's `GET` says `available`; `useConversation` asks once on mount, and no
answer means not offered.

## The pacing — `useTypedText`

§3.3: "the reply streams, arriving as if typed rather than in a block. Pacing
matters more here than in most products, because a full reply arriving at once
reads as a lecture." A real stream arrives in uneven chunks at uneven
intervals, so the pacing is put back in the view: whatever has arrived is
revealed at the prototype's rate — **26 ms a word, 8 ms a space** (`stream()`
in `lelanea.html`) — and a chunk that lands mid-word waits for the rest of the
word. The reveal keeps its own clock across chunk arrivals, so three chunks in
a millisecond do not become three words in a millisecond.

**It never snaps.** The live turn and the finished reply are the same
`ReplyTurn` with the same React key, in one flat list — a fragment or a second
array beside the map would be a different reconciliation slot, and the same
key in a different slot is a remount. Replies read back on load are shown
whole (`streamed` is not on them) — and so is a reply already shown to its
end: `ReplyTurn` reports `onRevealed`, the hook retires the flag, and the
pane folded and unfolded (which unmounts the transcript) paints the turn
whole rather than typing it out again.

**Reduced motion** shows the reply as the server paces it, which is still
gradual, and never the word-by-word reveal on top. `rise` and the thinking
dots' `breathe` are withheld the same way, with the media query in the CSS
module as the belt to those braces.

## Where the state lives, and why

`useConversation` is called by `ConversationPane` itself, **above** its folded
`return <Strip />`. That return unmounts the transcript and the composer, so
state in either would be lost the moment a person parked the pane
mid-answer. The pane is mounted once, in the `(lelanea)/app` layout, for every
route in the group, so a turn also survives navigating to a module
(reconciliation hypothesis a, confirmed in `panes.tsx`).

One turn at a time: `send()` while one runs is a no-op, as the prototype's
`S.busy` guard makes it; the send control is disabled and says why. Typing is
not — a person can draft their next thought while the agent answers.

An unmount aborts the in-flight request. The turn carries on server-side and
is recorded, so closing the tab loses nothing.

### What a turn changes on the other side (t-73)

The conversation and the workspace are **siblings**, and context flows downward
only — so the two things that pass between them ride on `ShellLayoutProvider`,
which is their nearest common ancestor. Same arrangement as `modulePlace`, and
neither of them is layout; both say so at their declaration.

- **`onSlotsWritten`** — an option on `useConversation`, wired by the pane to
  the provider's `noteSlotsWritten()`. Called **once per turn that wrote a
  note**, whatever it wrote and however it ended: the panel re-reads its whole
  page, so three notes is one refresh, and a turn that captured and then ended
  without a reply has still written. It is read off the `capabilities` list — the
  calls that **answered** — so a `fill_slot` the platform refused arms nothing.
  That makes a note appear beside the words that produced it, inside the same
  turn, which is the whole of §3.3's pairing.
- **`insert` / `onInserted`** — a prop on `Composer`, fed from the provider's
  `ask`. "Ask Lelañea about this" on a note puts its question in the box, through
  the **same `insertAtCaret` the microphone uses**: where those words land,
  whether focus is taken, and what happens to a box already holding something
  all cost review rounds to settle, and a second path would get one of them
  wrong. The composer clears `ask` as it takes it, which is what lets the same
  question be handed over twice.

Both are in [`slots.md`](./slots.md#two-cross-pane-channels-both-on-shelllayoutprovider)
from the notes side.

## The copy

Every word the pane says of its own is in `lib/app/conversation/copy.ts` —
one module, so a locale can replace it later rather than being retrofitted
across components (§11: externalised strings from the first line). The
replies are not there; they are the agent's, in Lelañea Fulton's voice. The
endings in her register, the still-working line and the status line sit beside
the chrome's words.

## What is deliberately absent

- **The running cost total** — f-budget's, in the budget view; the per-turn
  figure sits in the detail (§3.3).
- **The open state of an account row across a fold.** It is component state;
  parking the pane closes every row. Not worth a store.
- **An explanation under a failed turn on reload.** The read route returns the
  person's row of a turn that failed after `start` with no reply under it — the
  turn row's `errorCode` is joined to replies, not to the person's row. The
  words are kept, which is §8.1's floor; saying why nothing follows is not in
  this task.
- **A language hint on the clip.** The route accepts one; the control sends
  none — the provider detects it, and the person's language preference is
  not yet a thing the pane reads. Trigger: a locale feature.
- **Pinning a reader who has scrolled up** — the transcript follows the foot
  on every change, as the prototype's `scrollLog()` does, including each step
  of the paced reveal (`ReplyTurn`'s `onGrow`). A reader re-reading
  an earlier turn is pulled back down when a new word lands; not in this task.
- **Per-place threads.** One conversation, whichever pane is open beside it
  (owner ruling, 19 Sept 2026). The head keeps its "on <place>" label.

## Standing steps this touched

- `VERSIONING.md` — `lib/app/conversation/` added to the Covered list;
  divergences Row 17 bumped to nine rows.
- The ownerless-surfaces guard — the message read goes through
  `conversationVisibilityWhere`, no allowlist entry.
- `tokens-only.test.ts` and `chrome.test.tsx` — every colour and corner is a
  token or the prototype's own arbitrary radius.

## Tests

| Where                                                              | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/lib/app/conversation/events.test.ts`                   | Every frame the agent's seats send parses; the crisis `resource` survives where Sunrise's parser strips it (asserted on both); a malformed resource drops to nothing and the frame still arrives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tests/unit/lib/app/conversation/transcript.test.ts`               | The join; the doubled user row collapsed and the marker row hidden, each against a fixture that first shows it present; passes joined; pre-seam rows carried; the read under the caller's id, both tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/unit/lib/app/conversation/client.test.ts`                   | The seam's request shape; frames out of a byte stream split mid-frame; unknown frames skipped; a refusal thrown before any frame with the envelope's reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests/unit/app/api/v1/app/conversation/route.test.ts`             | Auth, the seat vocabulary, `no-store`, empty-not-404, another person's conversation unreachable by construction, the words never logged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tests/unit/components/app/conversation/use-typed-text.test.tsx`   | The pace, the half-word held back, the pace kept across fast chunks, a replaced text starting over, reduced motion whole                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/unit/components/app/shell/conversation-pane.test.tsx`       | Enter sends and Shift+Enter does not; the box clears on `start`; the thinking row until first words and its label at `still_thinking`; status strings never shown; reduced motion; `inert` off-screen; each ending in the pane's words and never the frame's; the monthly limit with its figures and date, no control beside it, and a sentence when the figures did not parse; the same words sent again as the same id; `TURN_IN_FLIGHT`; a hard frame's every service and the words in the box; a soft frame's resource then the agent's turn; the status line for `paused` / `unavailable`, cleared on `available`; the account row collapsed, opening with `aria-expanded`, the same live and read back, only once the reply is shown, absent on an ending |
| `tests/unit/components/app/conversation/use-conversation.test.tsx` | The id sent, then equal on the retry, for each retryable ending; `not_sent` and `TURN_ID_REUSED` drop it; `TURN_IN_FLIGHT` mints nothing; a newer draft kept; the status read on mount and after an ending, no timer in the source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/unit/lib/app/conversation/opening.test.ts`                  | When the opening is owed (the gate, the hand-off, nothing else said, not yet completed); the turn it runs carries the app's words under the opening's id; the words pass the input guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/unit/app/api/v1/app/conversation/opening/route.test.ts`     | No body read; `opening_not_due` and no surface; no chat sub-cap charged; API keys and signed-out callers refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tests/unit/lib/app/conversation/recap.test.ts`                    | When the recap is owed, one case per rule (the first-ever arrival keeps the welcome; a completed recap is not asked for again); what it carries, for this person only against a second person's rows in the same window; a masked reading stays masked; the fixed ask to the hook and the material to the model; the account kept on the claimed row and sent on `done`, and a replay's from the row                                                                                                                                                                                                                                                                                                                                                            |
| `tests/unit/lib/app/agent/turn-window.test.ts`                     | The welcome and a recap reach back by the grace; a member turn does not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tests/unit/components/app/conversation/transcript.test.tsx`       | A live opening shows the thinking row and no bubble of the person's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tests/unit/lib/app/conversation/copy.test.ts`                     | `ceilingEnding`: the three beats; spend past the limit stated as it is; "at least" when some replies had no price; no amounts under half a cent; the reset read in UTC; a $0 limit with no date; no figures at all; each unusable figure dropping only its own clause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tests/unit/lib/app/agent/endings.test.ts`                         | Each named refusal code maps to `not_sent`; every other platform code does not; no platform text in any frame; the limit frame's "at least", its amounts under half a cent, and the reset day named in UTC on a machine that is not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `scripts/app/smoke-turn.ts` (steps 3c, 4, 6)                       | After a real turn, `/api/v1/app/conversation` returns that turn joined to its row; the down-and-back turn through the pane's own client — the plain ending as it parses it, then the same id running                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## See also

- [`agent.md`](./agent.md) — the turn seam, the endings, the status read, the meter
- [`safety.md`](./safety.md) — the crisis frame this schema keeps whole
- [`shell.md`](./shell.md) — the pane's place in the shell, and D6
