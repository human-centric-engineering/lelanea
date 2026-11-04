'use client';

import { useState } from 'react';

import {
  applyTint,
  DEFAULT_TINT,
  readStoredTint,
  TINTS,
  type TintTheme,
} from '@/components/app/ui/tints';
import { cn } from '@/lib/utils';

const ROWS: readonly { theme: TintTheme; label: string }[] = [
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
];

/**
 * The picker itself: a tab at the left edge of the window that opens a small
 * panel of swatches, one row per theme. TEMPORARY — see `tint-picker.tsx` for
 * why it exists and the list t-181 deletes.
 *
 * The left edge, halfway down, because it is the one place no consumer page
 * puts anything: the nav's lotus is at the top, the composer and the small-
 * width rail are at the bottom, and the rail is on the right.
 *
 * Closed on first paint. What is chosen is read from storage when the panel
 * OPENS rather than on render, so the server's markup and the first client
 * render agree and nothing has to be corrected in an effect. The page itself
 * is already tinted by then: the server gate's script did that before paint.
 */
export function TintPickerControls() {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Record<TintTheme, string>>({
    light: DEFAULT_TINT,
    dark: DEFAULT_TINT,
  });

  function toggle() {
    if (!open) setChosen({ light: readStoredTint('light'), dark: readStoredTint('dark') });
    setOpen(!open);
  }

  function choose(theme: TintTheme, id: string) {
    applyTint(theme, id);
    setChosen((previous) => ({ ...previous, [theme]: id }));
  }

  return (
    <div className="fixed top-1/2 left-0 z-[90] flex -translate-y-1/2 items-center">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="tint-picker-panel"
        className={cn(
          'rounded-r-lg border border-l-0 border-[var(--color-border)] bg-[var(--color-popover)]',
          'px-1.5 py-3 text-[11px] tracking-[0.14em] text-[var(--color-popover-foreground)]',
          'shadow-[var(--shadow-rest)] [writing-mode:vertical-rl]',
          'hover:bg-[var(--color-pill-hover)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
        )}
      >
        tints
      </button>
      {open && (
        <div
          id="tint-picker-panel"
          role="group"
          aria-label="Choose the light"
          className={cn(
            'ml-2 flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-3',
            'bg-[var(--color-popover)] text-[var(--color-popover-foreground)] shadow-[var(--shadow-lift)]'
          )}
        >
          {ROWS.map(({ theme, label }) => (
            <div
              key={theme}
              role="group"
              aria-label={`${label} theme`}
              className="flex flex-col gap-1.5"
            >
              <span className="text-muted-foreground text-xs">{label}</span>
              <div className="flex flex-wrap gap-2">
                {TINTS[theme].map((tint) => (
                  <button
                    key={tint.id}
                    type="button"
                    data-swatch={`${theme}-${tint.id}`}
                    aria-label={tint.label}
                    aria-pressed={chosen[theme] === tint.id}
                    title={tint.label}
                    onClick={() => choose(theme, tint.id)}
                    className={cn(
                      'h-6 w-6 rounded-full border border-[var(--color-border)]',
                      'aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-[var(--color-secondary-ink)]',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="text-muted-foreground max-w-[13rem] text-xs">
            Temporary, for choosing the theme. Switch themes to see the other row.
          </p>
        </div>
      )}
    </div>
  );
}
