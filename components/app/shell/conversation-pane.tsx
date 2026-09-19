'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { useEffect, useRef } from 'react';

import { Composer } from '@/components/app/conversation/composer';
import { Transcript } from '@/components/app/conversation/transcript';
import { useConversation } from '@/components/app/conversation/use-conversation';
import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import {
  CHAT_FOLD,
  CHAT_MAX,
  CHAT_MIN,
  type ModulePlace,
  useShellLayout,
} from '@/components/app/shell/use-shell-layout';
import { ICON_RADIUS } from '@/components/app/shell/chrome';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { PanelCollapseIcon } from '@/components/app/ui/panel-icons';
import { MODULES_PATH_PREFIX } from '@/lib/app/journey/paths';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * Where the reader is, in the words the shell can honestly use.
 *
 * Two sources, because the shell knows two different amounts about a route. A
 * nav destination is in `SHELL_NAV`, which is static and client-side, so its
 * label is available on the first render with no round trip. A module is not:
 * its authored number and title live on the server, so the page publishes them
 * (`RememberModule`) and they arrive one effect later.
 *
 * `null` for anything neither knows about — a `[...slug]` 404, say — which
 * renders the way back on its own rather than `on undefined`.
 */
export function placeLabel(pathname: string, modulePlace: ModulePlace | null): string | null {
  // A module can ONLY be named by what the page published. Falling through to
  // the nav below would name it `The conversation`, because that item's href is
  // `/app` and `/app` is every view's prefix — the same trap the nav's own
  // current-item test exists for, arriving in a second place.
  if (pathname.startsWith(`${MODULES_PATH_PREFIX}/`)) return modulePlace?.label ?? null;

  const item = SHELL_NAV.filter(isNavItem).find((entry) =>
    entry.href === '/app'
      ? pathname === '/app'
      : pathname === entry.href || pathname.startsWith(`${entry.href}/`)
  );
  return item?.label ?? null;
}

/** Arrow steps, and the larger one Shift asks for. */
const STEP = 16;
const STEP_SHIFT = 48;

/**
 * The conversation pane, and the handle that sizes it.
 *
 * ## Three parts, always all three
 *
 * A title row, a transcript area and the composer. The column keeps that shape
 * at every width and in both view states — full frame and beside the workspace —
 * because those are what make it read as a conversation rather than as a panel
 * that happens to have a text box at the bottom.
 *
 * ## The conversation is real (§10 t-64)
 *
 * The transcript and the composer are views over `useConversation`, which is
 * called HERE — above the folded early return below — because that return
 * unmounts both views, and a turn folded away mid-answer must still be there
 * when the pane comes back. The pane itself is mounted once, in the group
 * layout, so a turn also survives navigating to a module.
 *
 * What is still deliberately absent: the timestamp and account row under a
 * reply (t-66), the endings in her words and retry (t-65), the mic (t-67).
 *
 * ## The strip
 *
 * Collapsed, the pane is 56px (44px on a phone) with her name running down it —
 * a drawer pull, not a disabled state, so the whole strip is the button that
 * brings it back.
 */
export function ConversationPane() {
  const { chatW, chatSlim, setChatSlim, width, wsOpen, pane, modulePlace } = useShellLayout();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const conversation = useConversation();
  const carousel = width === 'small' && wsOpen;
  const stripRef = useRef<HTMLButtonElement>(null);
  const foldByKeyboard = useRef(false);

  useEffect(() => {
    if (!chatSlim || !foldByKeyboard.current) return;
    foldByKeyboard.current = false;
    stripRef.current?.focus();
  }, [chatSlim]);

  /**
   * On a tablet the conversation stops being a column and becomes a panel.
   *
   * The prototype's medium block is emphatic about why: the panel is ALWAYS its
   * full 420px and rides in and out on a transform, so nothing animates a layout
   * property and the workspace never reflows. Parked, it is translated left by
   * its own width less the strip, so only that strip clears the viewport — which
   * is why the strip is pinned to the panel's right edge rather than being a
   * separate narrow pane. Built as an in-flow pane instead, the surface shunts
   * sideways every time the conversation opens, which is the reflow the design
   * spent a transform avoiding.
   */
  const overlay = width === 'medium' && wsOpen;

  if (chatSlim && !overlay) return <Strip ref={stripRef} onOpen={() => setChatSlim(false)} />;

  return (
    <section
      aria-label="Conversation"
      // The carousel hides the off-screen pane from assistive technology; above
      // 900px both panes are genuinely on screen together.
      aria-hidden={carousel && pane !== 'chat' ? 'true' : undefined}
      /*
       * As on the workspace: `aria-hidden` does not remove focusability, and
       * with the composer live the off-screen pane holds a real textarea and a
       * real send button. `inert` is what keeps a swipe from leaving focus in a
       * box nobody can see.
       */
      inert={carousel && pane !== 'chat'}
      data-pane="chat"
      style={wsOpen && !carousel && !overlay ? { flexBasis: `${chatW}px` } : undefined}
      className={cn(
        'relative flex min-w-0 flex-col bg-[var(--color-background)]',
        wsOpen && !carousel && !overlay
          ? 'flex-none border-r border-[var(--color-divider)]'
          : 'flex-1',
        // The tablet panel: fixed width, moved with a transform, never reflowing
        // what is behind it. `-translate-x-[364px]` is 420 less the 56px strip.
        overlay && [
          'absolute top-0 bottom-0 left-0 z-[38] w-[420px] flex-none',
          'border-r border-[var(--color-divider)]',
          !reducedMotion && 'transition-transform duration-[340ms] ease-[var(--ease-brand)]',
          chatSlim
            ? '-translate-x-[364px]'
            : [
                'translate-x-0 shadow-[var(--shadow-lift)]',
                // Slid open it is a panel like the drawers beside it, so it
                // carries the same tone band rather than arriving as a grey edge.
                'border-t-[3px] border-t-[var(--tone,var(--color-secondary-ink))]',
              ],
        ],
        // `!overlay && !carousel`, and this is not belt-and-braces: `cn` is
        // `twMerge`, so a later class in the same group REPLACES an earlier one.
        // Emitted unconditionally, this deleted the overlay's
        // `transition-transform duration-[340ms]` — measured — and the tablet
        // panel popped in and out instead of riding the transform it is built
        // around. The carousel's transform transition went the same way.
        !reducedMotion &&
          !overlay &&
          !carousel &&
          'transition-[flex-basis] duration-[280ms] ease-[var(--ease-brand)]',
        // The carousel lays both panes over each other and slides them, so the
        // switch and the swipe read as one movement. `pointer-events-none` on
        // the off-screen one because a transform does not stop it taking a tap.
        carousel && 'absolute inset-0 w-full flex-none border-r-0',
        carousel &&
          !reducedMotion &&
          'transition-transform duration-[340ms] ease-[var(--ease-brand)]',
        carousel && (pane === 'chat' ? 'translate-x-0' : 'pointer-events-none -translate-x-full')
      )}
    >
      {overlay && chatSlim ? null : (
        <>
          {/*
            The chat head (`.chat-head`), and the collapse control the prototype
            puts in it (`#chat-collapse`), shown whenever there is a workspace to
            give the width back to — `#app.no-ws` hides it, and so does the small
            block, where the pane switch does this job instead.

            The control was missing entirely, which left Escape as the ONLY way
            to park the conversation on a tablet: the surface click is a
            fallback, not an affordance, and nothing on screen said the pane
            could collapse at all. The strip is how it comes back; this is how it
            goes away.

            THE HEAD ITSELF renders at every width and in both view states, which
            it did not: it was nested inside the same condition as the control,
            so the one view every signed-in visitor lands on — `/app`, the
            conversation at full width — had no title on it at all. The prototype
            hides the BUTTON there (`#app.no-ws #chat-collapse`) and keeps
            `#chat-label` where it always is, top left above the first turn.
          */}
          <div className="flex flex-none items-center gap-2 px-6 pt-3.5 max-[760px]:px-3.5 max-[760px]:pt-3">
            {wsOpen && width !== 'small' ? (
              <button
                type="button"
                onClick={() => setChatSlim(true)}
                aria-label="Collapse the conversation"
                title="Collapse the conversation"
                className={cn(
                  'text-muted-foreground hover:text-foreground flex h-8 w-8 flex-none',
                  'items-center justify-center',
                  ICON_RADIUS,
                  'hover:bg-[var(--color-pill-hover)]',
                  'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                  'motion-reduce:transition-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                  'focus-visible:outline-[var(--color-ring)]'
                )}
              >
                <PanelCollapseIcon />
              </button>
            ) : null}

            {/*
              THE WAY BACK, and it is the thing in this column that actually
              costs somebody something when it is wrong.

              With the workspace open the head is a link — a back arrow and `the
              main conversation` in the secondary ink — with where you currently
              are beside it in muted text. It was a small outlined panel glyph
              followed by `the conversation` in grey: a different icon, different
              words, the wrong colour, and nothing about it read as a link at
              all, so the one way back out of a module looked like a caption.

              On `/app` there is nowhere to go back TO — that IS the main
              conversation — so it stays the eyebrow the design keeps there.
            */}
            {wsOpen ? (
              <>
                <Link
                  href="/app"
                  title="Return to the main conversation with Lelañea"
                  className={cn(
                    'flex min-w-0 flex-none items-center gap-1.5 px-2 py-1',
                    ICON_RADIUS,
                    'text-[13.5px] text-[var(--color-secondary-ink)] no-underline',
                    'hover:bg-[var(--color-secondary-wash)] hover:no-underline',
                    'transition-[background-color] duration-200 ease-[var(--ease-brand)]',
                    'motion-reduce:transition-none',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                    'focus-visible:outline-[var(--color-ring)]'
                  )}
                >
                  <ArrowLeft size={15} strokeWidth={1.6} className="flex-none" aria-hidden="true" />
                  <span className="truncate">the main conversation</span>
                </Link>
                {/*
                  Muted, and quietly absent rather than wrong: a module's label
                  arrives one effect after the route does, and the provider
                  withholds it while the slug and the route disagree.
                */}
                {placeLabel(pathname, modulePlace) ? (
                  <span className="text-muted-foreground min-w-0 truncate text-[13px]">
                    on {placeLabel(pathname, modulePlace)}
                  </span>
                ) : null}
              </>
            ) : (
              <Eyebrow className="min-w-0 truncate">the conversation</Eyebrow>
            )}
          </div>

          {/*
            The transcript (`.chat-log`): a SCROLL CONTAINER with the composer
            below it. The column keeps its three parts whether or not there is
            anything in the transcript yet; the empty state goes INSIDE it,
            where a turn will go (t-36). `.inner` is the prototype's 604px
            measure, shared with the composer so the two line up as one column.
          */}
          <Transcript
            phase={conversation.phase}
            entries={conversation.entries}
            live={conversation.live}
            unreadable={conversation.unreadable}
          />

          <Composer
            value={conversation.draft}
            onChange={conversation.setDraft}
            onSend={() => conversation.send()}
            busy={conversation.phase !== 'idle'}
          />
        </>
      )}

      {/*
        The strip belongs to the PARKED panel only.
        
        It rides on the panel's right edge so that it lands at the screen edge
        when the panel is translated away. Rendered while the panel is open, it
        sits on top of the panel's own right-hand 56px instead — covering the end
        of the copy and the send button, which is what it was doing. The
        prototype hides it the same way: the base rule is `display: none`, and
        only `.chat.slim .chat-slim` brings it back.
      */}
      {overlay && chatSlim ? (
        <Strip
          onOpen={() => setChatSlim(false)}
          className="absolute top-0 right-0 bottom-0 h-auto"
        />
      ) : null}

      {/*
        The handle is only meaningful when there is a workspace to take width
        from; with the conversation filling the frame there is nothing to size
        it against. The prototype hides it the same way (`#app.no-ws`).
      */}
      {wsOpen && width === 'large' ? (
        <ResizeHandle
          onFold={() => {
            foldByKeyboard.current = true;
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * The collapsed conversation: a drawer pull, not a disabled state.
 *
 * The WHOLE strip is the button, so bringing her back is one target rather than
 * a small control hidden on a dead pane.
 */
const Strip = React.forwardRef<HTMLButtonElement, { onOpen: () => void; className?: string }>(
  function Strip({ onOpen, className }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-label="Open the conversation"
        className={cn(
          'text-muted-foreground flex flex-none flex-col items-center gap-4',
          'border-r border-[var(--color-divider)] bg-[var(--color-background)]',
          'w-14 py-4 max-[640px]:w-11',
          'hover:bg-[var(--color-pill)] hover:text-[var(--color-secondary-ink)]',
          'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
          'focus-visible:outline-[var(--color-ring)]',
          className
        )}
      >
        <span className="text-[11.5px] tracking-[0.24em] uppercase [writing-mode:vertical-rl]">
          Ask Lelañea
        </span>
        <span aria-hidden="true" className="mt-auto flex flex-col gap-1">
          <i className="block h-1 w-1 rounded-full bg-current opacity-50" />
          <i className="block h-1 w-1 rounded-full bg-current opacity-50" />
          <i className="block h-1 w-1 rounded-full bg-current opacity-50" />
        </span>
      </button>
    );
  }
);

/**
 * The one thing worth resizing: the conversation, against the work.
 *
 * `role="separator"` with the `aria-value*` trio, so it is a real slider to a
 * screen reader rather than a decorative rule — and the arrow keys that a
 * separator promises actually work, which is what makes the pane resizable
 * without a pointer at all.
 *
 * Pointer capture means the drag survives the cursor leaving the 6px hit area,
 * which it does immediately on any real drag. The `catch` is not defensive
 * padding: a browser that refuses capture still tracks the pointer through the
 * move handler, so the drag degrades rather than dying.
 */
function ResizeHandle({ onFold }: { onFold: () => void }) {
  const { chatW, setChatWidth } = useShellLayout();
  const pendingDetach = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      pendingDetach.current?.();
      pendingDetach.current = null;
    },
    []
  );

  /*
   * `chatW`, with no folded branch.
   *
   * There was a `chatSlim ? 56 : chatW`, ported from the prototype, and it was
   * dead: the handle renders only at `large`, where a folded pane has already
   * taken its early return and rendered the strip instead. It was also wrong if
   * it ever became reachable — 56 + 48 is still under `CHAT_FOLD`, so the arrow
   * keys could never have un-folded the pane they were resizing.
   */
  const startFrom = () => chatW;

  /*
   * A FOCUSABLE separator is the ARIA window-splitter pattern, not a mislabelled
   * div: the role's own spec gives a movable separator focus and the
   * `aria-value*` trio, which is exactly what makes this resizable with no
   * pointer at all. `jsx-a11y` cannot tell that from a decorative rule someone
   * hung a click on, so both rules are silenced here and nowhere else.
   */
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the conversation"
      aria-valuemin={CHAT_MIN}
      aria-valuemax={CHAT_MAX}
      aria-valuenow={chatW}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startW = startFrom();
        const el = event.currentTarget;
        let captured = true;
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          // The comment here used to claim the move handler still tracked the
          // pointer without capture. It does not: `el` is 6px wide, so it stops
          // receiving events the instant the cursor leaves it, the drag freezes
          // at the last in-bounds x, and `stop` never runs. Fall back to the
          // document, which does see the whole gesture.
          captured = false;
        }
        const host: HTMLElement | Document = captured ? el : document;
        // `commit: false` — a drag persists once, on release, not per frame.
        const move = (e: PointerEvent) => setChatWidth(startW + (e.clientX - startX), false);
        const stop = (e: PointerEvent) => {
          // The settled value is the one worth remembering.
          setChatWidth(startW + (e.clientX - startX));
          detach();
          if (!captured) return;
          try {
            el.releasePointerCapture(e.pointerId);
          } catch {
            // Already released, or the element has gone.
          }
        };
        const detach = () => {
          host.removeEventListener('pointermove', move as EventListener);
          host.removeEventListener('pointerup', stop as EventListener);
          host.removeEventListener('pointercancel', stop as EventListener);
        };
        host.addEventListener('pointermove', move as EventListener);
        host.addEventListener('pointerup', stop as EventListener);
        host.addEventListener('pointercancel', stop as EventListener);
        // The handle can be UNMOUNTED mid-drag: squeezing past the fold makes the
        // pane take its `Strip` early return and this element goes with it, so
        // `stop` never fires — three listeners stay attached and the width is
        // never committed, leaving storage holding the pre-drag value for the
        // next reload. `pendingDetach` lets the unmount finish the job.
        pendingDetach.current = detach;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const step = event.shiftKey ? STEP_SHIFT : STEP;
        const delta = event.key === 'ArrowLeft' ? -step : step;
        const target = startFrom() + delta;

        // Squeezing past the fold unmounts this very element — the pane takes
        // its folded early return and the separator goes with it — so focus
        // would land on `<body>` and a keyboard reader would be back at the top
        // of the document with no idea the pane had collapsed. Hand focus to the
        // strip, which is the control that brings it back.
        if (target < CHAT_FOLD) onFold();
        setChatWidth(target);
      }}
      className={cn(
        'absolute top-0 -right-[3px] bottom-0 z-30 w-1.5 cursor-col-resize',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
        'focus-visible:outline-[var(--color-ring)]'
      )}
    />
  );
}
