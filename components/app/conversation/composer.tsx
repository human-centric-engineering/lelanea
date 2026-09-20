'use client';

import { ArrowUp } from 'lucide-react';
import * as React from 'react';

import { VoiceNote } from '@/components/app/conversation/voice-note';
import type { VoiceInputState } from '@/lib/app/conversation/client';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { cn } from '@/lib/utils';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** A turn is in flight, or the transcript is still loading: nothing sends. */
  busy: boolean;
  /** Whether the microphone is offered — the route's answer; `null` until it has answered. */
  voiceInput?: VoiceInputState | null;
  /** Injectable for tests, passed to the microphone. */
  fetchImpl?: typeof fetch;
}

/**
 * The composer: the prototype's card, live (§10 t-64).
 *
 * ## A card, not a bar
 *
 * `.composer-wrap` has no rule above it: the card floats on the pane's own
 * ground at the 604px measure the transcript shares, 20px of radius, the
 * lifted popover ground and `--shadow-rest` under it. Two rows tall before
 * anyone types, so the placeholder sits at the top with room beneath it — a
 * box that invites more than a sentence (§3.3).
 *
 * ## What it does now
 *
 * Enter sends and Shift+Enter breaks a line, as the prototype's `keydown`
 * does. The textarea grows with its content to 160px and then scrolls; the
 * height is reset when the value empties so a sent message leaves a two-row
 * box behind. The value is the hook's `draft`, and it is the hook that clears
 * it — on the server's `start`, not on the click — so the words leave the box
 * only once they are held somewhere else (§8.1).
 *
 * While a turn runs the send control is disabled and says why; typing is not.
 * A person can draft their next thought while she answers. Enter while she is
 * answering does nothing — neither sends nor breaks a line — as the prototype's
 * `if (!v || S.busy) return` after its `preventDefault` makes it; Shift+Enter
 * still breaks a line.
 *
 * ## The mic (t-67)
 *
 * Offered only when the route says voice input is on and there is something
 * to transcribe with; otherwise absent, not disabled — a disabled control
 * with no reason is the D6 failure in miniature. What the person said lands
 * at the caret, replacing any selection, for them to read and edit; the box
 * is never sent for them. See `voice-note.tsx`.
 */
export function Composer({ value, onChange, onSend, busy, voiceInput, fetchImpl }: ComposerProps) {
  const textarea = React.useRef<HTMLTextAreaElement>(null);

  /**
   * The words, at the caret — with a space either side where they meet other
   * words. Read from the box itself, not the render-time `value`: the words
   * arrive seconds after the press, and whatever was typed meanwhile is in
   * the box and not in this closure (review round 1).
   */
  const insertAtCaret = React.useCallback(
    (text: string) => {
      const el = textarea.current;
      const current = el?.value ?? value;
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? current.length;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const lead = before && !/\s$/.test(before) ? ' ' : '';
      const trail = after && !/^\s/.test(after) ? ' ' : '';
      const next = `${before}${lead}${text}${trail}${after}`;
      onChange(next);
      const caret = before.length + lead.length + text.length;
      // After React has painted the new value. Focus is taken only where the
      // box had it, or nothing did: the words can arrive without a press (the
      // two-minute cap), and a person typing elsewhere is not pulled here.
      const hadFocus = document.activeElement === el || document.activeElement === document.body;
      requestAnimationFrame(() => {
        if (hadFocus) el?.focus();
        el?.setSelectionRange(caret, caret);
      });
    },
    [value, onChange]
  );

  // The auto-grow runs on every value change, not only on `input`: a value
  // cleared by the hook fires no input event, and the box would keep the
  // height of the message that just left it.
  React.useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const canSend = !busy && value.trim().length > 0;

  return (
    <form
      className="flex-none px-6 pt-2 pb-5 max-[760px]:px-3.5 max-[760px]:pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div
        className={cn(
          'mx-auto w-full max-w-[604px] rounded-[20px] px-3.5 pt-3 pb-2.5',
          'border border-[var(--color-border)] bg-[var(--color-popover)]',
          'shadow-[var(--shadow-rest)]',
          'transition-[border-color] duration-200 ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          'focus-within:border-[var(--color-secondary)]'
        )}
      >
        <label className="sr-only" htmlFor="shell-composer">
          {CONVERSATION_COPY.composerLabel}
        </label>
        <textarea
          ref={textarea}
          id="shell-composer"
          rows={2}
          value={value}
          placeholder={CONVERSATION_COPY.placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            // IME composition also uses Enter; let it finish the character.
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canSend) onSend();
          }}
          className={cn(
            'text-foreground placeholder:text-muted-foreground block w-full resize-none',
            'max-h-[160px] min-h-[60px] bg-transparent text-[15px] leading-[1.6] outline-none'
          )}
        />
        <div className="flex items-center gap-2 pt-1.5">
          {voiceInput === 'available' ? (
            <VoiceNote onText={insertAtCaret} disabled={busy} fetchImpl={fetchImpl} />
          ) : null}
          <span className="flex-1" />
          <span className="text-muted-foreground flex-none text-[12px] max-[760px]:hidden">
            {CONVERSATION_COPY.hint}
          </span>
          <button
            type="submit"
            disabled={!canSend}
            aria-label={busy ? CONVERSATION_COPY.sendBusy : CONVERSATION_COPY.send}
            className={cn(
              'flex h-9 w-9 flex-none items-center justify-center rounded-full',
              'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
              'transition-opacity duration-200 ease-[var(--ease-brand)] motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
              'focus-visible:outline-[var(--color-ring)]',
              'disabled:opacity-60'
            )}
          >
            <ArrowUp size={17} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  );
}
