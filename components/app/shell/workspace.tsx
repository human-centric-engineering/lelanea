'use client';

import { MessageCircle } from 'lucide-react';
import Link from 'next/link';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { cn } from '@/lib/utils';

/**
 * The workspace surface: the right half of the core pairing.
 *
 * Where someone sees the consequence of having spoken. In this task it is a
 * frame around whatever the route renders — t-11's views arrive inside it
 * already, rather than being re-parented later, which is the reason `wsOpen` is
 * route-driven rather than a button somebody has to press.
 *
 * ## `--tone`
 *
 * Each view sets its own `--tone` and the surface reads it: the band across the
 * head, and the wash behind the conversation when it slides over on a tablet.
 * It falls back to the secondary ink, so a view that sets nothing still looks
 * deliberate rather than unstyled.
 *
 * ## Why the head is a link, not a button
 *
 * "Return to the conversation" navigates to `/app` — and because `wsOpen` is
 * derived from the route, that IS how the workspace closes. A button calling a
 * setter would be a second source of truth for something the URL already knows,
 * and would leave the two disagreeing on a back-button press.
 */
export function Workspace({ children }: { children: React.ReactNode }) {
  const { width, wsOpen, pane, chatSlim, setChatSlim } = useShellLayout();

  if (!wsOpen) return null;

  const carousel = width === 'small';
  const carouselHidden = carousel && pane !== 'ws';

  return (
    <section
      aria-label="Workspace"
      aria-hidden={carouselHidden ? 'true' : undefined}
      data-pane="ws"
      // On a tablet, clicking the surface re-parks the conversation — the
      // prototype's own gesture. Above and below that width the two panes are
      // both genuinely on screen, so there is nothing to re-park.
      onClick={width === 'medium' && !chatSlim ? () => setChatSlim(true) : undefined}
      className={cn(
        'relative flex min-w-0 flex-1 flex-col overflow-hidden',
        'border-t-[3px] border-[var(--tone,var(--color-secondary-ink))]',
        carousel && 'absolute inset-0 w-full flex-none',
        carousel && 'transition-transform duration-[340ms] ease-[var(--ease-brand)]',
        carousel && 'motion-reduce:transition-none',
        carousel && (pane === 'ws' ? 'translate-x-0' : 'pointer-events-none translate-x-full')
      )}
    >
      <header
        className={cn(
          'flex flex-none items-center gap-3 border-b border-[var(--color-divider)]',
          'px-6 py-4'
        )}
      >
        <div className="min-w-0 flex-1" />
        <Link
          href="/app"
          className={cn(
            'text-muted-foreground hover:text-foreground flex flex-none items-center gap-2',
            'rounded-full px-3 py-1.5 text-[13px] no-underline hover:no-underline',
            'hover:bg-[var(--color-pill-hover)]',
            'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
            'motion-reduce:transition-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          <MessageCircle size={15} strokeWidth={1.5} aria-hidden="true" />
          Return to the conversation
        </Link>
      </header>

      {/*
        The body scrolls, not the frame. The shell is `h-dvh overflow-hidden`, so
        without this a long view is clipped with nothing able to reach it —
        `-mx-1 px-1` for the same reason the nav carries it: `overflow-y` set to
        a non-visible value takes `overflow-x` with it, and a focus ring at the
        horizontal edge is clipped otherwise.
      */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>
    </section>
  );
}
