'use client';

import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/** Which side of the control the bubble sits on — the prototype's `tip-r` / `tip-l`. */
export type TipSide = 'left' | 'right';

/** What a trigger has to spread onto itself for the bubble to work. */
export interface TipTrigger {
  ref?: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
  onPointerEnter?: (event: React.PointerEvent) => void;
  onPointerLeave?: () => void;
  onPointerDown?: () => void;
  onFocus?: (event: React.FocusEvent) => void;
  onBlur?: () => void;
}

/**
 * The brand tooltip, for a control that is an icon and nothing else.
 *
 * The prototype does this with a pseudo-element — `.tip-r::after { content:
 * attr(data-tip) }` — and that is the shape this started as. **It cannot work in
 * our tree**, and the reason is one line in `shell-nav.tsx`: the nav's item list
 * is `overflow-y-auto`, so that a short viewport can still reach the account
 * footer. `overflow-y` set to anything but `visible` takes `overflow-x` with it,
 * so an absolutely-positioned bubble hanging 12px off the right edge of a 44px
 * icon is clipped to nothing. The prototype's `.lnav-body` has no overflow at
 * all, which is why the pseudo-element is enough there and not here.
 *
 * So the bubble is `position: fixed` and measured from the trigger's own box on
 * the way in. Fixed escapes an ancestor's overflow without a portal — the one
 * thing that would break it is an ancestor establishing a containing block (a
 * `transform`, `filter` or `contain`), and the only transform on this path is
 * the ≤900px nav drawer's slide, at a width where nothing is ever slim.
 *
 * ## It is always mounted, and that is what buys the fade
 *
 * Mounting on hover gives the browser nothing to transition from — the same
 * `display: none` trap `drawer.tsx` documents at length. The bubble is therefore
 * in the DOM from the start, `invisible opacity-0`, and only its coordinates are
 * computed on the way in. `visibility` is on the transition alongside opacity so
 * it leaves the accessibility tree rather than sitting invisible over the shell.
 *
 * ## It never fires on touch
 *
 * A hover tooltip that latches on tap sits over the very thing it describes,
 * which on the ≤900px rail is a thumb-sized button (t-35). `pointerenter` is
 * therefore ignored for `touch`, and focus only shows it when the focus is
 * keyboard focus (`:focus-visible`) — a tap that moves focus into a button does
 * not.
 *
 * ## The bubble is not the accessible name
 *
 * It is `aria-hidden`. Every caller already gives its control a real name — an
 * `aria-label`, or an `sr-only` span — because a tooltip that IS the name is a
 * name nobody reading with a screen reader can reach.
 */
export function Tipped({
  side,
  label,
  children,
}: {
  side: TipSide;
  /** `null` renders the trigger with no bubble and no handlers at all. */
  label: string | null;
  children: (trigger: TipTrigger) => React.ReactNode;
}) {
  /*
   * The trigger is held in STATE, not in a `useRef`, and that is not a style
   * choice: `react-hooks/refs` rejects handing a ref out of a render prop,
   * because it cannot see what the caller does with it and a ref read during
   * render is a genuine bug class. A callback ref that sets state is the
   * sanctioned shape, and it costs one extra render when the node attaches.
   */
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);

  const hide = useCallback(() => setAt(null), []);
  const show = useCallback(() => {
    if (!node) return;
    const box = node.getBoundingClientRect();
    const top = box.top + box.height / 2;
    setAt(
      side === 'right'
        ? { top, left: box.right + 12 }
        : { top, right: window.innerWidth - box.left + 12 }
    );
  }, [node, side]);

  /*
   * The coordinates are a snapshot, so anything that moves the trigger under a
   * resting pointer leaves the bubble behind. Scrolling the nav's item list is
   * the case that actually happens — on a short viewport, with the pointer
   * still over the icon. Dismiss rather than re-measure: a tooltip is a
   * momentary thing, and re-measuring on every scroll frame is work for a
   * bubble the reader has already stopped looking at.
   */
  useEffect(() => {
    if (!at) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [at, hide]);

  if (label === null) return <>{children({})}</>;

  return (
    <>
      {children({
        ref: setNode,
        // Mouse and pen only. A touch pointer gets no tooltip at all.
        onPointerEnter: (event) => {
          if (event.pointerType === 'touch') return;
          show();
        },
        onPointerLeave: hide,
        // A press is an answer. Leaving the bubble up over a drawer that has
        // just slid in from under it is the thing it describes, covered.
        onPointerDown: hide,
        onFocus: (event) => {
          // Keyboard focus only. `:focus-visible` is the browser's own answer
          // to "did they mean to be here", and it is already what every focus
          // ring in this shell is drawn from.
          if (event.currentTarget.matches(':focus-visible')) show();
        },
        onBlur: hide,
      })}
      <span
        aria-hidden="true"
        style={at ? { top: at.top, left: at.left, right: at.right } : undefined}
        className={cn(
          'pointer-events-none fixed z-[80] -translate-y-1/2 rounded-[9px] px-[11px] py-1.5',
          'border border-[var(--color-border)] bg-[var(--color-popover)]',
          'text-[12.5px] leading-normal font-normal tracking-normal whitespace-nowrap normal-case',
          'text-[var(--color-foreground)] shadow-[var(--shadow-rest)]',
          'transition-[opacity,visibility] duration-[160ms] ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          at ? 'visible opacity-100' : 'invisible opacity-0'
        )}
      >
        {label}
      </span>
    </>
  );
}
