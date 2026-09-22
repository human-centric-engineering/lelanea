/**
 * The usage view's arithmetic and its wording (f-budget t-94).
 *
 * Every case here is a fact the view could state wrongly without anything
 * failing: a quiet day closing a gap in a chart, a total known to be short
 * printed as exact, a $0 ceiling drawn as an empty meter rather than said in
 * words, an over-ceiling month clamped into a bar that reads as "exactly used
 * up". The component tests render these; this file decides them.
 *
 * @see lib/app/usage/usage-view.ts
 */

import { describe, it, expect } from 'vitest';

import {
  daysBetween,
  meterFill,
  money,
  moneyWords,
  monthPlot,
  readingWindowFrom,
  spendFloor,
  usageStats,
  utcDayKey,
  weekPlot,
  type UsageDay,
  type UsageReading,
  type UsageSummary,
} from '@/lib/app/usage/usage-view';

const NOW = new Date('2026-03-21T14:30:00.000Z');
const MONTH_START = '2026-03-01T00:00:00.000Z';

function summary(over: Partial<UsageSummary> = {}): UsageSummary {
  return {
    userId: 'cmu8lt3aw0025o0sbw78xrnd6',
    window: { from: MONTH_START, to: NOW.toISOString() },
    costUsd: 9.35,
    inputTokens: 120_000,
    outputTokens: 40_000,
    costRows: 84,
    unpricedRows: 0,
    ceiling: { ceilingUsd: 20, source: 'default' },
    remainingUsd: 10.65,
    fractionUsed: 0.4675,
    ...over,
  };
}

function reading(days: UsageDay[], over: Partial<UsageSummary> = {}): UsageReading {
  return {
    summary: summary(over),
    days: {
      by: 'day',
      window: { from: MONTH_START, to: NOW.toISOString() },
      totals: { costUsd: 9.35, costRows: 84, unpricedRows: over.unpricedRows ?? 0 },
      groups: days,
      truncated: false,
    },
  };
}

const day = (key: string, costUsd: number): UsageDay => ({
  key,
  costUsd,
  costRows: 3,
  unpricedRows: 0,
});

describe('money', () => {
  it('prints a figure to the cent', () => {
    expect(money(9.35)).toBe('$9.35');
    expect(money(0)).toBe('$0.00');
  });

  it('refuses to round a real cost down to nothing', () => {
    // $0.00 for spend that happened is the lie the account row already refuses.
    expect(moneyWords(0.002)).toBe('less than a cent');
    // Exactly nothing is a fact, and says so as a figure.
    expect(moneyWords(0)).toBe('$0.00');
    expect(moneyWords(0.005)).toBe('$0.01');
  });
});

describe('a total that contains unpriced rows', () => {
  it('is a floor, and only then', () => {
    expect(spendFloor({ unpricedRows: 0 })).toBe(false);
    expect(spendFloor({ unpricedRows: 1 })).toBe(true);
  });

  it('is carried on the stats so the view cannot state it as exact', () => {
    expect(usageStats(summary({ unpricedRows: 2 })).spentIsFloor).toBe(true);
    expect(usageStats(summary()).spentIsFloor).toBe(false);
  });
});

describe('the three stats', () => {
  it('are spend, what is left, and the limit', () => {
    const stats = usageStats(summary());
    expect(stats).toMatchObject({
      spent: '$9.35',
      remaining: '$10.65',
      ceiling: '$20.00',
      overCeiling: false,
      nothingAllowed: false,
      ownLimit: false,
    });
  });

  it('say when the limit is this person’s own rather than everyone’s', () => {
    expect(usageStats(summary({ ceiling: { ceilingUsd: 50, source: 'override' } })).ownLimit).toBe(
      true
    );
  });

  it('call a $0 ceiling what it is: nothing may be spent', () => {
    const stats = usageStats(
      summary({
        ceiling: { ceilingUsd: 0, source: 'default' },
        fractionUsed: null,
        remainingUsd: 0,
      })
    );
    expect(stats.nothingAllowed).toBe(true);
    // Not also "over" — there is no limit to be over, and saying both would be
    // two contradictory sentences on one card.
    expect(stats.overCeiling).toBe(false);
  });

  it('say when spend has passed the limit', () => {
    // Reachable by design: the turn that crosses the line completes (t-59).
    const stats = usageStats(summary({ costUsd: 21.4, remainingUsd: 0, fractionUsed: 1.07 }));
    expect(stats.overCeiling).toBe(true);
    expect(stats.remaining).toBe('$0.00');
  });
});

describe('the meter', () => {
  it('fills to the fraction used', () => {
    expect(meterFill(summary())).toBeCloseTo(0.4675);
  });

  it('cannot be drawn at all on a $0 ceiling', () => {
    expect(meterFill(summary({ fractionUsed: null }))).toBeNull();
  });

  it('clamps the BAR at full while the stats still say it is over', () => {
    // The two are separate on purpose: clamp the number and read the bar as
    // the whole truth, and "over your limit" becomes "exactly at it".
    const over = summary({ costUsd: 21.4, fractionUsed: 1.07, remainingUsd: 0 });
    expect(meterFill(over)).toBe(1);
    expect(usageStats(over).overCeiling).toBe(true);
  });
});

describe('filling the days', () => {
  it('keeps a quiet day as a gap instead of closing it', () => {
    // The breakdown returns a group only for a day with cost rows. Drawn
    // straight from the groups, these three days would become three adjacent
    // bars and every date would be wrong.
    const bars = daysBetween(new Date('2026-03-01T00:00:00Z'), new Date('2026-03-05T09:00:00Z'), [
      day('2026-03-01', 0.45),
      day('2026-03-05', 0.62),
    ]);
    expect(bars.map((bar) => bar.day)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
    expect(bars.map((bar) => bar.idle)).toEqual([false, true, true, true, false]);
  });

  it('gives a day that spent a visible bar, however small beside the peak', () => {
    const bars = daysBetween(new Date('2026-03-01T00:00:00Z'), new Date('2026-03-02T09:00:00Z'), [
      day('2026-03-01', 10),
      day('2026-03-02', 0.01),
    ]);
    expect(bars[0].heightPercent).toBe(100);
    // 0.1% of the peak: a bar of no height would say nothing happened.
    expect(bars[1].heightPercent).toBe(4);
    expect(bars[1].idle).toBe(false);
  });

  it('gives a day that spent nothing no height at all', () => {
    const bars = daysBetween(new Date('2026-03-01T00:00:00Z'), new Date('2026-03-02T09:00:00Z'), [
      day('2026-03-01', 10),
    ]);
    expect(bars[1].heightPercent).toBe(0);
  });

  it('names the day and the figure in the tip, and says nothing where there was nothing', () => {
    const bars = daysBetween(new Date('2026-03-01T00:00:00Z'), new Date('2026-03-02T09:00:00Z'), [
      day('2026-03-01', 0.45),
    ]);
    expect(bars[0].tip).toBe('1 March · $0.45');
    expect(bars[1].tip).toBe('2 March · nothing');
  });

  it('ignores a null key rather than counting it as a day', () => {
    const bars = daysBetween(new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T09:00:00Z'), [
      { key: null, costUsd: 5, costRows: 1, unpricedRows: 0 },
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0].idle).toBe(true);
  });
});

describe('the month plot', () => {
  const days = [day('2026-03-01', 0.45), day('2026-03-15', 0.33), day('2026-03-21', 1.18)];

  it('runs from the window the server answered with to today', () => {
    const plot = monthPlot(reading(days));
    expect(plot.bars).toHaveLength(21);
    expect(plot.bars[0].day).toBe('2026-03-01');
    expect(plot.bars.at(-1)?.day).toBe('2026-03-21');
  });

  it('sums the bars it drew, so the figure and the shape agree', () => {
    expect(monthPlot(reading(days)).total).toBe('$1.96');
  });

  it('puts the average where the bars can be read against it', () => {
    const plot = monthPlot(reading(days));
    // 1.96 over 21 days against a 1.18 peak.
    expect(plot.average?.percent).toBeCloseTo((1.96 / 21 / 1.18) * 100);
    expect(plot.average?.label).toBe('average $0.09 a day');
  });

  it('draws no average line through a month that spent nothing', () => {
    // A line at zero sits on the axis pretending to be data.
    const plot = monthPlot(reading([]));
    expect(plot.average).toBeNull();
    expect(plot.total).toBe('$0.00');
    expect(plot.description).toContain('Nothing spent yet this month');
  });

  it('describes itself for a reader who cannot see it', () => {
    expect(monthPlot(reading(days)).description).toBe(
      'Daily spend, 1 March to 21 March. $1.96 in total, highest day $1.18.'
    );
  });

  it('carries the floor through from the summary', () => {
    expect(monthPlot(reading(days, { unpricedRows: 3 })).totalIsFloor).toBe(true);
  });
});

describe('the week plot', () => {
  it('is the last seven days ending today, each with its own figure', () => {
    const plot = weekPlot(reading([day('2026-03-20', 0.9), day('2026-03-21', 1.18)]));
    expect(plot.bars).toHaveLength(7);
    expect(plot.bars[0].day).toBe('2026-03-15');
    expect(plot.bars.at(-1)?.day).toBe('2026-03-21');
    expect(plot.bars.at(-1)?.figure).toBe('$1.18');
    expect(plot.bars.at(-1)?.weekday).toBe('Sat');
  });

  it('marks a day that spent nothing rather than printing $0.00 over it', () => {
    const plot = weekPlot(reading([]));
    expect(plot.bars.every((bar) => bar.figure === '—')).toBe(true);
    expect(plot.description).toBe('Daily spend over the last seven days. Nothing spent.');
  });
});

describe('where a plot stops', () => {
  it('is the instant the SERVER answered with, not the browser clock', () => {
    // Both totals on the page are server-computed. Walking the bars to a local
    // clock instead lets the two disagree: a browser a day slow would drop
    // today's bar and its spend from the chart while the headline stat, taken
    // straight from the summary, still counted it.
    const slow = reading([day('2026-03-21', 1.18)]);
    const plot = monthPlot(slow);

    expect(plot.bars.at(-1)?.day).toBe('2026-03-21');
    expect(plot.total).toBe('$1.18');
  });

  it('follows the server when its window ends on a different day', () => {
    const stale = reading([day('2026-03-19', 0.5)]);
    stale.days.window = { from: MONTH_START, to: '2026-03-19T23:00:00.000Z' };
    const plot = monthPlot(stale);

    // Nineteen bars, not twenty-one: the reading covers up to the 19th.
    expect(plot.bars).toHaveLength(19);
    expect(plot.bars.at(-1)?.day).toBe('2026-03-19');
  });
});

describe('the window both charts are read from', () => {
  it('is the start of the month when the month is already a week old', () => {
    expect(utcDayKey(readingWindowFrom(NOW))).toBe('2026-03-01');
  });

  it('reaches back into last month early in a new one, so the week chart is whole', () => {
    // On the 3rd, the last seven days start on the 25th of the month before —
    // a month-only window would leave the week chart five days short.
    expect(utcDayKey(readingWindowFrom(new Date('2026-03-03T10:00:00Z')))).toBe('2026-02-25');
  });

  it('never asks for more than the two charts need', () => {
    const from = readingWindowFrom(new Date('2026-12-31T23:59:00Z'));
    const days = (Date.parse('2026-12-31T23:59:00Z') - from.getTime()) / 86_400_000;
    expect(days).toBeLessThan(38);
  });
});
