/**
 * What the admin cost view decides about the figures it is handed (f-budget t-97).
 *
 * The wire shapes of the admin metering reads, and the pure judgements over
 * them: which total is a floor, who is at or past their limit, which
 * conversation is running away from the rest. Nothing here fetches, so the page
 * and the tests take the same route through it — and every judgement is a
 * fixture away from being checked.
 *
 * ## Three things the view must not get wrong
 *
 * - **Platform cost is named, never attributed and never dropped.** The group
 *   with no person — knowledge ingestion, scheduled work, and an **erased**
 *   account's rows, whose FK is `SET NULL` — is `totals.platformCostUsd`, shown
 *   as its own figure. {@link people} leaves the null group out of the people
 *   so it cannot be read as one of them.
 * - **`unpricedRows` makes a figure a floor** (f-budget ruling 4). Every figure
 *   carries its own count, and {@link figure} says "at least" where it is short.
 * - **Totals are the API's, not a re-sum of the groups.** They are computed
 *   apart so they cover every row even when the groups are truncated; adding up
 *   the listed groups would state the shown part as the whole.
 *
 * @see lib/app/agent/metering.ts — where every figure comes from
 * @see .context/app/budget.md — "The admin cost view"
 */

import { floorLabel, money, spendFloor } from '@/lib/app/usage/usage-view';

/** Wire dates are ISO strings; nothing here needs them as dates. */
export interface CostWindow {
  from: string;
  to: string;
}

export interface CostTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  costRows: number;
  unpricedRows: number;
}

export interface CostGroup extends CostTotals {
  key: string | null;
}

export interface PersonGroup extends CostGroup {
  user: { name: string; email: string } | null;
  ceiling: { ceilingUsd: number; source: 'override' | 'default' } | null;
}

export interface ConversationGroup extends CostGroup {
  conversation: {
    title: string | null;
    userId: string | null;
    user: { name: string; email: string } | null;
  } | null;
}

export interface CostBreakdown<G extends CostGroup = CostGroup> {
  by: string;
  window: CostWindow;
  totals: CostTotals & { platformCostUsd: number };
  groups: G[];
  truncated: boolean;
}

export interface ConversationTurn {
  turnId: string;
  userId: string;
  seat: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  model: string | null;
  startedAt: string;
  completedAt: string | null;
  costUsd: number;
  costRows: number;
  unpricedRows: number;
}

export interface ConversationTurnsReading {
  conversationId: string;
  window: CostWindow;
  turns: ConversationTurn[];
  truncated: boolean;
}

export interface TurnCostRow {
  id: string;
  part: string;
  operation: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: boolean;
  createdAt: string;
}

export interface TurnReading extends CostTotals {
  turnId: string;
  seat: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  model: string | null;
  provider: string | null;
  conversationId: string | null;
  startedAt: string;
  completedAt: string | null;
  replyCostUsd: number;
  sideCostUsd: number;
  rows: TurnCostRow[];
}

/**
 * A figure, "at least" when it is known to be short.
 *
 * The one place the view turns a total into words, so no figure on the page can
 * forget the floor. `floorLabel` qualifies a numeral only.
 */
export function figure(totals: { costUsd: number; unpricedRows: number }): string {
  return floorLabel(money(totals.costUsd), spendFloor(totals));
}

/** Where a person stands against their limit this month. */
export type LimitStanding =
  | { kind: 'under' }
  | { kind: 'at' }
  | { kind: 'past'; byUsd: number }
  /** A limit of nothing, with spend against it anyway — the turn that crossed completes. */
  | { kind: 'nothing-allowed' };

/**
 * At or past their limit, from the figures the breakdown already carries.
 *
 * "At" is the gate's own test (`ceiling.ts`: a turn may start while spend is
 * BELOW the limit) — at it, the next turn is refused. Past it is reachable,
 * because the turn that crosses the line completes (t-59). A floor can only
 * understate this: an unpriced row makes real spend higher, never lower.
 */
export function limitStanding(group: PersonGroup): LimitStanding | null {
  if (!group.ceiling) return null;
  const { ceilingUsd } = group.ceiling;
  if (ceilingUsd <= 0) return group.costUsd > 0 ? { kind: 'nothing-allowed' } : { kind: 'at' };
  if (group.costUsd > ceilingUsd) return { kind: 'past', byUsd: group.costUsd - ceilingUsd };
  if (group.costUsd === ceilingUsd) return { kind: 'at' };
  return { kind: 'under' };
}

/** The people, without the platform group — which is nobody, and shown on its own. */
export function people(breakdown: CostBreakdown<PersonGroup>): PersonGroup[] {
  return breakdown.groups.filter((group) => group.key !== null);
}

/**
 * How far above the typical conversation one has to be to be called a runaway.
 *
 * Three times the median of the conversations listed. A multiple of the
 * median, not of the mean, because one runaway drags the mean up towards
 * itself and hides; and not a fixed dollar figure, because what is normal
 * moves with the model and the prices. Revisit when real months give a shape.
 */
export const RUNAWAY_MULTIPLE = 3;

/** Fewer conversations than this and "the rest" is not a thing to be above. */
export const RUNAWAY_MIN_CONVERSATIONS = 4;

/**
 * The conversations far above the rest, by key.
 *
 * Only among conversations — the group of rows with no conversation is not
 * one, and is neither measured nor flagged. With too few to have a typical
 * one, nothing is flagged rather than everything.
 */
export function runawayConversations(breakdown: CostBreakdown<ConversationGroup>): Set<string> {
  const listed = breakdown.groups.filter(
    (group): group is ConversationGroup & { key: string } => group.key !== null
  );
  if (listed.length < RUNAWAY_MIN_CONVERSATIONS) return new Set();
  const typical = median(listed.map((group) => group.costUsd));
  if (typical <= 0) return new Set();
  return new Set(
    listed.filter((group) => group.costUsd >= typical * RUNAWAY_MULTIPLE).map((group) => group.key)
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const windowDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The window as a person reads it: `1 September 2026 – 23 September 2026 (UTC)`. */
export function windowLabel(window: CostWindow): string {
  return `${windowDay.format(new Date(window.from))} – ${windowDay.format(new Date(window.to))} (UTC)`;
}
