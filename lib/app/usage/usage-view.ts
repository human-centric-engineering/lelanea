/**
 * What the usage view shows, as data and as words (f-budget t-94).
 *
 * The wire shapes of the two member endpoints t-56 built, and the pure
 * functions that turn them into the prototype's three stats and two charts.
 * Nothing here fetches or reads a database, so the page, the panel and the
 * tests all take the same route through it — and every judgement about what a
 * figure MEANS is testable against a fixture rather than a screenshot.
 *
 * ## Money, never tokens
 *
 * The prototype's rule, and the reason it gives: *"Everything is in money — the
 * token arithmetic is ours to worry about, not yours."* Tokens stay in the
 * account row under a reply, where a person has asked for the detail. Nothing
 * on this view counts them.
 *
 * ## A total that contains unpriced rows is a floor
 *
 * A row that used tokens and was costed at $0 on a provider not configured as
 * local was priced by a registry with no rate for its model
 * (`.context/app/agent.md`, "A turn costed at nothing"). The meter counts these
 * as `unpricedRows` everywhere. Rendering such a total as a plain figure would
 * state as fact something the app knows to be short, so {@link spendFloor} asks
 * the question once and every caller has to answer it.
 *
 * ## Three edges that are not errors
 *
 * - **A $0 ceiling** means nothing may be spent — a real setting, not a missing
 *   one. `fractionUsed` is null there, because nothing divides by zero, so a
 *   meter cannot be drawn and a sentence has to do instead.
 * - **Over the ceiling** is reachable and expected: the turn that crosses the
 *   line completes, so spend may exceed the limit by one turn (t-59's accepted
 *   trade, so a reply is never cut off mid-sentence). `remainingUsd` is clamped
 *   at zero by the server; `fractionUsed` is above 1 and must not be clamped
 *   into a full bar that reads as "exactly used up".
 * - **A month with no spend at all** is the ordinary state of a new account.
 *
 * @see lib/app/agent/metering.ts — where every figure comes from
 * @see .context/app/planning/design/lelanea.html — "usage and billing"
 */

/** The half-open UTC window a reading covers, as the wire carries it. */
export interface UsageWindow {
  from: string;
  to: string;
}

/** `GET /api/v1/app/usage` — this month against the reader's own ceiling. */
export interface UsageSummary {
  userId: string;
  window: UsageWindow;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  costRows: number;
  unpricedRows: number;
  ceiling: { ceilingUsd: number; source: 'override' | 'default' };
  /** What is left before the ceiling; never negative. */
  remainingUsd: number;
  /** Null when the ceiling is zero. Above 1 means over it. */
  fractionUsed: number | null;
}

/** One day of `GET /api/v1/app/usage/breakdown?by=day`. */
export interface UsageDay {
  /** `YYYY-MM-DD`, UTC. Null cannot occur grouped by day, and is treated as absent. */
  key: string | null;
  costUsd: number;
  costRows: number;
  unpricedRows: number;
}

export interface UsageBreakdown {
  by: string;
  window: UsageWindow;
  totals: { costUsd: number; costRows: number; unpricedRows: number };
  groups: UsageDay[];
  truncated: boolean;
}

/** Both reads, as the panel holds them. */
export interface UsageReading {
  summary: UsageSummary;
  days: UsageBreakdown;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * A figure, to the cent.
 *
 * Exact zero is `$0.00` — a month with nothing spent, which is a fact. A figure
 * that rounds to zero without being zero is NOT, which is what
 * {@link moneyWords} is for; this one is the numeral a chart axis or a stat
 * needs, where a sentence will not fit.
 */
export function money(amount: number): string {
  return usd.format(amount);
}

/**
 * A figure as a person would say it, refusing to round a real cost to nothing.
 *
 * `$0.00` for spend that exists is the lie the account row already refuses
 * ("cost less than a cent"); the same rule holds here, where the number is
 * larger and the reader is looking for it.
 */
export function moneyWords(amount: number): string {
  if (amount > 0 && amount < 0.005) return 'less than a cent';
  return money(amount);
}

/** True when a total is known to be short, so it must not be stated as exact. */
export function spendFloor(totals: { unpricedRows: number }): boolean {
  return totals.unpricedRows > 0;
}

/** The three figures across the top, and whether each is a floor. */
export interface UsageStats {
  spent: string;
  remaining: string;
  ceiling: string;
  /** `spent` is at least this much, not exactly it. */
  spentIsFloor: boolean;
  /** The ceiling is zero: nothing may be spent, and no meter can be drawn. */
  nothingAllowed: boolean;
  /** Spend has passed the ceiling. */
  overCeiling: boolean;
  /** This person's own limit rather than everyone's default. */
  ownLimit: boolean;
}

export function usageStats(summary: UsageSummary): UsageStats {
  const nothingAllowed = summary.ceiling.ceilingUsd <= 0;
  return {
    spent: moneyWords(summary.costUsd),
    remaining: money(summary.remainingUsd),
    ceiling: money(summary.ceiling.ceilingUsd),
    spentIsFloor: spendFloor(summary),
    nothingAllowed,
    overCeiling: !nothingAllowed && summary.costUsd > summary.ceiling.ceilingUsd,
    ownLimit: summary.ceiling.source === 'override',
  };
}

/**
 * How full the meter is, 0 to 1, or null when no meter can honestly be drawn.
 *
 * Clamped at 1 for the BAR only — a bar cannot be more than full — while
 * {@link UsageStats.overCeiling} carries the fact that it should be. The two are
 * separate on purpose: clamping the number and then reading the bar as the
 * whole truth is how "over your limit" becomes "exactly at it".
 */
export function meterFill(summary: UsageSummary): number | null {
  if (summary.fractionUsed === null) return null;
  return Math.max(0, Math.min(1, summary.fractionUsed));
}

/** One bar of a plot. */
export interface UsageBar {
  /** `YYYY-MM-DD`, UTC — the identity a tip and a test both use. */
  day: string;
  costUsd: number;
  /** Percentage of the tallest bar, 0–100. Never 0 for a day that spent. */
  heightPercent: number;
  /** Nothing was spent that day. */
  idle: boolean;
  /** What the tip says: the date, and the figure or that there was nothing. */
  tip: string;
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` for an instant, in UTC — the key the breakdown groups by. */
export function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Midnight UTC on the day an instant falls in. */
export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

const dayLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** The short form the month plot's two axis ends carry — `1 Mar`, `21 Mar`. */
const axisLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const weekdayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

/**
 * Every day from `from` to `to` inclusive, spend filled in from the groups.
 *
 * **The gap-filling is the point.** A breakdown returns a group only for a day
 * that has cost rows, so a month with three quiet days returns three fewer
 * groups — and a chart drawn straight from the groups would silently close the
 * gaps, making an idle week look like a busy one and moving every bar to the
 * wrong date. The prototype's own fixture has ten zero days in twenty-one for
 * exactly this reason.
 */
export function daysBetween(from: Date, to: Date, groups: UsageDay[]): UsageBar[] {
  const spend = new Map<string, number>();
  for (const group of groups) {
    if (group.key) spend.set(group.key, group.costUsd);
  }

  const bars: Omit<UsageBar, 'heightPercent'>[] = [];
  for (
    let at = utcDayStart(from);
    at.getTime() <= to.getTime();
    at = new Date(at.getTime() + DAY_MS)
  ) {
    const day = utcDayKey(at);
    const costUsd = spend.get(day) ?? 0;
    bars.push({
      day,
      costUsd,
      idle: costUsd === 0,
      tip: `${dayLabel.format(at)} · ${costUsd === 0 ? 'nothing' : moneyWords(costUsd)}`,
    });
  }

  const tallest = bars.reduce((top, bar) => Math.max(top, bar.costUsd), 0);
  return bars.map((bar) => ({
    ...bar,
    // A day that spent always draws something: a 0.4%-of-peak day rounding to a
    // bar of no height would say nothing happened, which is a different fact.
    heightPercent: bar.costUsd === 0 ? 0 : Math.max(4, Math.round((bar.costUsd / tallest) * 100)),
  }));
}

/** A plot with its own summary line and its accessible description. */
export interface UsagePlot<B extends UsageBar = UsageBar> {
  bars: B[];
  /** The figure above the plot. */
  total: string;
  /** Whether that figure is a floor. */
  totalIsFloor: boolean;
  /** What a screen reader is told instead of the bars. */
  description: string;
}

/** Where the dashed reference line sits, and what it says. */
export interface UsageAverage {
  /** Percentage from the bottom, matching the bars' scale. */
  percent: number;
  label: string;
}

/**
 * The month so far, one bar a day.
 *
 * No per-bar figures: at twenty-eight to thirty-one bars the month is read as a
 * shape, and a number over each one would be unreadable at that width. The tip
 * answers for a single day, and the average line gives the shape something to
 * be tall against.
 */
export function monthPlot(
  reading: UsageReading,
  now: Date
): UsagePlot & { average: UsageAverage | null; axisStart: string; axisEnd: string } {
  const from = new Date(reading.summary.window.from);
  const bars = daysBetween(from, now, reading.days.groups);
  const spent = bars.reduce((sum, bar) => sum + bar.costUsd, 0);
  const tallest = bars.reduce((top, bar) => Math.max(top, bar.costUsd), 0);
  const mean = bars.length > 0 ? spent / bars.length : 0;

  return {
    bars,
    total: moneyWords(spent),
    totalIsFloor: spendFloor(reading.summary),
    axisStart: axisLabel.format(from),
    axisEnd: axisLabel.format(now),
    description:
      spent === 0
        ? `Daily spend, ${dayLabel.format(from)} to ${dayLabel.format(now)}. Nothing spent yet this month.`
        : `Daily spend, ${dayLabel.format(from)} to ${dayLabel.format(now)}. ${moneyWords(spent)} in total, highest day ${moneyWords(tallest)}.`,
    // Nothing to be tall against when nothing was spent, and a line at zero
    // would sit on the axis pretending to be data.
    average:
      tallest > 0
        ? { percent: (mean / tallest) * 100, label: `average ${moneyWords(mean)} a day` }
        : null,
  };
}

/** One labelled column of the week plot — seven bars, so each carries its figure. */
export interface UsageWeekBar extends UsageBar {
  /** `Mon`, `Tue` — the axis label and the tip's subject. */
  weekday: string;
  /** The figure printed above the bar. */
  figure: string;
}

/** The last seven days ending today, each bar showing its own figure. */
export function weekPlot(reading: UsageReading, now: Date): UsagePlot<UsageWeekBar> {
  const from = new Date(utcDayStart(now).getTime() - 6 * DAY_MS);
  const bars = daysBetween(from, now, reading.days.groups).map((bar) => ({
    ...bar,
    weekday: weekdayLabel.format(new Date(`${bar.day}T00:00:00Z`)),
    figure: bar.costUsd === 0 ? '—' : moneyWords(bar.costUsd),
  }));
  const spent = bars.reduce((sum, bar) => sum + bar.costUsd, 0);

  return {
    bars,
    total: moneyWords(spent),
    // The week is a slice of the month's rows; the month's answer is the one
    // the server computed, and a slice cannot be more exact than its source.
    totalIsFloor: spendFloor(reading.summary),
    description:
      spent === 0
        ? 'Daily spend over the last seven days. Nothing spent.'
        : `Daily spend over the last seven days, ${moneyWords(spent)} in total.`,
  };
}

/**
 * The earliest instant both charts need, so one read serves both.
 *
 * The month chart wants this UTC month; the week chart wants the last seven
 * days, which on the 3rd of a month reaches back into the last one. Asking for
 * whichever is earlier is one request covering at most about thirty-seven days
 * — well inside the API's 366-day bound and its 100-group default, so neither
 * chart can be silently truncated.
 */
export function readingWindowFrom(now: Date): Date {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weekStart = new Date(utcDayStart(now).getTime() - 6 * DAY_MS);
  return weekStart.getTime() < monthStart.getTime() ? weekStart : monthStart;
}
