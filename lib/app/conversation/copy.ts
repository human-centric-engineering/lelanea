import { formatResetDay, isNothingLimit, type TurnEnding } from '@/lib/app/agent/endings';
import type { CeilingFigures } from '@/lib/app/conversation/events';
import { money } from '@/lib/app/usage/usage-view';

/**
 * Every word the conversation pane says of its own (§10 t-64, t-65).
 *
 * One module, so a locale can replace it later rather than being retrofitted
 * across components (product description §11: externalised strings from the
 * first line). Her replies are not here — they are hers. What is here is the
 * frame around them: the placeholder, the thinking row, the empty transcript,
 * and — since t-65 — what the pane says when she cannot answer.
 *
 * ## The endings, in her register
 *
 * `endings` replaces the neutral copy the ending frame carries
 * (`lib/app/agent/endings.ts`, the contract: what the person can do, and that
 * thing exists — `HB10`). The register is the voice core's
 * (`seed-data/drafted/lelanea_voice_fingerprint.json` → cadence): short sentences, one
 * thought to a line — each `\n` is a beat and is rendered as its own line —
 * plain about large things, no stacked apology, and it hands the next move
 * back to the person. `stillWorking` is the one refusal a person can meet from
 * this client (`TURN_IN_FLIGHT`: the earlier request is still being answered).
 * The `ceiling_reached` ending is {@link ceilingEnding}, beside them rather than
 * among them: it carries figures, so it is a function and not a constant.
 *
 * These are proposals in her register, not her words, until she has read them
 * — the same standing the voice core has (`provenance.status`).
 */

export const CONVERSATION_COPY = {
  /** The composer's accessible name. */
  composerLabel: 'Message Lelañea',
  placeholder: 'What would you like to talk about today?',
  hint: 'shift + return for a new line',
  send: 'Send',
  sendBusy: 'Send — waiting for her reply',
  /**
   * The microphone (t-67). Its accessible name says what happens to the
   * recording — nothing — because that is the fact a person would want
   * before speaking about their marriage into it (owner ruling, 19 Sept 2026).
   */
  mic: 'Record a voice note — it is turned into text for you to read and edit, and the recording is never kept',
  micStop: 'Stop recording',
  /** The row while recording; the seconds are appended. */
  micRecording: 'Recording',
  micTranscribing: 'Turning it into words…',
  /** The disabled control's reasons — never an error, just why not. */
  micDenied: 'Voice notes need the microphone, and this browser was told no',
  micUnsupported: 'Voice notes need a browser that can record',
  /** After a clip could not be transcribed: the box is untouched; try again. */
  micFailed: "That one couldn't be turned into words. Nothing was kept — try again if you'd like.",
  /** The microphone could not be reached at all — no clip was made. */
  micUnreachable:
    "The microphone couldn't be reached — is another app using it? Try again if you'd like.",
  /** Voice notes were switched off while the pane was open: the control withdraws. */
  micWithdrawn: 'Voice notes are off for now.',

  /** The three-dot row while she has said nothing yet. */
  thinking: 'thinking',
  /** The same row once the first-words deadline has passed. */
  stillThinking: 'still thinking — this is taking a little longer than usual',

  /** The transcript with nothing in it yet. */
  empty: 'This is where you and Lelañea talk. Say whatever is on your mind.',
  /** While the transcript is being read back. */
  loading: 'Finding where you left off…',
  /** The transcript could not be read; the composer still works. */
  unreadable: 'Your earlier conversation could not be read just now. You can still talk to her.',

  /** Accessible name of the whole transcript region. */
  transcriptLabel: 'The conversation so far',
  /** Accessible name of her mark beside a reply. */
  herMark: 'Lelañea',

  /** Accessible name of the row a turn ends on without her. */
  endingLabel: 'The turn ended',
  /** How a turn ended without her, in her register, by the ending's code. */
  endings: {
    unavailable:
      "I can't answer just now.\nWhat you wrote is still in the box — give it a moment, then send it again.\nEverything else here still works.",
    timed_out:
      "That was taking longer than it should, so I stopped.\nWhat you wrote is still in the box. Send it again whenever you're ready.",
    paused:
      'Conversations are paused for now — on purpose, while something is looked at.\nWhat you wrote is still in the box.\nEverything you can read here still works.',
    not_sent:
      "That one couldn't be sent, and sending it again as it is won't change that.\nIt's still in the box. If you'd like, put it another way — I'm here.",
  } satisfies Record<TurnEnding, string>,
  /** A `TURN_IN_FLIGHT` refusal: the earlier request for these words is still being answered. */
  stillWorking:
    "I'm still with what you sent a moment ago.\nGive it a little time, then send it again — you'll have the whole reply.",

  /** The quiet line above the composer, from the status read. One line, no red. */
  banner: {
    paused:
      'Conversations are paused for now, on purpose. Everything you can read here still works.',
    unavailable: 'Lelañea may not be able to answer just now — you can still try.',
  },

  /** Accessible name of the crisis resource row. Its words are authored (safety.md). */
  crisisLabel: 'Somewhere to turn',
} as const;

/** Said on every form of the ending, because it is the part a person will not assume. */
const STILL_WORKS =
  'What you wrote is still in the box, and everything you can read and write here still works.';

/**
 * The monthly-limit ending, in her register (f-budget t-96).
 *
 * The frame (`ceilingReachedFrame`, f-safety t-59) carries what was spent, the
 * limit, and when the month resets — the first instant of the next UTC month.
 * Three beats, as the other endings have: what happened, with the figures;
 * when she can answer again; and that nothing else has stopped.
 *
 * **Explain and wait.** No "ask for more", no invitation to reply: there is no
 * mechanism behind either (owner, 22 Sept 2026; `B31`; `agent.md`, "The
 * monthly limit"). The words say what is true and hand nothing back that
 * reaches no one.
 *
 * **A date is named only when it is a promise the month keeps.** A limit of
 * nothing (`isNothingLimit`, the gate's own `<= 0`) ends the turn on the same
 * frame with next month's `resetsAt`, but it is a setting and will be the same
 * on the 1st, so it gets no date.
 *
 * **Without the limit there are no words of hers — `null`.** The row then
 * shows the frame's own message, which the server built from figures it knew
 * and which names them and the date truthfully (it asks `isNothingLimit` too).
 * Anything she could say without the limit would say less than that, and
 * could not tell a limit of nothing from a month used up (/code-review round 2).
 *
 * **The other figures are optional, one at a time.** `events.ts` validates each
 * on its own and drops only what is unusable: an unknown spend costs the
 * amounts and keeps the date; an unknown reset falls back to "the start of next
 * month". Never `$undefined`, never `Invalid Date`.
 *
 * A proposal in her register until she has read it, like everything above.
 */
export function ceilingEnding(figures: CeilingFigures | undefined): string | null {
  const spent = figures?.spentUsd;
  const limit = figures?.ceilingUsd;
  const resetsAt = figures?.resetsAt;

  if (limit === undefined) return null;
  if (isNothingLimit(limit)) {
    return `Your limit for conversations is set to nothing at the moment, so I can't reply.\n${STILL_WORKS}`;
  }

  const used =
    spent === undefined
      ? "That's this month's conversations used up."
      : `That's this month's conversations used up — ${money(spent)} of your ${money(limit)} limit.`;
  const back = resetsAt
    ? `I can reply again from ${formatResetDay(new Date(resetsAt))}.`
    : 'I can reply again from the start of next month.';
  return `${used}\n${back}\n${STILL_WORKS}`;
}
