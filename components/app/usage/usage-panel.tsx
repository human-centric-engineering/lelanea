'use client';

import { useEffect, useState } from 'react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { MonthPlot, WeekPlot } from '@/components/app/usage/plot';
import { Banner } from '@/components/app/ui/banner';
import { fetchUsage, UsageUnreadable } from '@/lib/app/usage/usage-client';
import {
  floorLabel,
  meterFill,
  monthPlot,
  remainingWords,
  usageStats,
  weekPlot,
  type UsageReading,
} from '@/lib/app/usage/usage-view';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/**
 * What this month cost, and the shape of how it was spent (f-budget t-94).
 *
 * The page this replaces was a placeholder whose copy had become false in two
 * ways: it said Lelañea was not calling a model yet (she is, since §10), and it
 * promised "a budget you set", which is the commercial phase's and not this
 * one's. Both are now gone rather than reworded.
 *
 * ## It reads; it decides nothing
 *
 * Every figure comes from the two member endpoints t-56 built
 * (`lib/app/agent/metering.ts`), and every judgement about what a figure MEANS
 * is in `usage-view.ts`, where a test can hand it a fixture. This file is the
 * arrangement: a fetch, a loading state, and three shapes on the page.
 *
 * ## Money, never tokens
 *
 * The prototype's rule — *"the token arithmetic is ours to worry about, not
 * yours"*. The tokens a turn used are in the account row under that reply,
 * where a person asked for the detail. Nothing here counts them.
 *
 * ## The ceiling is read-only, and says so by having no control
 *
 * There is no "ask for more", because there is no mechanism behind one and
 * `B31` says not to draw one (owner ruling, 22 Sept 2026; `.context/app/agent.md`,
 * "The monthly limit"). The limit is shown, what is left is shown, and that is
 * the whole of it. The commercial phase's card on file, receipts and
 * user-set budget are absent for the same reason — omitted, not stubbed.
 *
 * @see .context/app/planning/design/lelanea.html — "usage and billing"
 */

/** The lede, on the page and on its loading boundary — one source, no drift. */
export const USAGE_LEDE =
  'Every reply costs something to produce. This is what yours have come to, and what is left before Lelañea pauses until next month.';

/** The honest caveat under it: the limit is ours, and nothing is billed. */
export const USAGE_NOTE =
  'Nothing is charged to you. The limit is ours, so the work stays sustainable while it is free.';

/**
 * What the page shows while the session is read, and again while the figures
 * are fetched.
 *
 * A reader crosses two loading states back to back here — the route's, then
 * this one — so both render this rather than two different shapes arriving
 * where each other were (the reasoning `notes/loading.tsx` sets out).
 */
export function UsageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status">
        Reading what this month cost.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
        {[0, 1, 2].map((stat) => (
          <div
            key={stat}
            aria-hidden="true"
            className="bg-background h-[58px] rounded-[13px] border border-[var(--color-card-border)] opacity-60"
          />
        ))}
      </div>
      {[0, 1].map((panel) => (
        <div
          key={panel}
          aria-hidden="true"
          className={cn(
            'bg-background h-[250px] rounded-lg border border-[var(--color-card-border)]',
            'opacity-60 shadow-[var(--shadow-rest)]'
          )}
        />
      ))}
    </div>
  );
}

export interface UsagePanelProps {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

function Panel({
  heading,
  sub,
  children,
}: {
  heading: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'bg-background rounded-lg border border-[var(--color-card-border)]',
        // The resting shadow is structural, not decoration: `--color-card-border`
        // is fully transparent in light mode, so without it this panel's only
        // light-mode edge is a 1.06:1 fill difference while dark carries a
        // visible border. `settings-view.tsx` sets the reasoning out in full.
        'shadow-[var(--shadow-rest)]',
        'px-[22px] pt-5 pb-[22px]'
      )}
    >
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <h2 className="brand-display text-[22px] leading-[1.12] text-[var(--color-heading)]">
          {heading}
        </h2>
        <p className="text-muted-foreground min-w-[150px] flex-1 text-[12.5px] leading-[1.55]">
          {sub}
        </p>
      </div>
      {children}
    </section>
  );
}

function Stat({ figure, label }: { figure: string; label: string }) {
  return (
    <div className="bg-background flex min-w-0 items-baseline gap-[9px] rounded-[13px] border border-[var(--color-card-border)] px-[13px] py-[11px]">
      <b className="text-[21px] font-medium text-[var(--color-heading)] tabular-nums">{figure}</b>
      <span className="text-muted-foreground text-[12.5px]">{label}</span>
    </div>
  );
}

/**
 * It re-reads when a turn has finished (t-95), on the same `turnsSettled`
 * signal the topbar's spend meter uses — otherwise a person sending from this
 * page would watch the pill above it move to a new figure while the page it
 * links to kept the old one. The page keeps what it has on screen while the
 * re-read runs; the skeleton is the first read's only.
 */
export function UsagePanel({ fetchImpl }: UsagePanelProps) {
  const { turnsSettled } = useShellLayout();
  const [reading, setReading] = useState<UsageReading | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchUsage({ fetchImpl, signal: controller.signal })
      .then((next) => {
        // The same guard the catch has, and the one `notes-panel.tsx` puts on
        // both: a turn that finishes while a read is in flight aborts it, and
        // its late answer must not land over the newer one.
        if (controller.signal.aborted) return;
        setReading(next);
        setFailed(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailed(
          error instanceof UsageUnreadable
            ? error.message
            : 'What you have spent could not be read.'
        );
        logger.warn('Usage read failed', { error: String(error) });
      });
    return () => controller.abort();
  }, [fetchImpl, turnsSettled]);

  if (failed) {
    return (
      <Banner tone="warning" lead="This could not be read.">
        {failed} Nothing has been charged, and nothing else in the app depends on this page.
      </Banner>
    );
  }

  if (!reading) return <UsageSkeleton />;

  const stats = usageStats(reading.summary);
  const month = monthPlot(reading);
  const week = weekPlot(reading);
  const fill = meterFill(reading.summary);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
        <Stat
          figure={stats.spent}
          label={stats.spentIsFloor ? 'used this month, at least' : 'used this month'}
        />
        <Stat
          figure={remainingWords(reading.summary.remainingUsd, stats.spentIsFloor)}
          label="left"
        />
        <Stat
          figure={stats.ceiling}
          label={stats.ownLimit ? 'your monthly limit' : 'monthly limit'}
        />
      </div>

      {stats.nothingAllowed ? (
        <p className="text-muted-foreground text-[12.5px] leading-[1.55]">
          Your limit is set to nothing at the moment, so Lelañea will not start a reply that costs
          anything. Everything you can read and write still works.
        </p>
      ) : null}

      {stats.overCeiling ? (
        <p className="text-muted-foreground text-[12.5px] leading-[1.55]">
          You are past your limit for this month. Replies come back at the start of next month, and
          everything you can read and write still works in the meantime.
        </p>
      ) : fill !== null ? (
        <div
          aria-hidden
          className="h-[5px] overflow-hidden rounded-full bg-[var(--color-bar-idle)]"
        >
          <div
            className="h-full rounded-full bg-[var(--color-bar)]"
            style={{ width: `${fill * 100}%` }}
          />
        </div>
      ) : null}

      {stats.spentIsFloor ? (
        <p className="text-muted-foreground text-[12.5px] leading-[1.55]">
          Some of this month&rsquo;s replies ran on a model with no price on file, so what you see
          is at least what was spent rather than exactly it.
        </p>
      ) : null}

      <Panel heading="By day" sub="Hover or tap a bar for that day.">
        <div className="flex flex-col gap-[9px]">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <b className="text-[22px] font-medium text-[var(--color-heading)] tabular-nums">
              {floorLabel(month.total, month.totalIsFloor)}
            </b>
            <span className="text-muted-foreground text-[12.5px]">
              this month so far · {stats.ceiling} limit
            </span>
          </div>
          <MonthPlot bars={month.bars} average={month.average} description={month.description} />
          <div className="text-muted-foreground flex justify-between text-[11px] tabular-nums">
            <span>{month.axisStart}</span>
            <span>{month.axisEnd}</span>
          </div>
        </div>
      </Panel>

      <Panel
        heading="This week"
        sub="An ordinary conversation costs a few cents. Nothing is charged to you."
      >
        <div className="flex flex-col gap-[9px]">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <b className="text-[22px] font-medium text-[var(--color-heading)] tabular-nums">
              {floorLabel(week.total, week.totalIsFloor)}
            </b>
            <span className="text-muted-foreground text-[12.5px]">the last seven days</span>
          </div>
          <WeekPlot bars={week.bars} description={week.description} />
        </div>
      </Panel>
    </div>
  );
}
