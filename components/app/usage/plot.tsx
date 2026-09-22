'use client';

import { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';
import type { UsageAverage, UsageBar, UsageWeekBar } from '@/lib/app/usage/usage-view';

/**
 * The two bar charts, drawn in CSS (f-budget t-94).
 *
 * ## Why not a charting library
 *
 * `recharts` and `echarts` are both in `package.json` — for Sunrise's admin,
 * where `components/admin/orchestration/costs/` uses them. Nothing under
 * `components/app/**` does, and these two plots are flex children with a height
 * percentage: the tokens (`--color-bar`, `--color-bar-idle`) are already in
 * `app/brand-theme.css`, and the prototype draws exactly this with a `<div>` per
 * day. Pulling a charting runtime into a member bundle to draw a rectangle
 * would be the bigger decision, and it would be made here, by accident. Revisit
 * at the first chart a `<div>` cannot honestly draw (f-budget ruling 1).
 *
 * ## A bar chart a screen reader cannot read is not a chart
 *
 * Each plot is one `role="img"` with an `aria-label` that says what the shape
 * says — the window, the total, the peak — because thirty-one focusable bars
 * would be thirty-one tab stops between a person and the rest of the page, and
 * a `<div>` per day announces nothing at all. The month's figures are in the
 * tip; the week's are printed above each bar, where they are read in order as
 * ordinary text.
 *
 * ## The tip is pointer-driven, so a tap raises what a hover does
 *
 * `pointerover`, not `mouseover` — the prototype's own note, and the reason a
 * touch device gets the figures at all. It is delegated from the plot rather
 * than bound per bar: one listener, and the bars stay plain elements.
 *
 * The week plot has no tip. Its seven bars already print their own figures, and
 * a bubble repeating the number under the pointer would be a second copy of
 * what is on screen.
 */

interface TipState {
  text: string;
  left: number;
  top: number;
}

function useBarTip(): [TipState | null, React.ComponentProps<'div'>] {
  const [tip, setTip] = useState<TipState | null>(null);

  // `instanceof`, not `as HTMLElement`: a pointer event's target is typed
  // `EventTarget`, and `closest` belongs to an Element rather than to all of
  // them. The cast would compile and throw; the guard narrows, and it is also
  // what makes "the pointer entered the plot but no bar" a quiet no-op.
  const onPointerOver = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    const bar = event.target.closest<HTMLElement>('[data-tip]');
    if (!bar) return;
    setTip({
      text: bar.dataset.tip ?? '',
      left: bar.offsetLeft + bar.offsetWidth / 2,
      top: bar.offsetTop,
    });
  }, []);

  const onPointerOut = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('[data-tip]')) setTip(null);
  }, []);

  return [tip, { onPointerOver, onPointerOut }];
}

function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <span
      // Not `aria-hidden`: it is a pointer affordance, and the plot's own label
      // already carries the figures for a reader who is not using one.
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-[112%]',
        'rounded-[9px] border border-[var(--color-border)] bg-[var(--color-popover)] px-2.5 py-[5px]',
        'text-foreground text-xs whitespace-nowrap tabular-nums shadow-[var(--shadow-rest)]'
      )}
      style={{ left: tip.left, top: tip.top }}
    >
      {tip.text}
    </span>
  );
}

/** The month so far: one bar a day, no per-bar figures, an average to read against. */
export function MonthPlot({
  bars,
  average,
  description,
}: {
  bars: UsageBar[];
  average: UsageAverage | null;
  description: string;
}) {
  const [tip, handlers] = useBarTip();

  return (
    <div
      role="img"
      aria-label={description}
      className="relative flex h-[118px] items-end gap-[2px] border-b border-[var(--color-divider)]"
      {...handlers}
    >
      {bars.map((bar) => (
        <div
          key={bar.day}
          data-tip={bar.tip}
          data-idle={bar.idle || undefined}
          className={cn(
            'min-w-[3px] flex-1 rounded-t-[4px] transition-colors duration-150',
            bar.idle
              ? 'bg-[var(--color-bar-idle)]'
              : 'bg-[var(--color-bar)] hover:bg-[var(--color-primary)]'
          )}
          // An idle day still draws a 3px sliver, so the axis reads as a run of
          // days rather than as gaps in the chart itself.
          style={{ height: bar.idle ? '3px' : `${bar.heightPercent}%` }}
        />
      ))}
      {average ? (
        <div
          aria-hidden
          // `pointer-events-none` for the reason `Tip` has it: the label is a
          // real box sitting over the tallest bars at the right-hand end, and
          // without this it swallows the pointer — `closest('[data-tip]')`
          // finds nothing and those days, the ones a reader is most likely to
          // probe on a busy month, raise no tip at all (/code-review).
          className="pointer-events-none absolute right-0 left-0 z-[2] border-t border-dashed border-[var(--color-border)]"
          style={{ bottom: `${average.percent}%` }}
        >
          <span className="bg-background text-muted-foreground absolute top-[-17px] right-0 rounded-[5px] px-[5px] text-[10.5px] tabular-nums">
            {average.label}
          </span>
        </div>
      ) : null}
      <Tip tip={tip} />
    </div>
  );
}

/** The last seven days: each bar carries its own figure, so there is no tip. */
export function WeekPlot({ bars, description }: { bars: UsageWeekBar[]; description: string }) {
  return (
    <>
      <div
        role="img"
        aria-label={description}
        className="flex h-[140px] items-end gap-2 border-b border-[var(--color-divider)]"
      >
        {bars.map((bar) => (
          <div key={bar.day} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <em className="text-muted-foreground text-[11.5px] not-italic tabular-nums">
              {bar.figure}
            </em>
            {/*
              The bar gets its OWN track, and the percentage is of that rather
              than of the column. With the bar as a direct flex child beside
              the figure, `height: 100%` resolved against the full column — so
              figure + gap + bar overflowed, and flex silently shrank the bar
              to fit. Every day above roughly 86% of the peak came out the same
              height: $9.00 and $10.00 drew as one. The track is what is left
              after the figure, so 100% fills it exactly and the scale is
              linear again (/code-review).
            */}
            <div className="flex w-full flex-1 items-end">
              <i
                className={cn(
                  'block w-full rounded-t-[4px] transition-colors duration-150',
                  bar.idle ? 'bg-[var(--color-bar-idle)]' : 'bg-[var(--color-bar)]'
                )}
                style={{ height: bar.idle ? '3px' : `${bar.heightPercent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground flex text-[11px] tabular-nums">
        {bars.map((bar) => (
          <span key={bar.day} className="flex-1 text-center">
            {bar.weekday}
          </span>
        ))}
      </div>
    </>
  );
}
