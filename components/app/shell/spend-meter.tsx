'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { fetchUsageSummary, USAGE_PAGE } from '@/lib/app/usage/usage-client';
import {
  METER_NAME,
  meterReading,
  msUntilNextMonth,
  type MeterReading,
} from '@/lib/app/usage/usage-view';
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
 * ## When it reads — on mount, after each finished turn, and at the month's turn
 *
 * One `GET /api/v1/app/usage`, summary only (`fetchUsageSummary`); the by-day
 * breakdown is the page's, not the bar's. The topbar lives in the app layout,
 * which is not re-rendered between pages, so **moving between pages does not
 * re-read**. After that it re-reads:
 *
 * - **When `turnsSettled` on the shell provider moves** — once per turn,
 *   however it ended, never per streamed frame, and `COST_SETTLE_MS` after the
 *   turn rather than at it, because the platform writes the turn's cost without
 *   waiting and a read at `done` can miss it.
 * - **Once, when the month turns** (`msUntilNextMonth`, on the server's clock).
 *   A tab left open showing "past your limit" on the 30th would otherwise say
 *   so all through the 1st, and a person believing it would not send.
 *
 * That is the whole schedule: no polling, no focus listener. The month-to-date
 * aggregate it calls is the watch item in `agent.md` (f-budget ruling 5), and
 * gets no index and no cache here. A ceiling an admin changes shows at the
 * next turn — including the turn a person tries past a limit the pill still
 * shows, since that attempt settles too.
 *
 * A read that is overtaken aborts, so the answer on screen is the latest one.
 * While a re-read is in flight the previous figure stays up, as the notes panel
 * keeps its notes: "still reading" below is the FIRST read, when there is none.
 *
 * Not rendered at ≤900px, where the prototype drops it too — "a desk-side
 * reassurance, not a phone one", one tap away in the account menu — so a phone
 * does not re-read after every turn for a bar it cannot show. The cost of that
 * is a remount, and so a read, each time the window crosses 900px; and the
 * provider's first pass is `large` until its layout effect measures, so a
 * phone's first mount may start one read that is aborted on the next render.
 *
 * ## No state draws a bar it cannot stand behind
 *
 * `meterReading()` decides, from the summary, whether a bar is honest at all:
 * a $0 ceiling and a month past the ceiling are phrases, not bars. The two
 * states it never sees are this file's — the first read, and could not read —
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
  // The month's turn, as a counter the read below is keyed on, and how long
  // until the next one — set from each reading, so it follows the server.
  const [monthsTurned, setMonthsTurned] = useState(0);
  const [wakeIn, setWakeIn] = useState<number | null>(null);

  useEffect(() => {
    if (wakeIn === null) return;
    const timer = setTimeout(() => setMonthsTurned((count) => count + 1), wakeIn);
    return () => clearTimeout(timer);
  }, [wakeIn]);

  useEffect(() => {
    const controller = new AbortController();
    fetchUsageSummary({ fetchImpl, signal: controller.signal })
      .then((summary) => {
        if (controller.signal.aborted) return;
        setState(meterReading(summary));
        setWakeIn(msUntilNextMonth(summary.window));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'failed' });
        logger.warn('Spend meter read failed', { error: String(error) });
      });
    return () => controller.abort();
  }, [turnsSettled, monthsTurned, fetchImpl]);

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
