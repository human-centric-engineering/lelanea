'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { type DrawerId, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { ICON_RADIUS } from '@/components/app/shell/chrome';
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
  /**
   * The panel's own colour — the 3px rule across its head, and the eyebrow.
   *
   * **A drawer's tone is its OWN, not the view's.** The prototype sets it per
   * panel (`#dr-map` is always `--color-secondary-ink`; the resources panel
   * takes the open module's tier), which is why this is a column in this table
   * rather than a read of the `--tone` that `Panes` publishes. A panel riding
   * over the work is not part of the work.
   *
   * **It is one value today because both drawers are teal, and it must not stay
   * one value.** When the resources panel follows the open module, its tone
   * becomes that module's arc — and the rule and the eyebrow will then need
   * DIFFERENT tokens, because a 3px rule is a surface and an eyebrow is 12px
   * type. `--color-secondary-ink` happens to do both (4.91:1 light, 6.96:1
   * dark), and `--color-status-yellow` would fail the second at 2.03:1. The
   * eyebrow's colour comes from `TIER_INKS`, never from a tier's surface hue.
   */
  tone: string;
  /** What the body renders. */
  body: React.ReactNode;
}[] = [
  {
    id: 'map',
    eyebrow: 'where you can go',
    title: 'Your map',
    lede: 'Sixteen modules. Work through them in sequence, or ask Lelañea which one fits what you are bringing.',
    tone: 'var(--color-secondary-ink)',
    body: <MapDrawerBody />,
  },
  {
    id: 'resources',
    eyebrow: 'in lelañea’s own words',
    title: 'Resources',
    lede: 'Films and reading, in her own words.',
    // The prototype's fallback for a panel with no module open, which is every
    // panel until phase 3 gives resources something to follow.
    tone: 'var(--color-secondary-ink)',
    body: <ResourcesDrawerBody />,
  },
];

/**
 * The map and resources drawers: panels that ride over the PANES, and over
 * nothing else.
 *
 * §04 shipped both as stubs (D6); §05 t-14 fills the map from the published
 * graph (`map-drawer.tsx`), and the resources are the designed placeholder until
 * phase 3. What is shared here is the MECHANISM: the slide, the scrim, the focus
 * handling and the Escape rung.
 *
 * ## It is rendered inside `Panes`, and that is the whole geometry
 *
 * The design's `.rdrawer` is `position: absolute` inside `.panes`, so a panel
 * lands BELOW the topbar and stops short of the right rail. Ours was `fixed`
 * over the viewport and covered both — which is why in the design's own capture
 * the topbar is still readable and the rail button that opened the panel is
 * still lit, and in ours they were under a scrim.
 *
 * So `Drawers` moved out of the shell frame and into `Panes`, whose container is
 * already `relative`. Nothing here positions itself against the viewport any
 * more; both the panel and the scrim are `absolute inset` within the panes.
 *
 * ## Which means it is NOT modal, and says so
 *
 * This carried `aria-modal="true"` and a focus trap, and both were honest while
 * the scrim covered the shell. They are not any more: the rail beside the panel
 * is visible, undimmed and live — pressing `Map` again is how you close it —
 * and the topbar's theme toggle is one Tab away and works. A dialog claiming the
 * rest of the page is unavailable, beside a column that plainly is available, is
 * telling a screen-reader reader something the layout contradicts. Trapping Tab
 * inside it would make that true by force, in a way a sighted reader would
 * experience as the rail refusing the keyboard.
 *
 * What is kept is everything that was doing real work: `role="dialog"` with its
 * own label, focus moving IN on open and back to the opener on close, `inert` on
 * the closed panel, and Escape as the second rung of the shell's chain. A
 * complementary panel, not a modal one.
 *
 * ## Why both render, and only one is open
 *
 * `translateX` off-canvas rather than unmounting, because a panel that mounts on
 * open cannot animate in — the browser has nothing to transition from. `inert`
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

  return (
    <>
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={cn(
          // `absolute`, inside the panes — the design's `.pane-scrim`. It dims
          // the work the panel is covering and nothing else: the topbar stays
          // readable and the rail stays lit, which is what the capture shows and
          // what makes the panel's own non-modal claim true.
          'absolute inset-0 z-[34] bg-[var(--color-scrim)]',
          'transition-opacity duration-[340ms] ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          drawer ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      {DRAWERS.map(({ id, eyebrow, title, lede, tone, body }) => {
        const open = drawer === id;
        return (
          <div
            key={id}
            ref={open ? panelRef : undefined}
            data-drawer={id}
            role="dialog"
            aria-label={title}
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
              'absolute top-0 right-0 bottom-0 z-[36] flex flex-col bg-[var(--color-background)]',
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
                // The panel's own 3px rule — `.rdrawer .side-head` — which is
                // what makes the head read as the top of a panel rather than as
                // a band that wandered in from the workspace.
                'border-t-[3px] border-b border-[var(--color-divider)]',
                'px-[18px] pt-[18px] pb-4',
                'max-[760px]:px-3.5 max-[760px]:pt-3.5 max-[760px]:pb-3'
              )}
              style={{ borderTopColor: tone }}
            >
              {/*
                The prototype's `.side-head`: eyebrow, serif title, lede. The
                title is an `<h2>` — the panel is a dialog with its own outline,
                and the view's `<h1>` is behind the scrim.
              */}
              <div className="min-w-0 flex-1">
                {/*
                  Tinted, which the view's eyebrow in the workspace head is not.
                  The difference is the token: this one is `--color-secondary-ink`
                  at 4.91:1 light and 6.96:1 dark, measured; that one would be a
                  RAW arc hue, two of which fail AA at this size. Same rule as
                  `TIER_INKS` — coloured type and coloured surface are different
                  questions, and the answer is a different token, not a
                  different opinion about contrast.
                */}
                <Eyebrow as="p" className="block" style={{ color: tone }}>
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
                  'items-center justify-center',
                  ICON_RADIUS,
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
