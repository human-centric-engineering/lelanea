'use client';

import { useRef } from 'react';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Workspace } from '@/components/app/shell/workspace';
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
  const start = useRef<{ x: number; y: number } | null>(null);

  const carousel = width === 'small' && wsOpen;

  return (
    <div
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
        start.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
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
      <Workspace>{children}</Workspace>
    </div>
  );
}
