---
name: app-conversation
description: The conversation pane — the transcript read back through a leaf route with each reply joined to its turn row, the leaf event schema that keeps the crisis frame's resource, the stream client that mints the turn id, and the pacing that makes her reply arrive as typed. What is deliberately absent until t-65, t-66 and t-67.
---

# The conversation — talking to her from the shell

§10 t-64; product description §3.3, §8.1. Before this, `/app` showed the
designed composer with every control disabled and one line saying the
conversation would arrive later. Her seat had been answering since §08 shipped,
and the only thing that called it was a smoke script.

Now a person types, presses Enter, sees their words as a turn, sees her think,
and watches her reply arrive a word at a time. Close the tab and open it again
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
  client.ts                                    streamTurn() · fetchTranscript() · mintTurnId()
  events.ts                                    the leaf SSE event schema
  transcript.ts                                readTranscript() · assembleTranscript()
  copy.ts                                      every word the pane says of its own
app/api/v1/app/conversation/route.ts           GET — the transcript, read back
```

## The transcript read — `GET /api/v1/app/conversation?seat=`

Member only, `no-store`, `ownership: self`. `seat` defaults to `facilitator`
— the seat the pane speaks to in release 1 — and accepts `onboarding` for the
feature that owns it; anything else is a 400. No conversation yet is an empty
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
(the seat unbound, her visibility narrowed, a stage policy) reads as an empty
transcript. The message rows are read through Sunrise's
`conversationVisibilityWhere` — the ownerless-surfaces guard asks for it —
composed with `AND` and narrowed to the caller's own id, so neither the shared
arm nor an admin's ownerless arm can widen a transcript.

**The shape:**

```ts
{ seat, conversationId: string | null, entries: TranscriptEntry[] }

{ kind: 'user',  id, text, at, turnId: string | null }
{ kind: 'reply', id, text, at, turnId, citations, turn: TurnAccount | null }
// TurnAccount: turnId, seat, status, attempts, modelId, providerSlug,
//   fingerprintVersion, inputTokens, outputTokens, costUsd (null = unpriced,
//   never 0), pricing, errorCode, startedAt, completedAt
```

`turn` is `null` on a reply written before the seam existed. A tool-using
turn writes one assistant row per pass; consecutive assistant rows become one
reply whose `id` is the last row's — the terminal row the turn names and the
one carrying the citations — joined the way `readTurnReply` joins them.

### Two corrections the platform cannot make

Both recorded on this feature by §08 ([`agent.md`](./agent.md) → "What a
second request with the same id gets", "The deadlines"):

- **A retried failed turn writes the person's message twice.** The platform
  writes it before every model call and offers no way to reuse the first.
  Consecutive user rows with the same `metadata.app.turnId` collapse to one —
  the row the turn row points at, which is the attempt that ran.
- **A timed-out turn leaves the platform's error-marker row** —
  `[An error occurred and the response could not be completed.]`,
  `metadata.error: true`. Not her voice; dropped. The turn row's `errorCode`
  is the record.

Both are pure (`assembleTranscript`) and pinned in
`tests/unit/lib/app/conversation/transcript.test.ts` against fixtures that
first show the thing corrected is there.

## The turn — `streamTurn()`

`POST /api/v1/framework/facilitation/facilitator/chat/stream` with the seam's
shape, `{ message, turnId }`. The client never handles a conversation id;
resume-by-context is the route's.

**The turn id is minted in the browser** (`crypto.randomUUID()`), once per
message, and kept with the message until the turn ends. That is what makes
"try again" safe (§08 t-54): a failed or timed-out turn re-runs under it, a
completed one replays with no second model call. The retry itself is t-65's.

**A refusal is not a stream.** `404` (no surface), `409` (`TURN_IN_FLIGHT`,
`TURN_ID_REUSED`) and `429` arrive as JSON envelopes; `streamTurn` reads the
status before touching the body and throws `TurnRefused` with the envelope's
`details.reason` or `code`. t-64 renders any refusal as the `unavailable`
ending; t-65 gives each its words.

**A stream that closes with no terminal frame** — a connection that dropped —
is also `unavailable` here. The turn carries on server-side and is recorded
`completed` (§08 t-55), so the id can be sent again for the whole answer.

## The event schema — `events.ts`

The leaf's own, over Sunrise's `lib/api/sse-parser.ts`, and **not** Sunrise's
`parseChatStreamEvent`: Zod objects are non-strict, so a field the admin schema
does not model is silently stripped — and the crisis frame's `resource`
([`safety.md`](./safety.md) → "The client frame") is exactly such a field.
Pinned: `tests/unit/lib/app/conversation/events.test.ts` runs the same frame
through both parsers and asserts only ours keeps it.

What her seat can send is narrower than the platform's union, because every
frame passes `toClientStream()` first: `error` is one of the endings or
`crisis`, never a platform code; `budget_exceeded_per_turn` never arrives;
nothing on her seats requires approval. Those variants are not modelled. An
unrecognised frame is `null` — skipped, never fatal. A `resource` that is not
the authored shape drops to `undefined` and the frame still arrives, because
`message` is the whole resource as text.

## What the pane does with each frame

| Frame                                   | Then                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `start`                                 | the draft clears — the words leave the box only once the server has them (§8.1)     |
| `content`                               | her words grow; the thinking row becomes her bubble on the first one                |
| `warning` `still_thinking`              | the thinking row's label changes; no second frame                                   |
| `warning` with `resource` (soft crisis) | kept on the live turn and the finished reply; rendered by t-65                      |
| `status`                                | the platform's operator strings — never shown                                       |
| `capability_result(s)`                  | slugs collected for the drawer (t-66)                                               |
| `citations`                             | carried on the reply (t-66)                                                         |
| `content_reset`                         | her words start over                                                                |
| `done`                                  | the live turn folds into `entries` as a reply, with an account built from the frame |
| `error`                                 | an `ending` entry with the frame's words; t-65 makes it hers and retryable          |

The account built live from `done` carries model, provider, tokens and
`costUsd`; `fingerprintVersion` and `pricing` are `null` until the read route
has them on reload — the frame does not carry either.

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
whole (`streamed` is not on them).

**Reduced motion** shows her words as the server paces them, which is still
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
not — a person can draft their next thought while she answers.

An unmount aborts the in-flight request. The turn carries on server-side and
is recorded, so closing the tab loses nothing.

## The copy

Every word the pane says of its own is in `lib/app/conversation/copy.ts` —
one module, so a locale can replace it later rather than being retrofitted
across components (§11: externalised strings from the first line). Her
replies are not there; they are hers. The endings in her register and the
banner are t-65's and will sit beside these.

## What is deliberately absent

- **The timestamp and one-line account under a reply** — t-66. The prototype
  renders `.disclose` only when a turn has `meta`, which no turn has until the
  account exists. `ReplyTurn` takes `children` for it.
- **The endings in her words, retry, the crisis resource rendered, the
  banner** — t-65. t-64 shows the neutral copy the ending frame carries, in the
  muted ink, and offers nothing.
- **The microphone** — t-67. Still disabled, still labelled as arriving with
  the conversation.
- **Pinning a reader who has scrolled up** — the transcript follows the foot
  on every change, as the prototype's `scrollLog()` does. A reader re-reading
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

| Where                                                            | Proves                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/lib/app/conversation/events.test.ts`                 | Every frame her seat sends parses; the crisis `resource` survives where Sunrise's parser strips it (asserted on both); a malformed resource drops to nothing and the frame still arrives                  |
| `tests/unit/lib/app/conversation/transcript.test.ts`             | The join; the doubled user row collapsed and the marker row hidden, each against a fixture that first shows it present; passes joined; pre-seam rows carried; the read under the caller's id, both tables |
| `tests/unit/lib/app/conversation/client.test.ts`                 | The seam's request shape; frames out of a byte stream split mid-frame; unknown frames skipped; a refusal thrown before any frame with the envelope's reason                                               |
| `tests/unit/app/api/v1/app/conversation/route.test.ts`           | Auth, the seat vocabulary, `no-store`, empty-not-404, another person's conversation unreachable by construction, the words never logged                                                                   |
| `tests/unit/components/app/conversation/use-typed-text.test.tsx` | The pace, the half-word held back, the pace kept across fast chunks, a replaced text starting over, reduced motion whole                                                                                  |
| `tests/unit/components/app/shell/conversation-pane.test.tsx`     | Enter sends and Shift+Enter does not; the box clears on `start`; the thinking row until first words and its label at `still_thinking`; status strings never shown; reduced motion; `inert` off-screen     |
| `scripts/app/smoke-turn.ts` (step 3c)                            | After a real turn, `/api/v1/app/conversation` returns that turn — the person's message with its id, her reply word for word, joined to its row with model, fingerprint version, seat and cost             |

## See also

- [`agent.md`](./agent.md) — the turn seam, the endings, the status read, the meter
- [`safety.md`](./safety.md) — the crisis frame this schema keeps whole
- [`shell.md`](./shell.md) — the pane's place in the shell, and D6
