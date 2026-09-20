/**
 * The account under a reply: what that turn did, in plain English (§10 t-66;
 * product description §3.3; guardrail "nothing is understood invisibly").
 *
 * ## Composed from parts — the seam §11 and §13 add to
 *
 * A reply's account is a list of {@link AccountPart}s, each produced by one
 * small function from the turn's data to a sentence. Today there is one kind
 * of thing a turn can be shown to have done — looked something up in her
 * material — because that is all the stream and the turn row carry (t-64's
 * reconciliation). Slots written (§11) and modules instructed (§13) do not
 * exist yet and are not invented here (D6): when they do, each adds a source
 * to {@link ACCOUNT_SOURCES} and the line and the detail pick it up.
 *
 * With no parts to say, the account says so — "Nothing was written from this
 * turn." — as the prototype's own detail does.
 *
 * ## Two figures, one source
 *
 * The detail's tokens and cost are the reply's: the `done` frame's
 * `tokenUsage` / `costUsd` live, and the turn row's copy of the same on reload
 * (`turns.ts` records the frame's figure). Both are the terminal model call —
 * not the side costs (a search's embedding, a summary), which only the meter
 * route sums. So the detail says "about N tokens" and the reply's cost, and
 * does not claim a total it does not have. An `unpriced` turn says the cost
 * is not known — never $0, which would read as free.
 *
 * ## Words, not system language
 *
 * No model id, no seat, no slug in the line. Dollars to the cent, and under a
 * cent said as such; tokens to two figures. The one-liner is what a person
 * skims; the detail is what they open.
 *
 * @see .context/app/conversation.md — "The account under a reply"
 */

import type { TurnAccount } from '@/lib/app/conversation/transcript';
import type { Citation } from '@/types/orchestration';

/** What a source reads: the reply's own data, live or read back. */
export interface AccountInput {
  /** When her reply landed — ISO. */
  at: string;
  /** Capability slugs the turn called, in order. */
  capabilities: string[];
  citations: Citation[];
  /** The turn row, or null for a reply written before the seam. */
  turn: TurnAccount | null;
}

/** One thing the turn did, said two ways. */
export interface AccountPart {
  key: string;
  /** For the one-liner: a short clause, no full stop. */
  line: string;
  /** For the detail: a sentence. */
  detail: string;
}

export type AccountSource = (input: AccountInput) => AccountPart | null;

/** The capabilities her seat may call, each with a sentence below (`HER_CAPABILITY_SLUGS`). */
const SEARCH_HER_MATERIAL = 'search_knowledge_base';
const READ_THE_PROFILE = 'get_state';
const WRITE_THE_PROFILE = 'fill_slot';

/** Every slug this file has words for. Anything else falls to {@link otherCapability}. */
const NAMED_CAPABILITIES = new Set([SEARCH_HER_MATERIAL, READ_THE_PROFILE, WRITE_THE_PROFILE]);

/** Looked something up in her material — and how many passages it drew on. */
const lookedUp: AccountSource = (input) => {
  const calls = input.capabilities.filter((slug) => slug === SEARCH_HER_MATERIAL).length;
  if (calls === 0) return null;
  const passages = input.citations.length;
  const drewOn =
    passages > 0 ? ` and drew on ${passages} passage${passages === 1 ? '' : 's'} of it` : '';
  return {
    key: 'looked_up',
    line: 'Looked something up in her material',
    detail: `Looked something up in her material${drewOn}.`,
  };
};

/**
 * Looked at what she already understands about the person (§11 t-72).
 *
 * Said without naming a slot, and that is not vagueness. The line is what a
 * member reads, `development` slots are hidden from them by §12 — "a tuning
 * signal, never a grade" — and this source cannot tell which slugs a read
 * covered anyway: the frame carries the capability, not its result. "What she
 * understands about you" is true of all of it and discloses none of it.
 */
const readTheProfile: AccountSource = (input) => {
  if (!input.capabilities.includes(READ_THE_PROFILE)) return null;
  return {
    key: 'read_profile',
    line: 'Looked at what she already understands about you',
    detail: 'Looked at what she already understands about you.',
  };
};

/**
 * Wrote something new into what she understands about the person (§11 t-72).
 *
 * **This is the guardrail's own line** — "nothing is understood invisibly". A
 * capture is a silent tool (D5): the model is told not to announce it, and
 * without this source a turn would learn something about someone and say
 * nothing about having done so. The count is how many writes the turn made, one
 * `capability_result` each; the retry guard is what stops a re-run of one turn
 * counting the same reading twice (`lib/app/slots/capture.ts`).
 *
 * No slug, for `readTheProfile`'s reasons, and no value — the panel (t-73) is
 * where a person sees what was written and corrects it.
 */
const wroteToProfile: AccountSource = (input) => {
  const writes = input.capabilities.filter((slug) => slug === WRITE_THE_PROFILE).length;
  if (writes === 0) return null;
  const what = writes === 1 ? 'something' : `${writes} things`;
  return {
    key: 'wrote_profile',
    line: `Added ${what} to what she understands about you`,
    detail: `Added ${what} to what she understands about you. You can see it, and correct it.`,
  };
};

/**
 * A capability this account has no words for. Every slug her seat may call has
 * one above (`pins-misuse.test.ts` pins the list against
 * {@link NAMED_CAPABILITIES}), so this is the honest floor for the day one is
 * added before its sentence is: named, never hidden.
 */
const otherCapability: AccountSource = (input) => {
  const others = [...new Set(input.capabilities.filter((slug) => !NAMED_CAPABILITIES.has(slug)))];
  if (others.length === 0) return null;
  const named = others.map((slug) => slug.replace(/_/g, ' ')).join(', ');
  return {
    key: 'other_capability',
    line: `Used ${named}`,
    detail: `Used ${named}.`,
  };
};

/**
 * Every source, in the order their sentences read: what she consulted, then
 * what she wrote. §13 adds modules instructed. Exported so a test can see the
 * seam.
 */
export const ACCOUNT_SOURCES: readonly AccountSource[] = [
  lookedUp,
  readTheProfile,
  wroteToProfile,
  otherCapability,
];

export const NOTHING_WRITTEN = 'Nothing was written from this turn';

export function accountParts(input: AccountInput): AccountPart[] {
  return ACCOUNT_SOURCES.map((source) => source(input)).filter(
    (part): part is AccountPart => part !== null
  );
}

/** The one-liner beside the time: what the turn did, or that it wrote nothing. */
export function accountLine(parts: AccountPart[]): string {
  if (parts.length === 0) return NOTHING_WRITTEN;
  return parts.map((part) => part.line).join('; ');
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** "about 4,000": two significant figures, so the number reads as a size, not a count. */
export function aboutTokens(tokens: number): string {
  if (tokens < 100) return `about ${tokens}`;
  const magnitude = 10 ** (Math.floor(Math.log10(tokens)) - 1);
  return `about ${(Math.round(tokens / magnitude) * magnitude).toLocaleString('en-US')}`;
}

/** The reply's figures as one sentence, honest about what is not known. */
export function costSentence(turn: TurnAccount | null): string | null {
  if (!turn) return null;
  // The platform writes 0/0 when the provider reported no usage (`turn-record.ts`,
  // `classifyPricing`), and a replay says the same for a null row: not a
  // count, so not a figure — the way `unpriced` is not a cost.
  const tokens =
    turn.inputTokens !== null && turn.outputTokens !== null
      ? turn.inputTokens + turn.outputTokens
      : null;
  const used =
    tokens !== null && tokens > 0 ? `This turn used ${aboutTokens(tokens)} tokens` : null;

  let cost: string | null;
  if (turn.pricing === 'unpriced' || (turn.pricing === null && turn.costUsd === null)) {
    cost = 'what it cost is not known';
  } else if (turn.pricing === 'local') {
    cost = 'cost nothing to run';
  } else if (turn.costUsd === null) {
    cost = null;
  } else if (turn.costUsd > 0 && turn.costUsd < 0.005) {
    cost = 'cost less than a cent';
  } else {
    cost = `cost ${usd.format(turn.costUsd)}`;
  }

  if (used && cost) return `${used} and ${cost}.`;
  if (used) return `${used}.`;
  if (cost) return `${cost[0].toUpperCase()}${cost.slice(1)}.`;
  return null;
}

/** The detail, one sentence to a line: what it did, then what it cost. */
export function accountDetail(input: AccountInput, parts: AccountPart[]): string {
  const lines = parts.length === 0 ? [`${NOTHING_WRITTEN}.`] : parts.map((part) => part.detail);
  const cost = costSentence(input.turn);
  if (cost) lines.push(cost);
  return lines.join('\n');
}

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** The time her reply landed, as the prototype shows it: `09:12`, in the reader's zone. */
export function accountTime(at: string): string {
  return clock.format(new Date(at));
}
