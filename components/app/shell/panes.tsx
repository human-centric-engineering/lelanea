'use client';

import { usePathname } from 'next/navigation';
import { useRef } from 'react';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Workspace } from '@/components/app/shell/workspace';
import { toneStyleFor } from '@/components/app/views/view-tone';
import { cn } from '@/lib/utils';

/** Far enough to be a swipe and not a tap that wandered. */
const SWIPE_MIN = 56;

/**
 * The two middle columns, and the gesture that moves between them.
 *
 * Above 900px they sit side by side and share the width. Below it they are a
 * carousel: laid out over each other and slid, rather than swapped, so the pane
 * switch and the swipe both read as one movement rather than two unrelated
 * things happening.
 */
export function Panes({ children }: { children: React.ReactNode }) {
  const { width, wsOpen, setPane, drawer } = useShellLayout();
  const pathname = usePathname();
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const carousel = width === 'small' && wsOpen;

  return (
    <div
      /*
       * The view's tone is published HERE, on the common ancestor of both
       * panes, and not on the workspace.
       *
       * A custom property inherits downward only. Setting it on the workspace
       * `<section>` put it on a SIBLING of the conversation, so
       * `conversation-pane.tsx`'s own `border-t-[var(--tone,…)]` — the edge of
       * the panel when it slides over on a tablet — could never resolve it and
       * always fell back to the teal. The band on one side of the screen and
       * the panel edge on the other are meant to be the same colour; from a
       * sibling they never could be.
       *
       * `view-tone.ts` carries the table and the rest of the reasoning.
       */
      style={toneStyleFor(pathname)}
      className={cn('relative flex min-h-0 flex-1', carousel && 'overflow-hidden')}
      onPointerDown={(event) => {
        // Mouse is excluded on purpose: a click-drag across a pane is a text
        // selection, and turning that into navigation makes the app feel like
        // it is fighting the cursor.
        if (!carousel || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
        if (drawer) return; // the drawer is the thing on top; it owns the gesture
        // `instanceof` rather than a cast: `event.target` is an `EventTarget`,
        // and `.closest` exists only on `Element`. A cast would compile and then
        // throw on any target that is not one.
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('input, textarea, [contenteditable="true"]')) return;
        start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      }}
      // A gesture that ends anywhere but here — released over the topbar or the
      // rail, or cancelled by the browser — otherwise leaves the origin set, and
      // the NEXT `pointerup` to reach this element measures against it. That
      // included taps whose `pointerdown` these guards had deliberately ignored,
      // so tapping into the composer could slide the workspace in.
      onPointerCancel={() => {
        start.current = null;
      }}
      onPointerLeave={() => {
        start.current = null;
      }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        // Same pointer, or it is not the gesture we started measuring.
        if (!from || from.id !== event.pointerId) return;
        const dx = event.clientX - from.x;
        // A mostly-vertical drag is a scroll. Comparing the two axes rather than
        // thresholding x alone is what stops a scrolling thumb changing panes.
        if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(event.clientY - from.y)) return;
        // The conversation is on the left in every layout, so the direction
        // means the same thing everywhere: swipe right to bring her in.
        setPane(dx > 0 ? 'chat' : 'ws');
      }}
    >
      <ConversationPane />
      {/*
        `children` renders whether or not the workspace is open, and that is not
        a detail.

        `Workspace` returns null on `/app`, so rendering children only inside it
        meant the route's own output was DROPPED there — and in App Router
        `error.tsx` and `loading.tsx` are exactly that output. An error thrown on
        `/app`, the route every signed-in visitor lands on, painted a blank pane
        with no message and no "Try again": the back button was the only way out.
        The layout's comment claimed the opposite, and was true only of `/app/*`.

        On `/app` the page itself renders nothing, so in the ordinary case this
        adds no element and the conversation still fills the frame. It is the
        boundary cases — the ones with something to say — that were being
        swallowed.
      */}
      {wsOpen ? (
        <Workspace>{children}</Workspace>
      ) : (
        /*
         * Its own scroll container, and its own full width.
         *
         * On `/app` these children are `error.tsx` or `loading.tsx`, and
         * `RouteErrorBoundary`'s root is `min-h-[400px]`. As a bare flex sibling
         * it was clipped by the shell's `h-dvh overflow-hidden` with nothing
         * able to scroll to "Try again" — the SAME regression t-9 fixed and this
         * branch's own layout comment claims is covered. It was covered for
         * `/app/*`, by the surface body, and nowhere for `/app`.
         *
         * `absolute inset-0` rather than a flex child, because at large width a
         * sibling was laid out beside the `flex-1` conversation and squeezed
         * into the right half. An error is the whole view, not half of it.
         *
         * `empty:hidden` keeps the ordinary case honest: on `/app` the page
         * renders nothing, and an empty overlay would sit over the conversation
         * swallowing every click.
         */
        <div className="absolute inset-0 z-10 overflow-y-auto empty:hidden">{children}</div>
      )}
    </div>
  );
}
