'use client';

import { Mic, SendHorizontal } from 'lucide-react';

import { CHAT_MAX, CHAT_MIN, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';
import { cn } from '@/lib/utils';

/** Arrow steps, and the larger one Shift asks for. */
const STEP = 16;
const STEP_SHIFT = 48;

/**
 * The conversation pane, and the handle that sizes it.
 *
 * ## What it is not, yet
 *
 * A deliberate stub (D6). The composer renders — a real multi-row textarea that
 * grows to 160px, with send and mic beside it — but everything is `disabled` and
 * one plain line says why. No turns, no thinking indicator, no fake transcript:
 * the conversation is phase 2's, and a mocked-up one here would read as a
 * working product to anyone glancing at a screenshot.
 *
 * ## The strip
 *
 * Collapsed, the pane is 56px (44px on a phone) with her name running down it —
 * a drawer pull, not a disabled state, so the whole strip is the button that
 * brings it back.
 */
export function ConversationPane() {
  const { chatW, chatSlim, setChatSlim, width, wsOpen, pane } = useShellLayout();
  const reducedMotion = useReducedMotion();
  const carousel = width === 'small' && wsOpen;

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

  if (chatSlim && !overlay) return <Strip onOpen={() => setChatSlim(false)} />;

  return (
    <section
      aria-label="Conversation"
      // The carousel hides the off-screen pane from assistive technology; above
      // 900px both panes are genuinely on screen together.
      aria-hidden={carousel && pane !== 'chat' ? 'true' : undefined}
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
        !reducedMotion && 'transition-[flex-basis] duration-[280ms] ease-[var(--ease-brand)]',
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
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
              This is where you and Lelañea will talk. The conversation arrives in a later phase.
            </p>
          </div>

          <Composer />
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
      {wsOpen && width === 'large' ? <ResizeHandle /> : null}
    </section>
  );
}

/**
 * The collapsed conversation: a drawer pull, not a disabled state.
 *
 * The WHOLE strip is the button, so bringing her back is one target rather than
 * a small control hidden on a dead pane.
 */
function Strip({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
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

/**
 * The composer: real textarea, real growth, everything disabled.
 *
 * It grows to 160px and then scrolls, which is the prototype's behaviour and
 * worth having now — it is what makes the pane's bottom edge move, and the
 * layout has to survive that before anything real is typed into it.
 */
function Composer() {
  return (
    <div className="flex-none border-t border-[var(--color-divider)] px-6 py-4">
      <div
        className={cn(
          'bg-card flex items-end gap-2 rounded-2xl border border-[var(--color-card-border)] p-2'
        )}
      >
        <label className="sr-only" htmlFor="shell-composer">
          Message Lelañea
        </label>
        <textarea
          id="shell-composer"
          rows={1}
          disabled
          placeholder="The conversation arrives in a later phase"
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          className={cn(
            'text-foreground placeholder:text-muted-foreground min-h-9 flex-1 resize-none',
            'bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none',
            'disabled:cursor-not-allowed'
          )}
        />
        {[
          { id: 'mic', label: 'Record a voice note', Icon: Mic },
          { id: 'send', label: 'Send', Icon: SendHorizontal },
        ].map(({ id, label, Icon }) => (
          <span key={id} title={`${label} — arrives with the conversation`} className="flex-none">
            <button
              type="button"
              disabled
              aria-label={`${label} — arrives with the conversation`}
              className={cn(
                'text-muted-foreground flex h-9 w-9 items-center justify-center rounded-full',
                'disabled:opacity-50'
              )}
            >
              <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

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
function ResizeHandle() {
  const { chatW, chatSlim, setChatWidth } = useShellLayout();

  const startFrom = () => (chatSlim ? 56 : chatW);

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
      aria-valuenow={chatSlim ? CHAT_MIN : chatW}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startW = startFrom();
        const el = event.currentTarget;
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          // No capture available; the move handler still tracks the pointer.
        }
        const move = (e: PointerEvent) => setChatWidth(startW + (e.clientX - startX));
        const stop = (e: PointerEvent) => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', stop);
          el.removeEventListener('pointercancel', stop);
          try {
            el.releasePointerCapture(e.pointerId);
          } catch {
            // Already released with the capture that was never taken.
          }
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', stop);
        el.addEventListener('pointercancel', stop);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const step = event.shiftKey ? STEP_SHIFT : STEP;
        const delta = event.key === 'ArrowLeft' ? -step : step;
        setChatWidth(startFrom() + delta);
      }}
      className={cn(
        'absolute top-0 -right-[3px] bottom-0 z-30 w-1.5 cursor-col-resize',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
        'focus-visible:outline-[var(--color-ring)]'
      )}
    />
  );
}
