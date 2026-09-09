import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The four tones of §6.6, each pointing at a status trio the palette already
 * carries — base for the dot and the edge, `-bg` for the wash, `-ink` for the
 * text.
 *
 * ## Why tokens rather than the kit's per-tone hexes
 *
 * The kit hard-codes twelve light-mode colours here and has no dark values at
 * all, so a banner on a charcoal page would have painted a pale wash with dark
 * text on it. Routing each tone through the palette's trio makes the whole
 * component mode-aware without knowing what a mode is: the `-bg` washes lighten
 * and the `-ink` values lift in the dark block, and this file does not change.
 *
 * ## `info` needed a token that did not exist
 *
 * §6.2 names five functional hues; the palette had rows for four. Info steel
 * slate blue had never been consumed, so t-2 added `--color-status-blue` and its
 * pair rather than borrowing the teal — which is a brand colour with a job
 * (navigation and active states, §6.2) and would have made an informational
 * banner look like something you could act on.
 */
const BANNER_TONES = {
  success: {
    wash: 'bg-[var(--color-status-green-bg)]',
    edge: 'border-[var(--color-status-green)]',
    ink: 'text-[var(--color-status-green-ink)]',
    dot: 'bg-[var(--color-status-green)]',
  },
  error: {
    wash: 'bg-[var(--color-status-red-bg)]',
    edge: 'border-[var(--color-status-red)]',
    ink: 'text-[var(--color-status-red-ink)]',
    dot: 'bg-[var(--color-status-red)]',
  },
  warning: {
    wash: 'bg-[var(--color-status-yellow-bg)]',
    edge: 'border-[var(--color-status-yellow)]',
    ink: 'text-[var(--color-status-yellow-ink)]',
    dot: 'bg-[var(--color-status-yellow)]',
  },
  info: {
    wash: 'bg-[var(--color-status-blue-bg)]',
    edge: 'border-[var(--color-status-blue)]',
    ink: 'text-[var(--color-status-blue-ink)]',
    dot: 'bg-[var(--color-status-blue)]',
  },
} as const;

export type BannerTone = keyof typeof BANNER_TONES;

export interface BannerProps extends React.ComponentPropsWithoutRef<'div'> {
  tone?: BannerTone;
  /** The lead phrase, set in medium. §6.10: sentence case, no exclamation. */
  lead?: React.ReactNode;
}

/**
 * A quiet system-state banner — a dot, a lead phrase, then the detail.
 *
 * ## It announces itself, and how loudly depends on the tone
 *
 * A banner is almost always rendered in response to something the reader just
 * did, which means it appears after the page has been read. `error` gets
 * `role="alert"` so it interrupts; the other three get `role="status"`, which
 * queues politely behind whatever is being said. The kit had neither, so a
 * screen-reader user was told nothing at all — and a banner nobody is told about
 * is the same as no banner (`HB9`, one layer up).
 *
 * The dot is decorative: it repeats the tone, which the text already carries, so
 * it is `aria-hidden` and the border is not the only thing distinguishing one
 * tone from another (WCAG 1.4.1).
 *
 * @see .context/app/planning/lelanea-product-description.md §6.6, §6.10
 */
export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { tone = 'info', lead, className, children, ...props },
  ref
) {
  const palette = BANNER_TONES[tone];

  return (
    <div
      ref={ref}
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-md border p-4 text-sm leading-normal',
        palette.wash,
        palette.edge,
        palette.ink,
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('mt-[7px] size-2 shrink-0 rounded-full', palette.dot)}
      />
      <div>
        {lead ? <strong className="font-medium">{lead} </strong> : null}
        {children}
      </div>
    </div>
  );
});
