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

/**
 * The same refusal, in the width a chart label has.
 *
 * `moneyWords` is prose and belongs in a sentence. Printed over a week bar it
 * is four words in a column about 38px wide on a phone, so it wrapped to three
 * lines — and because the figure and the bar's track share a column, a wrapped
 * label shortened that track and the bar was drawn against a different scale
 * from its neighbours. A day that spent MORE could render shorter than one that
 * spent less, which is the defect the track fixed once already (/code-review).
 */
export function moneyTight(amount: number): string {
  if (amount > 0 && amount < 0.005) return '<$0.01';
  return money(amount);
}

/** True when a total is known to be short, so it must not be stated as exact. */
export function spendFloor(totals: { unpricedRows: number }): boolean {
  return totals.unpricedRows > 0;
}

/**
 * A total, qualified when it is a floor — but only where that reads as English.
 *
 * `moneyWords` already answers in words under a cent, and prefixing those gave
 * **"at least less than a cent"**: reachable on a new account whose priced
 * turns came to under half a cent while one ran unpriced (/code-review). The
 * qualifier belongs to a numeral; where the figure is already words, the
 * sentence under the stats is what explains the shortfall, and it says more
 * than a prefix could.
 */
export function floorLabel(total: string, isFloor: boolean): string {
  if (!isFloor || !total.startsWith('$')) return total;
  return `at least ${total}`;
}

/**
 * What is left, which is a CEILING when spend is a floor.
 *
 * The server computes `remainingUsd` as `max(0, ceiling − costUsd)`, so an
 * under-counted spend leaves an over-stated remainder — and it errs in the
 * generous direction, which is the wrong way for a figure a person plans
 * against. `spendFloor` is documented as a question every caller has to answer;
 * the spend stat and both chart totals answer it, and this one has to as well
 * (/code-review).
 */
export function remainingLabel(remaining: string, isFloor: boolean): string {
  return isFloor ? `at most ${remaining}` : remaining;
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
    // With unpriced rows real spend can be past the ceiling while `costUsd` is
    // not, so this can read false when it should be true. Nothing here can know
    // — the price is missing, not wrong — and the panel's "no price on file"
    // sentence is what tells a person the figures are short (/code-review).
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

/**
 * The shortest a bar that spent anything may be drawn.
 *
 * The average line is held to it too. Without that the two scales disagree: on
 * a month where one day carries nearly all the spend, the true mean can fall
 * below this floor while every cent-day is lifted up to it — so a dozen days
 * that were a fifth of a percent of the peak would draw ABOVE the dashed line
 * and the chart would say they beat the average (/code-review). Held to the
 * same floor they coincide with it, which reads as "about average" and is the
 * least wrong thing a floored scale can say.
 */
const MIN_BAR_PERCENT = 4;

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
    heightPercent:
      bar.costUsd === 0 ? 0 : Math.max(MIN_BAR_PERCENT, Math.round((bar.costUsd / tallest) * 100)),
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
 * The instant a reading covers up to — **the server's**, never the browser's.
 *
 * Both totals on this page are computed server-side over `[from, to)`. Walking
 * the bars to a local `new Date()` instead lets the two disagree: a browser
 * clock a day slow drops today's bar and its spend from the chart's total while
 * the headline stat, taken straight from the summary, still includes it. The
 * window the breakdown answered with is the authoritative end, and it is
 * already parsed (/code-review).
 */
export function readingEnd(reading: UsageReading): Date {
  return new Date(reading.days.window.to);
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
  reading: UsageReading
): UsagePlot & { average: UsageAverage | null; axisStart: string; axisEnd: string } {
  const from = new Date(reading.summary.window.from);
  const now = readingEnd(reading);
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
        ? {
            percent: Math.max(MIN_BAR_PERCENT, (mean / tallest) * 100),
            label: `average ${moneyWords(mean)} a day`,
          }
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
export function weekPlot(reading: UsageReading): UsagePlot<UsageWeekBar> {
  const now = readingEnd(reading);
  const from = new Date(utcDayStart(now).getTime() - 6 * DAY_MS);
  const bars = daysBetween(from, now, reading.days.groups).map((bar) => ({
    ...bar,
    weekday: weekdayLabel.format(new Date(`${bar.day}T00:00:00Z`)),
    figure: bar.costUsd === 0 ? '—' : moneyTight(bar.costUsd),
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
 * The earliest instant both charts need, so one breakdown serves both.
 *
 * The month chart wants this UTC month; the week chart wants the last seven
 * days, which on the 3rd of a month reaches back into the last one. Whichever
 * is earlier covers both in at most about thirty-seven days — well inside the
 * API's 366-day bound and its 100-group default, so neither chart can be
 * silently truncated.
 *
 * **Both arguments are the SERVER's, never a browser clock.** Deriving the
 * start locally let the two halves of the page disagree across a day boundary:
 * with a device an hour fast at the turn of a month, a locally-computed start
 * asked for six days while `monthPlot` still drew thirty-one, so twenty-five
 * days that had spend rendered as idle zeros under a headline that counted them
 * (/code-review). The summary answers with both instants, so nothing here has
 * to guess.
 */
export function readingWindowFrom(serverNow: Date, monthStart: Date): Date {
  const weekStart = new Date(utcDayStart(serverNow).getTime() - 6 * DAY_MS);
  return weekStart.getTime() < monthStart.getTime() ? weekStart : monthStart;
}
