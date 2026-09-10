'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { type DrawerId, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { cn } from '@/lib/utils';

const DRAWERS: Record<DrawerId, { title: string; note: string }> = {
  map: {
    title: 'Your map',
    note: 'The sixteen modules, and where you are among them. This arrives with the journey.',
  },
  resources: {
    title: 'Resources',
    note: 'Films and reading, in her own words. These arrive later in the programme.',
  },
};

/**
 * The map and resources drawers: panels that ride over the panes.
 *
 * Both are stubs in this task (D6) — the map needs §05's modules and the
 * resources need phase 3 — so each says what it will hold rather than showing an
 * empty list, which reads as broken. What is real here is the MECHANISM: the
 * slide, the scrim, the focus handling and the Escape rung, all of which §05 and
 * f-resources then fill rather than build.
 *
 * ## Why both render, and only one is open
 *
 * `translateX` off-canvas rather than unmounting, because a panel that mounts on
 * open cannot animate in — the browser has nothing to transition from. `hidden`
 * on the closed one keeps it out of the accessibility tree and out of the tab
 * order, which `aria-hidden` alone would not do.
 */
export function Drawers() {
  const { drawer, closeDrawer } = useShellLayout();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  /**
   * Focus moves in, and comes back to the control that opened it.
   *
   * Without the return half, closing a drawer with Escape drops focus onto
   * `<body>` and a keyboard reader is back at the top of the document — which is
   * the quiet way a panel becomes unusable without a pointer.
   */
  useEffect(() => {
    if (drawer) {
      returnTo.current = document.activeElement as HTMLElement | null;
      panelRef.current?.focus();
      return;
    }
    returnTo.current?.focus();
    returnTo.current = null;
  }, [drawer]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={cn(
          'fixed inset-0 z-40 bg-[var(--color-scrim)]',
          'transition-opacity duration-[340ms] ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          drawer ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      {(Object.keys(DRAWERS) as DrawerId[]).map((id) => {
        const open = drawer === id;
        const { title, note } = DRAWERS[id];
        return (
          <div
            key={id}
            ref={open ? panelRef : undefined}
            data-drawer={id}
            role="dialog"
            aria-label={title}
            aria-modal="true"
            hidden={!open}
            tabIndex={-1}
            className={cn(
              'bg-card fixed top-0 right-0 bottom-0 z-50 flex w-[min(420px,88vw)] flex-col',
              'border-l border-[var(--color-border)] shadow-[var(--shadow-lift)]',
              'transition-transform duration-[340ms] ease-[var(--ease-brand)]',
              'motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
              'focus-visible:outline-[var(--color-ring)]',
              open ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <header
              className={cn(
                'flex flex-none items-center gap-3 border-b border-[var(--color-divider)] px-5 py-4'
              )}
            >
              <Eyebrow className="min-w-0 flex-1">{title}</Eyebrow>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label={`Close ${title.toLowerCase()}`}
                className={cn(
                  'text-muted-foreground hover:text-foreground flex h-8 w-8 flex-none',
                  'items-center justify-center rounded-full hover:bg-[var(--color-pill-hover)]',
                  'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                  'motion-reduce:transition-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                  'focus-visible:outline-[var(--color-ring)]'
                )}
              >
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <p className="text-muted-foreground text-sm leading-relaxed">{note}</p>
            </div>
          </div>
        );
      })}
    </>
  );
}
