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
import { roundsToNoCents } from '@/lib/app/usage/usage-view';
import type { ResourceSuggestion } from '@/lib/app/resources/suggestion';
import type { Citation } from '@/types/orchestration';
import { leaningDimension, type LeaningKey } from '@/lib/app/voice/leanings';
import { SET_LEANING_SLUG, type LeaningChange } from '@/lib/app/voice/leaning-change';
import { HELD_WHEN_HARD } from '@/lib/app/voice/leanings-select';

/**
 * A list in a sentence: "a, b, and c". In the leanings, each item starts with
 * "toward", so an item's own "and" ("cool and analytical") does not read as
 * the list's.
 */
const listOf = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

/** What a source reads: the reply's own data, live or read back. */
export interface AccountInput {
  /** When the reply landed — ISO. */
  at: string;
  /** Capability slugs the turn called, in order. */
  capabilities: string[];
  citations: Citation[];
  /** What the turn offered the person — a video, audio piece or article (t-77). */
  suggestions: ResourceSuggestion[];
  /** The leanings the turn changed, from `set_leaning`'s results (f-leanings t-137). */
  leaningChanges: LeaningChange[];
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

/** The capabilities the guide agent may call, each with a sentence below (`HER_CAPABILITY_SLUGS`). */
const SEARCH_HER_MATERIAL = 'search_knowledge_base';
const READ_THE_PROFILE = 'get_state';
const WRITE_THE_PROFILE = 'fill_slot';
const OFFERED_A_RESOURCE = 'suggest_resource';
const NOTED_HOW_TO_SPEAK = 'set_register';
const LOOKED_BACK = 'search_person_memory';
const CHANGED_A_LEANING = SET_LEANING_SLUG;

/** Every slug this file has words for. Anything else falls to {@link otherCapability}. */
const NAMED_CAPABILITIES = new Set([
  SEARCH_HER_MATERIAL,
  READ_THE_PROFILE,
  WRITE_THE_PROFILE,
  OFFERED_A_RESOURCE,
  NOTED_HOW_TO_SPEAK,
  LOOKED_BACK,
  CHANGED_A_LEANING,
]);

/**
 * Opened the session with a recap of the last one (f-recap t-142) — and what
 * it drew on.
 *
 * The recap is steered by material the person never sees, so this is the
 * guardrail's line for it: the account of last time they kept, or their words
 * from it when they kept none (t-149), the notes captured since (by the
 * heading the notes panel files them under) and the journey's steps. The words themselves are not repeated: they are in the transcript,
 * and the notes are in the notes. First, because it is what the turn was.
 */
const recapped: AccountSource = (input) => {
  const recap = input.turn?.recap;
  if (!recap) return null;
  const drew: string[] = [];
  // The account of last time they kept (t-149), or, with none kept, their words.
  if (recap.source === 'synopsis') drew.push('the account of last time you kept');
  else if (recap.words > 0) {
    drew.push(
      recap.words === 1
        ? 'one thing you said last time'
        : `${recap.words} things you said last time`
    );
  }
  if (recap.notes.length > 0) {
    drew.push(`your notes on ${listOf.format(recap.notes)}`);
  }
  if (recap.journey > 0) drew.push('where your journey has moved since');
  // Semicolons between the sources when the notes are a list of their own, so
  // where that list ends reads plainly.
  const joined =
    recap.notes.length > 1 && drew.length > 1
      ? `${drew.slice(0, -1).join('; ')}; and ${drew[drew.length - 1]}`
      : listOf.format(drew);
  const detail =
    drew.length > 0
      ? `Opened this session with a recap of the last one, drawing on ${joined}.`
      : 'Opened this session with a recap of the last one.';
  return { key: 'recap', line: 'Opened the session with a recap of the last one', detail };
};

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
 * Looked at what is already understood about the person (§11 t-72).
 *
 * Said without naming a slot, and that is not vagueness. The line is what a
 * member reads, `development` slots are hidden from them by §12 — "a tuning
 * signal, never a grade" — and this source cannot tell which slugs a read
 * covered anyway: the frame carries the capability, not its result. "What is
 * understood about you" is true of all of it and discloses none of it.
 */
const readTheProfile: AccountSource = (input) => {
  if (!input.capabilities.includes(READ_THE_PROFILE)) return null;
  return {
    key: 'read_profile',
    line: 'Looked at what is already understood about you',
    detail: 'Looked at what is already understood about you.',
  };
};

/**
 * Wrote something new into what is understood about the person (§11 t-72).
 *
 * **This is the guardrail's own line** — "nothing is understood invisibly". A
 * capture is a silent tool (D5): the model is told not to announce it, and
 * without this source a turn would learn something about someone and say
 * nothing about having done so.
 *
 * **No count, deliberately** — an earlier version said "Added 3 things" and it
 * could not be right. What this source has is `input.capabilities`: one entry
 * per *successful call*, with no slot slug on it. Two of those can be one
 * reading — the model calling the tool twice for the same slug inside one
 * attempt, which `capture.ts` explicitly declines to collapse — so the count
 * would say "2 things" where the panel (t-73) shows one item, and the person
 * reading both would be right to trust the panel. A suppressed retry counts too,
 * because it returns a success like any other. The frame cannot tell us how many
 * things were learned, so this does not claim to know. Found by /code-review,
 * which also caught the docblock asserting the retry guard prevented exactly
 * this.
 *
 * No slug either, for `readTheProfile`'s reasons, and no value — the panel is
 * where a person sees what was written and corrects it.
 */
const wroteToProfile: AccountSource = (input) => {
  if (!input.capabilities.includes(WRITE_THE_PROFILE)) return null;
  return {
    key: 'wrote_profile',
    line: 'Added something to what is understood about you',
    detail: 'Added something to what is understood about you. You can see it, and correct it.',
  };
};

/**
 * Pointed the person to one of Lelañea Fulton's videos, audio or articles
 * (f-resources t-77).
 *
 * Named, because the chip beside the reply already shows it and the account
 * is what the person reads to know what the turn DID. The title is the
 * library's, resolved server-side from the id the model named — never the
 * model's words. A suggestion whose resource has since left the library is
 * still a thing the turn did, so a call with nothing to show is said as such
 * rather than falling silent.
 *
 * **Only when NOTHING resolved, and that is a limit rather than an oversight.**
 * Two offers of which one has since left the library read as one offer here.
 * The source could count answered `suggest_resource` calls against the
 * suggestions, but the suggestions are deduped (one offer per resource) and
 * the calls are not, so "two calls, one suggestion" is a duplicate offer as
 * often as a lost one — and a clause built on that count would claim a loss
 * that never happened. Saying it needs the trace's ids, which this input
 * does not carry; the case needs a resource removed from the file AFTER it
 * was offered. Accepted (`/code-review` round 2); revisit if the library
 * starts losing entries.
 */
const pointedTo: AccountSource = (input) => {
  const called = input.capabilities.includes(OFFERED_A_RESOURCE);
  if (!called && input.suggestions.length === 0) return null;
  if (input.suggestions.length === 0) {
    return {
      key: 'pointed_to',
      line: 'Offered something that is no longer in her library',
      detail: 'Offered something that is no longer in her library.',
    };
  }
  const titles = input.suggestions.map((s) => `“${s.title}”`);
  const list =
    titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
  const of = (kind: ResourceSuggestion['kind']) =>
    input.suggestions.filter((s) => s.kind === kind).length;
  // Plural where there is more than one of a kind: "two videos" reads as two
  // videos, and "a video" over two of them read as one (`/code-review`).
  const parts = [
    count(of('video'), 'video', 'videos'),
    count(of('audio'), 'audio piece', 'audio pieces'),
    count(of('article'), 'article', 'articles'),
  ].filter((part) => part !== '');
  const what =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return {
    key: 'pointed_to',
    line: `Pointed you to ${list}`,
    detail: `Pointed you to ${list} — ${what} of hers you can open beside this reply.`,
  };
};

/**
 * Noted how the person asked to be spoken to (f-registers t-126).
 *
 * The person asked; this says it was heard, and that it can be changed the same
 * way. No register named: the frame carries the call, not its argument, and
 * the next reply's own register sentence says where it began.
 */
const notedHowToSpeak: AccountSource = (input) => {
  if (!input.capabilities.includes(NOTED_HOW_TO_SPEAK)) return null;
  return {
    key: 'noted_register',
    line: 'Noted how you asked to be spoken to',
    detail:
      'Noted how you asked to be spoken to, for the rest of this sitting. Say so again to change it.',
  };
};

/**
 * Changed one of the person's lasting leanings (f-leanings t-137).
 *
 * Named, with the pole and how it came about, because this is the one change
 * the AI makes to how it will speak from now on, and the person should be able
 * to see, under the very reply, that it happened and why: they asked, or they
 * said yes to a suggestion (owner ruling, 4 Oct 2026). A suggestion is said
 * too, as one that changed nothing: the person reads that it was put to them,
 * and that only a yes moves it. A call that moved
 * nothing, because the dial was already as far as it goes, says so rather
 * than claiming a change. An answered call whose change cannot be read (a
 * trace from another build) is still said, without the detail.
 */
const changedLeaning: AccountSource = (input) => {
  const called = input.capabilities.includes(CHANGED_A_LEANING);
  if (!called && input.leaningChanges.length === 0) return null;
  if (input.leaningChanges.length === 0) {
    // A proposal or a change: which, the trace cannot say, so neither is claimed.
    return {
      key: 'changed_leaning',
      line: 'Changed, or suggested changing, one of your leanings',
      detail:
        'Changed, or suggested changing, one of your leanings. You can see where they all are in Settings.',
    };
  }
  const said = input.leaningChanges.map(leaningChangeWords);
  const moved = input.leaningChanges.some(
    (change) => change.how !== 'proposed' && change.from !== change.to
  );
  const lasts = moved ? ' It stays until you change it, here or in Settings.' : '';
  return {
    key: 'changed_leaning',
    line: said.map((words) => words.line).join('; '),
    detail: `${said.map((words) => words.detail).join(' ')}${lasts}`,
  };
};

/**
 * One change, as a clause and as a sentence. Said by the way it moved, never
 * by the side it landed on: a step from strongly verbose to verbose is a step
 * toward concise, which is what the person asked for (/code-review).
 */
function leaningChangeWords(change: LeaningChange): { line: string; detail: string } {
  if (change.how === 'proposed') {
    const what = `Suggested ${stepWords(change, 'moving', 'setting')}`;
    return { line: what, detail: `${what}. Nothing has changed unless you say yes.` };
  }
  if (change.from === change.to) {
    const at =
      change.to === 0
        ? 'That leaning was already at rest'
        : 'That leaning was already as far as it goes';
    return { line: at, detail: `${at}, so nothing changed.` };
  }
  const why = change.how === 'agreed' ? 'when you agreed to the suggestion' : 'as you asked';
  const moved = stepWords(change, 'Moved', 'Set');
  return { line: `${moved}, ${why}`, detail: `${moved}, ${why}.` };
}

/** "<move> your leaning a step toward concise and spare", or "<set> your leaning back to rest from …". */
function stepWords(change: LeaningChange, move: string, set: string): string {
  if (change.to === 0) {
    return `${set} your leaning back to rest from ${towardWords(change.leaning, change.from)}`;
  }
  const dimension = leaningDimension(change.leaning);
  const pole = change.to > change.from ? dimension.right : dimension.left;
  return `${move} your leaning a step toward ${poleWords(mildPole(pole))}`;
}

/**
 * Looked back through what the person said before (f-memory t-130).
 *
 * Said whether or not anything came back: the frame carries the call, not its
 * result, and what was found is the reply's to use. Never the words, so the
 * account below a reply cannot become a second copy of an old exchange that
 * the person may later delete.
 */
const lookedBack: AccountSource = (input) => {
  if (!input.capabilities.includes(LOOKED_BACK)) return null;
  return {
    key: 'looked_back',
    line: 'Looked back at what you’ve said before',
    detail: 'Looked back at what you’ve said before, to remember it with you.',
  };
};

/** "a video", "two videos", "three articles" — small counts as words; `''` for none. */
function count(n: number, one: string, many: string): string {
  if (n === 0) return '';
  const words = ['', /^[aeiou]/.test(one) ? 'an' : 'a', 'two', 'three', 'four', 'five'];
  const number = words[n] ?? String(n);
  return n === 1 ? `${number} ${one}` : `${number} ${many}`;
}

/**
 * A capability this account has no words for. Every slug the guide agent may call has
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
 * Every source, in the order their sentences read: what the turn was (a
 * recap), what was consulted, then what was written, then what was offered.
 * §13 adds modules instructed.
 * Exported so a test can see the seam.
 */
export const ACCOUNT_SOURCES: readonly AccountSource[] = [
  recapped,
  lookedUp,
  lookedBack,
  readTheProfile,
  wroteToProfile,
  pointedTo,
  notedHowToSpeak,
  changedLeaning,
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
  } else if (roundsToNoCents(turn.costUsd)) {
    cost = 'cost less than a cent';
  } else {
    cost = `cost ${usd.format(turn.costUsd)}`;
  }

  if (used && cost) return `${used} and ${cost}.`;
  if (used) return `${used}.`;
  if (cost) return `${cost[0].toUpperCase()}${cost.slice(1)}.`;
  return null;
}

/**
 * The register the reply was steered to, as a sentence (f-registers t-125), or
 * null for a turn that had none.
 *
 * In the detail, not the one-liner: the line says what the turn DID, and every
 * reply on the seat has a register, so it would crowd out the thing that
 * changes. Said as where it began, because that is what is known: the AI may
 * move off it within the reply when the moment calls for it, and nothing
 * records that it did.
 */
export function registerSentence(turn: TurnAccount | null): string | null {
  if (!turn?.register) return null;
  const how =
    turn.register === 'teaching'
      ? 'in a teaching register: direct, and asking you to look further'
      : 'in a guiding register: gentle, and holding space';
  const why =
    turn.registerSource === 'safety'
      ? ', because something hard came up recently'
      : turn.registerSource === 'asked'
        ? ', because you asked for it'
        : turn.registerSource === 'module'
          ? ', where this part of the journey starts'
          : '';
  return `Began ${how}${why}.`;
}

/** A pole's name inside a sentence: "Concise and spare" → "concise and spare". */
function poleWords(label: string): string {
  return `${label[0].toLowerCase()}${label.slice(1)}`;
}

/**
 * Where a label names a pole's two stops ("Direct, and further, challenging"),
 * the first stop's part alone; otherwise the label. So a mild setting is not
 * described as the strong one.
 */
const FURTHER = ', and further, ';
function mildPole(label: string): string {
  const at = label.indexOf(FURTHER);
  return at === -1 ? label : label.slice(0, at);
}

/** What a stop leans toward, in a sentence: "toward direct", "strongly toward direct and challenging". */
function towardWords(key: LeaningKey, stop: number): string {
  const dimension = leaningDimension(key);
  const label = stop < 0 ? dimension.left : dimension.right;
  return Math.abs(stop) === 2
    ? `strongly toward ${poleWords(label.replace(FURTHER, ' and '))}`
    : `toward ${poleWords(mildPole(label))}`;
}

/** The pole a held dial was leaning toward, either stop: only a hard pole is ever held. */
function heldPole(key: LeaningKey): string {
  const dimension = leaningDimension(key);
  return poleWords(mildPole(HELD_WHEN_HARD.get(key) === 'left' ? dimension.left : dimension.right));
}

/**
 * The person's leanings the reply was shaded by, and any set aside, as
 * sentences (f-leanings t-136); none for a turn that applied and held nothing.
 *
 * In the detail beside the register, for the register's reason. A held
 * leaning gives the crisis as its reason only when a crisis was read
 * (`safety`), never on a `fallback`, as `registerSentence` does.
 */
export function leaningsSentences(turn: TurnAccount | null): string[] {
  const leanings = turn?.leanings;
  if (!leanings) return [];
  const sentences: string[] = [];
  if (leanings.applied.length > 0) {
    const toward = listOf.format(leanings.applied.map(({ key, stop }) => towardWords(key, stop)));
    sentences.push(`Leaned the way you’ve set it: ${toward}.`);
  }
  // Only a hard pole is ever held. A stamp naming another key (an old row, or a
  // hold list changed since) is not said as something set aside.
  const held = leanings.held.filter((key) => HELD_WHEN_HARD.has(key));
  if (held.length > 0) {
    const poles = listOf.format(held.map((key) => `toward ${heldPole(key)}`));
    const why = turn.registerSource === 'safety' ? ', because something hard came up recently' : '';
    const noun = held.length === 1 ? 'leaning' : 'leanings';
    sentences.push(`Set aside your ${noun} ${poles} for now${why}.`);
  }
  return sentences;
}

/** The detail, one sentence to a line: what it did, how it spoke, then what it cost. */
export function accountDetail(input: AccountInput, parts: AccountPart[]): string {
  const lines = parts.length === 0 ? [`${NOTHING_WRITTEN}.`] : parts.map((part) => part.detail);
  const register = registerSentence(input.turn);
  if (register) lines.push(register);
  lines.push(...leaningsSentences(input.turn));
  const cost = costSentence(input.turn);
  if (cost) lines.push(cost);
  return lines.join('\n');
}

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** The time the reply landed, as the prototype shows it: `09:12`, in the reader's zone. */
export function accountTime(at: string): string {
  return clock.format(new Date(at));
}
