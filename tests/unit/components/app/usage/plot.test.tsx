// @vitest-environment happy-dom

/**
 * The two plots, and the tip (f-budget t-94).
 *
 * The tip is the half of this component that a reading of the markup cannot
 * check: it is delegated from the plot, reads `data-tip` off whatever the
 * pointer entered, and positions itself from that element's own box. It was
 * proven once by hand in a real browser; these cases are what stop it being
 * silently lost.
 *
 * @see components/app/usage/plot.tsx
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MonthPlot, WeekPlot } from '@/components/app/usage/plot';
import type { UsageBar, UsageWeekBar } from '@/lib/app/usage/usage-view';

const bar = (day: string, costUsd: number, heightPercent: number): UsageBar => ({
  day,
  costUsd,
  heightPercent,
  idle: costUsd === 0,
  tip: `${day} · ${costUsd === 0 ? 'nothing' : `$${costUsd.toFixed(2)}`}`,
});

const BARS = [bar('2026-03-01', 0.45, 38), bar('2026-03-02', 0, 0), bar('2026-03-03', 1.18, 100)];

describe('the month plot', () => {
  it('is one image with the description as its name, not a bar per tab stop', () => {
    render(<MonthPlot bars={BARS} average={null} description="Daily spend, all of it." />);

    const plot = screen.getByRole('img', { name: 'Daily spend, all of it.' });
    // Thirty-one focusable bars would be thirty-one tab stops between a person
    // and the rest of the page.
    expect(within(plot).queryAllByRole('button')).toHaveLength(0);
    expect(plot.querySelectorAll('[data-tip]')).toHaveLength(3);
  });

  it('draws a quiet day as a sliver rather than as nothing at all', () => {
    render(<MonthPlot bars={BARS} average={null} description="d" />);

    const plot = screen.getByRole('img');
    const idle = plot.querySelectorAll('[data-idle]');
    expect(idle).toHaveLength(1);
    // A gap in the row of days would read as a break in time, not as a quiet day.
    expect((idle[0] as HTMLElement).style.height).toBe('3px');
  });

  it('scales a day that spent to its share of the tallest', () => {
    render(<MonthPlot bars={BARS} average={null} description="d" />);
    const bars = screen.getByRole('img').querySelectorAll<HTMLElement>('[data-tip]');
    expect(bars[0].style.height).toBe('38%');
    expect(bars[2].style.height).toBe('100%');
  });

  it('raises the day and the figure when a pointer enters a bar', () => {
    render(<MonthPlot bars={BARS} average={null} description="d" />);

    const plot = screen.getByRole('img');
    const tallest = plot.querySelectorAll('[data-tip]')[2];
    expect(within(plot).queryByText('2026-03-03 · $1.18')).not.toBeInTheDocument();

    fireEvent.pointerOver(tallest);
    expect(within(plot).getByText('2026-03-03 · $1.18')).toBeInTheDocument();
  });

  it('says a quiet day spent nothing rather than showing it $0.00', () => {
    render(<MonthPlot bars={BARS} average={null} description="d" />);
    const plot = screen.getByRole('img');
    fireEvent.pointerOver(plot.querySelectorAll('[data-tip]')[1]);
    expect(within(plot).getByText('2026-03-02 · nothing')).toBeInTheDocument();
  });

  it('takes the tip away when the pointer leaves the bar', () => {
    render(<MonthPlot bars={BARS} average={null} description="d" />);

    const plot = screen.getByRole('img');
    const first = plot.querySelectorAll('[data-tip]')[0];
    fireEvent.pointerOver(first);
    expect(within(plot).getByText('2026-03-01 · $0.45')).toBeInTheDocument();

    fireEvent.pointerOut(first);
    expect(within(plot).queryByText('2026-03-01 · $0.45')).not.toBeInTheDocument();
  });

  it('ignores a pointer that entered the plot but no bar', () => {
    render(<MonthPlot bars={BARS} average={null} description="d" />);
    const plot = screen.getByRole('img');

    fireEvent.pointerOver(plot);
    // Nothing raised, and nothing thrown: `closest` found no bar.
    expect(plot.querySelectorAll('[data-tip]')).toHaveLength(3);
    expect(within(plot).queryByText(/2026-03/)).not.toBeInTheDocument();
  });

  it('draws the average where one was worked out, and nothing where none was', () => {
    const { rerender } = render(
      <MonthPlot
        bars={BARS}
        average={{ percent: 31, label: 'average $0.09 a day' }}
        description="d"
      />
    );
    expect(screen.getByText('average $0.09 a day')).toBeInTheDocument();

    rerender(<MonthPlot bars={BARS} average={null} description="d" />);
    expect(screen.queryByText(/average/)).not.toBeInTheDocument();
  });
});

describe('the week plot', () => {
  const week: UsageWeekBar[] = BARS.map((b, i) => ({
    ...b,
    weekday: ['Sun', 'Mon', 'Tue'][i],
    figure: b.costUsd === 0 ? '—' : `$${b.costUsd.toFixed(2)}`,
  }));

  it('prints each bar’s own figure, so it needs no tip', () => {
    render(<WeekPlot bars={week} description="Daily spend over the last seven days." />);

    expect(screen.getByText('$0.45')).toBeInTheDocument();
    expect(screen.getByText('$1.18')).toBeInTheDocument();
    // A dash, not "$0.00" — which would read as a day that cost nothing to run
    // rather than a day with nothing on it.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('img').querySelectorAll('[data-tip]')).toHaveLength(0);
  });

  it('gives the bar its own track, so the tallest days are not flattened', () => {
    // The defect: as a direct flex child beside the figure, a bar at
    // `height: 100%` resolved against the whole column — figure + gap + bar
    // overflowed and flex shrank the bar to fit, so every day above roughly
    // 86% of the peak drew at the same height and $9.00 looked like $10.00.
    render(<WeekPlot bars={week} description="d" />);

    const plot = screen.getByRole('img');
    for (const column of plot.children) {
      const track = column.lastElementChild;
      // The percentage must be of a box that holds nothing else.
      expect(track?.className).toContain('flex-1');
      expect(track?.children).toHaveLength(1);
      expect(track?.firstElementChild?.tagName).toBe('I');
    }
  });

  it('names the weekdays under the bars', () => {
    render(<WeekPlot bars={week} description="d" />);
    for (const day of ['Sun', 'Mon', 'Tue']) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
  });
});
