'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { fetchUsageSummary, USAGE_PAGE } from '@/lib/app/usage/usage-client';
import { METER_NAME, meterReading, type MeterReading } from '@/lib/app/usage/usage-view';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/**
 * The topbar's spend meter: this month against the ceiling, on every screen in
 * the shell (f-budget t-95).
 *
 * `shell.md` held this seam open from §04 — "omitted from the topbar rather than
 * faked" — because until §10 nothing metered spend and `$12.40 left` would have
 * been invented. It is the standing answer to "how much is left", so a person
 * learns about their limit before they reach it rather than by reaching it.
 *
 * ## It opens Usage, and nothing else
 *
 * The glanceable control for `/app/usage`, beside the account menu's row for
 * the same place — the owner's ruling of 15 September 2026 keeps both. The
 * prototype marks it up as a `<button>`; it is a **link** here because all it
 * does is go somewhere, and a link is what a screen reader, a middle click and
 * "open in new tab" all expect of that. Keyboard reach, the pill and the name
 * are the prototype's.
 *
 * ## When it reads — on mount, and once after each finished turn
 *
 * One `GET /api/v1/app/usage`, summary only (`fetchUsageSummary`); the by-day
 * breakdown is the page's, not the bar's. The topbar lives in the app layout,
 * which is not re-rendered between pages, so **moving between pages does not
 * re-read**. After that it re-reads when `turnsSettled` on the shell provider
 * moves — bumped once per turn by `useConversation`'s `finish`, however the turn
 * ended, and never per streamed frame. That is the whole schedule: no timer, no
 * focus listener, nothing that can call the month-to-date aggregate more often
 * than a person can spend (f-budget ruling 5 — that aggregate is the watch item
 * in `agent.md`, and it gets no index and no cache here).
 *
 * A turn that lands while a read is in flight aborts it and asks again, so the
 * answer on screen is the one taken after the latest turn.
 *
 * Not rendered at ≤900px, where the prototype drops it too — "a desk-side
 * reassurance, not a phone one", one tap away in the account menu — so a phone
 * does not re-read after every turn for a bar it cannot show. The provider's
 * first pass is `large` until its layout effect measures, so a phone's first
 * mount may start one read that is aborted on the next render.
 *
 * ## No state draws a bar it cannot stand behind
 *
 * `meterReading()` decides, from the summary, whether a bar is honest at all:
 * a $0 ceiling and a month past the ceiling are phrases, not bars. The two
 * states it never sees are this file's — still reading, and could not read —
 * and both are a word with no bar, because an empty track reads as "all of it
 * left" and a bar left over from an earlier read is a figure nobody can vouch
 * for any more.
 */

type MeterState = { kind: 'reading' } | { kind: 'failed' } | MeterReading;

export interface SpendMeterProps {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export function SpendMeter({ fetchImpl }: SpendMeterProps) {
  const { turnsSettled } = useShellLayout();
  const pathname = usePathname();
  const [state, setState] = useState<MeterState>({ kind: 'reading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchUsageSummary({ fetchImpl, signal: controller.signal })
      .then((summary) => {
        if (controller.signal.aborted) return;
        setState(meterReading(summary));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'failed' });
        logger.warn('Spend meter read failed', { error: String(error) });
      });
    return () => controller.abort();
  }, [turnsSettled, fetchImpl]);

  const { figure, name } = words(state);

  return (
    <Link
      href={USAGE_PAGE}
      aria-label={name}
      aria-current={pathname === USAGE_PAGE ? 'page' : undefined}
      className={cn(
        'flex h-8 flex-none items-center gap-[9px] rounded-full px-[13px]',
        'border border-[var(--color-border)] bg-[var(--color-card)]',
        'text-muted-foreground text-[12.5px] whitespace-nowrap tabular-nums',
        'no-underline hover:no-underline',
        'hover:text-foreground hover:bg-[var(--color-pill-hover)]',
        'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
        'motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
        'focus-visible:outline-[var(--color-ring)]',
        'aria-[current=page]:border-[var(--color-secondary-ink)]',
        'aria-[current=page]:text-[var(--color-secondary-ink)]'
      )}
    >
      {state.kind === 'meter' ? (
        <span
          aria-hidden="true"
          data-meter-track=""
          className="block h-[5px] w-10 overflow-hidden rounded-full bg-[var(--color-bar-idle)]"
        >
          <i
            data-meter-fill=""
            className="block h-full rounded-full bg-[var(--color-bar)]"
            style={{ width: `${state.fill * 100}%` }}
          />
        </span>
      ) : null}
      <span>{figure}</span>
    </Link>
  );
}

/** What the two states `meterReading()` never sees print, and are called. */
function words(state: MeterState): { figure: string; name: string } {
  switch (state.kind) {
    case 'reading':
      return { figure: 'usage', name: METER_NAME };
    case 'failed':
      return {
        figure: 'usage unreadable',
        name: `${METER_NAME}: usage unreadable, what you have spent could not be read`,
      };
    default:
      return { figure: state.figure, name: state.name };
  }
}
