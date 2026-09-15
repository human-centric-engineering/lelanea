'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { type DrawerId, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { FOCUSABLE } from '@/components/app/shell/focusable';
import { MapDrawerBody } from '@/components/app/shell/map-drawer';
import { ResourcesDrawerBody } from '@/components/app/shell/resources-drawer';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { cn } from '@/lib/utils';

/**
 * The panel's width, in ONE place so both drawers inherit it.
 *
 * `min(432px, 100%)` is the prototype's `.rdrawer` value, read rather than
 * guessed. Ours was `min(420px, 88vw)`, which is the wrong number twice: 12px
 * narrow everywhere, and on a phone it left a 12% strip of scrim down one side
 * that reads as a panel that failed to finish opening.
 *
 * The second half of the `min()` is what keeps it sane across the range, and is
 * why the width can be a constant at all. 432px is a fixed panel over the panes,
 * not a share of them — so it takes the same bite at 1600px as at 1000px, where
 * the panes are only about 700px wide to begin with. That is the design's
 * intent: a drawer rides OVER the work rather than squeezing it, and the scrim
 * says so. Below 432px of viewport the `100%` takes over and it is simply the
 * screen.
 */
const PANEL_W = 'w-[min(432px,100%)]';

/**
 * An ordered list, not a record keyed by id.
 *
 * `Object.keys()` returns `string[]`, so a record needed an assertion back to
 * the id union at the one place that iterates it — and it left the render order
 * as whatever the object literal happened to give. A list states both.
 */
const DRAWERS: {
  id: DrawerId;
  /** The lowercase tracked-out line above the title — `where you can go`. */
  eyebrow: string;
  /** The serif line the panel is called; also its accessible name. */
  title: string;
  /** The sentence under the title: what the panel is for. */
  lede: string;
  /** What the body renders. */
  body: React.ReactNode;
}[] = [
  {
    id: 'map',
    eyebrow: 'where you can go',
    title: 'Your map',
    lede: 'Sixteen modules. Work through them in sequence, or ask Lelañea which one fits what you are bringing.',
    body: <MapDrawerBody />,
  },
  {
    id: 'resources',
    eyebrow: 'in lelañea’s own words',
    title: 'Resources',
    lede: 'Films and reading, in her own words.',
    body: <ResourcesDrawerBody />,
  },
];

/**
 * The map and resources drawers: panels that ride over the panes.
 *
 * §04 shipped both as stubs (D6); §05 t-14 fills the map from the published
 * graph (`map-drawer.tsx`), and the resources stay an honest note until
 * phase 3. What is shared here is the MECHANISM: the slide, the scrim, the
 * focus handling and the Escape rung.
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
      // ONLY on the way in from nothing. Switching map → resources used to
      // overwrite this with the outgoing panel — which is `inert` by the time
      // the second one closes — so focus silently fell to `<body>`.
      if (returnTo.current === null) {
        // `activeElement` is `Element | null`, and only an `HTMLElement` is
        // guaranteed `focus()`. Narrowing rather than asserting means a focus
        // that lands somewhere unexpected simply is not returned to.
        returnTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      panelRef.current?.focus();
      return;
    }
    returnTo.current?.focus();
    returnTo.current = null;
  }, [drawer]);

  /**
   * Keep Tab inside the open panel.
   *
   * `aria-modal="true"` is a promise that the rest of the page is unavailable,
   * and moving focus in once does not keep it there: the panel is the last
   * focusable subtree in the document, so a single Tab left it and landed in the
   * nav, topbar or rail *underneath the scrim* — controls a sighted reader
   * cannot see and a screen-reader reader has been told do not exist.
   *
   * A cycle rather than marking the rest of the shell `inert`: the shell is not
   * one element, and `inert` on each of its parts would have to be applied and
   * unwound in the right order every time a drawer opened.
   */
  useEffect(() => {
    if (!drawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        // Nothing to land on — keep focus on the panel rather than letting it
        // escape to whatever is behind the scrim.
        event.preventDefault();
        panel.focus();
        return;
      }

      const active = document.activeElement;
      if (!event.shiftKey && (active === last || active === panel)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawer]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={cn(
          // Above the nav and the rail (both `z-50`), not below them. A dialog
          // claiming `aria-modal` while the column beside it stays undimmed and
          // clickable is telling the reader something untrue.
          'fixed inset-0 z-[70] bg-[var(--color-scrim)]',
          'transition-opacity duration-[340ms] ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          drawer ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      {DRAWERS.map(({ id, eyebrow, title, lede, body }) => {
        const open = drawer === id;
        return (
          <div
            key={id}
            ref={open ? panelRef : undefined}
            data-drawer={id}
            role="dialog"
            aria-label={title}
            aria-modal="true"
            /*
             * `inert` and `invisible`, NOT `hidden`.
             *
             * `hidden` is `display: none`, so opening changed display and
             * transform in the same commit: there is no starting style for the
             * browser to transition from, and the panel popped. That is exactly
             * the failure this component translates off-canvas to avoid — the
             * mechanism was built and then undone one attribute later.
             *
             * `visibility` does transition, so the closed panel still leaves the
             * accessibility tree and the tab order (via `inert`) without taking
             * the slide with it.
             *
             * `inert` is doing real work here rather than restating
             * `visibility`: the two are on the same transition, and
             * `visibility` flips DISCRETELY at the END of it, so without
             * `inert` the panel stays tabbable for the whole 340ms of a close.
             * This comment used to say `ShellNav`'s drawer already did the
             * same. It did not — t-22 went looking for the pattern to document
             * it and found the asymmetry; both carry `inert` now.
             */
            inert={!open}
            tabIndex={-1}
            className={cn(
              // `--color-background`, not the card. The prototype's `.rdrawer`
              // is the page ground with only its HEAD on the card wash, and the
              // difference is load-bearing rather than cosmetic: the panel is
              // where the map's tier labels are read, and their contrast is
              // measured against this ground. On the card they lose about a
              // fifth of a point, which is the margin two of the five have.
              'fixed top-0 right-0 bottom-0 z-[75] flex flex-col bg-[var(--color-background)]',
              PANEL_W,
              'border-l border-[var(--color-border)] shadow-[var(--shadow-lift)]',
              'transition-[transform,visibility] duration-[340ms] ease-[var(--ease-brand)]',
              'motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
              'focus-visible:outline-[var(--color-ring)]',
              open ? 'visible translate-x-0' : 'invisible translate-x-full'
            )}
          >
            <header
              className={cn(
                // The pale wash, ruled off from the body below — the
                // prototype's `.rdrawer .side-head`, which is the one part of
                // the panel that is NOT the page ground. Padding is its
                // `18px 18px 16px`, dropping to 14px below 760px where the
                // panel is most of a phone.
                'flex flex-none items-start gap-3 bg-[var(--color-card)]',
                'border-b border-[var(--color-divider)] px-[18px] pt-[18px] pb-4',
                'max-[760px]:px-3.5 max-[760px]:pt-3.5 max-[760px]:pb-3'
              )}
            >
              {/*
                The prototype's `.side-head`: eyebrow, serif title, lede. The
                title is an `<h2>` — the panel is a dialog with its own outline,
                and the view's `<h1>` is behind the scrim.
              */}
              <div className="min-w-0 flex-1">
                <Eyebrow as="p" className="block">
                  {eyebrow}
                </Eyebrow>
                {/* No `leading-*`: `.brand-display` sets `line-height: 1.05`
                    unlayered, so a utility here would be a dead class. */}
                <h2 className="brand-display mt-1.5 text-[27px] text-[var(--color-heading)]">
                  {title}
                </h2>
                <p className="text-muted-foreground mt-2 text-[13.5px] leading-[1.6]">{lede}</p>
              </div>
              {/*
                An OUTLINED button, not a bare glyph — the prototype's
                `.icon-btn.bordered`, which is what makes it read as a control
                rather than as a decoration in the corner of a panel.

                Rounded square rather than the prototype's disc, which is t-42:
                every icon-only control in this shell wears the same highlight,
                and one circle among rounded squares reads as the odd one out
                rather than as the pattern.
              */}
              <button
                type="button"
                onClick={closeDrawer}
                aria-label={`Close ${title.toLowerCase()}`}
                className={cn(
                  'text-muted-foreground hover:text-foreground flex h-9 w-9 flex-none',
                  'items-center justify-center rounded-[10px]',
                  'border border-[var(--color-border)] hover:bg-[var(--color-pill-hover)]',
                  'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                  'motion-reduce:transition-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                  'focus-visible:outline-[var(--color-ring)]'
                )}
              >
                <X size={17} strokeWidth={1.6} aria-hidden="true" />
              </button>
            </header>
            {/* `.rdrawer .side-body`: 16px round, 22px at the foot. */}
            <div
              className={cn(
                'min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[22px]',
                'max-[760px]:px-3 max-[760px]:pt-3 max-[760px]:pb-5'
              )}
            >
              {body}
            </div>
          </div>
        );
      })}
    </>
  );
}
