/**
 * What the AI is told, each turn, about the person's leanings and how it may
 * change them (f-leanings t-137).
 *
 * The pole lines a turn carries (`leanings-select.ts`) shade how she speaks;
 * they do not tell the AI where each dial is, which can still move, or which
 * it may suggest. This block does, so a request ("be plainer with me") or a
 * suggestion lands on a real dial in a real direction, and a locked one is
 * never offered. It rides on the facilitator seat only, the one seat whose
 * turns apply leanings, after the voice block.
 *
 * ## The rule travels with the list
 *
 * Proposal, then confirmation (owner rulings, 4 and 5 Oct 2026): the AI may
 * propose a change it has noticed, recording the proposal with `how:
 * proposed` (which moves nothing), and changes the leaning only once the
 * person says yes, in their next message. Said here and in the tool's description, for the reason
 * `offering.ts` gives: this is where a model weighing the change is looking.
 * Its `preferences` notes are named as the evidence to propose from, so a
 * reading of the person stays a note and never becomes a setting on its own.
 *
 * Bounds that cannot be read lock every dial, and the block is `''`: there is
 * nothing to change, so nothing is offered.
 *
 * @see lib/app/voice/leaning-capability.ts — the tool
 * @see lib/app/voice/context-contributor.ts — where it is composed
 */

import { LEANING_REST, type LeaningStop } from '@/lib/app/voice/leanings';
import type { LeaningDialView, LeaningsView } from '@/lib/app/voice/leanings-store';
import type { LeaningChange } from '@/lib/app/voice/leaning-change';

const HEADING =
  'The person’s leanings: lasting settings for how your voice leans for them, which they can also change in Settings. Each is its two poles, where it is now, and what may change:';

/** The asking route, which both forms of the rule open with. */
const ASKED =
  'If they ask for a lasting change in how you speak with them, use set_leaning with how: asked.';

/**
 * The rule. Pinned by `tests/unit/lib/app/voice/leaning-context.test.ts`
 * beside the tool's description, which says the same.
 */
export const LEANING_RULE = [
  ASKED,
  'If you notice a pattern they have not named, you may propose one change, to a leaning that says you may suggest one: call set_leaning with how: proposed, which changes nothing, and in one sentence say what you noticed and what you would change, and ask. What you have noted about how they like to be met is your evidence; it is never a reason to change a leaning yourself.',
  'Only if they say yes in their next message, call set_leaning with how: agreed, the same leaning and direction. Never change a leaning on your own inference. Propose at most one at a time, never while they are struggling, and let a no stand.',
].join('\n');

/**
 * The rule when no dial may be suggested (t-138: an admin turned suggestions
 * off, for all of them or for each one that can move). The propose route is
 * left out rather than offered and then refused, so the AI is not invited to
 * do something every dial forbids.
 */
export const LEANING_RULE_ASKED_ONLY = [
  ASKED,
  'None of these is one for you to suggest: change a leaning only when they ask for it.',
].join('\n');

function where(dial: LeaningDialView, stop: LeaningStop): string {
  if (stop === LEANING_REST) return 'at rest';
  const pole = stop < 0 ? dial.left : dial.right;
  return Math.abs(stop) === 2 ? `strongly toward ${pole}` : `toward ${pole}`;
}

function line(dial: LeaningDialView): string {
  const poles = `${dial.key}: ${dial.left} ↔ ${dial.right}`;
  if (dial.locked) return `- ${poles}. Fixed; it cannot be changed.`;
  const range =
    dial.min === -2 && dial.max === 2
      ? ''
      : ` It goes from ${where(dial, dial.min)} to ${where(dial, dial.max)}.`;
  const suggest = dial.suggest ? ' You may suggest a change.' : ' Change it only if they ask.';
  return `- ${poles}. Now ${where(dial, dial.position)}.${range}${suggest}`;
}

/**
 * A proposal from the AI's last reply, awaiting the person's answer: what it
 * was, and the one call that makes it on a yes. A proposal for a dial that has
 * since moved, locked, or stopped being one to suggest is not named; the tool
 * would refuse it anyway.
 */
function awaiting(view: LeaningsView, proposal: LeaningChange): string | null {
  const dial = view.dials.find((candidate) => candidate.key === proposal.leaning);
  if (!dial || dial.locked || !dial.suggest || dial.position !== proposal.from) return null;
  const toward =
    proposal.to === LEANING_REST ? 'rest' : proposal.to < proposal.from ? dial.left : dial.right;
  return `In your last reply you proposed setting ${dial.key} ${where(dial, proposal.to)}. If their message now says yes, call set_leaning with how: agreed, leaning: ${dial.key}, toward: "${toward}". If it does not, let it go.`;
}

/**
 * The block for a view of the person's leanings, or `''` when none can change.
 * `proposals` are the ones the previous turn made (`leaning-proposals.ts`).
 */
export function composeLeaningContext(
  view: LeaningsView,
  proposals: readonly LeaningChange[] = []
): string {
  if (!view.configured || view.dials.every((dial) => dial.locked)) return '';
  const suggestable = view.dials.some((dial) => !dial.locked && dial.suggest);
  const pending = proposals.flatMap((proposal) => awaiting(view, proposal) ?? []);
  return [
    HEADING,
    ...view.dials.map(line),
    '',
    suggestable ? LEANING_RULE : LEANING_RULE_ASKED_ONLY,
    ...(pending.length > 0 ? ['', ...pending] : []),
  ].join('\n');
}
