'use client';

import * as React from 'react';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';
import { useTypedText } from '@/components/app/conversation/use-typed-text';
import styles from '@/components/app/conversation/turns.module.css';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { cn } from '@/lib/utils';

/**
 * One turn each way, from the prototype's `renderTurn` (§10 t-64).
 *
 * The person's turn is a right-aligned bubble on the user-bubble tone, 78% of
 * the measure at most. Hers is her mark and a card-toned bubble with a hairline
 * border, `white-space: pre-line` so her paragraphs are hers. Both `rise` in
 * over 420ms unless the reader has asked for less motion.
 *
 * Each is an `<article>`, which is what the stub's test used to assert was
 * absent — a transcript is a sequence of self-contained pieces, and that is
 * the element for it.
 *
 * What is NOT here: the timestamp and the one-line account under a reply.
 * That row is t-66's, and the prototype renders it only when a turn has
 * `meta` — which no turn has until the account exists.
 */

export function UserTurn({ text, rise }: { text: string; rise: boolean }) {
  const reducedMotion = useReducedMotion();
  return (
    <article
      aria-label="You said"
      className={cn('flex justify-end', rise && !reducedMotion && styles.rise)}
    >
      <p
        className={cn(
          'max-w-[78%] rounded-[20px_20px_6px_20px] px-[17px] py-[13px]',
          'bg-[var(--color-user-bubble)] text-[var(--color-secondary-foreground)]',
          'text-[15px] leading-[1.55] whitespace-pre-line'
        )}
      >
        {text}
      </p>
    </article>
  );
}

/** Her mark beside a reply: a 30px disc on the card tone with the lotus in it. */
export function HerMark() {
  return (
    <span
      className={cn(
        'mt-0.5 flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full',
        'bg-[var(--color-card)]'
      )}
      title={CONVERSATION_COPY.herMark}
    >
      <LotusMark size={18} water={false} />
    </span>
  );
}

export interface ReplyTurnProps {
  text: string;
  /** The turn has ended: the tail of `text` is a whole word. */
  settled: boolean;
  /** Pace the words as typed. False for a reply read back on load. */
  animate: boolean;
  rise: boolean;
  /** Called each time the reveal grows, so a scroll container can follow it. */
  onGrow?: () => void;
  /** t-66 renders the account row here. */
  children?: React.ReactNode;
}

export function ReplyTurn({ text, settled, animate, rise, onGrow, children }: ReplyTurnProps) {
  const reducedMotion = useReducedMotion();
  const shown = useTypedText(text, settled, animate && !reducedMotion);
  // The reveal keeps growing for seconds after the last chunk lands, and the
  // transcript cannot see that from its own props.
  React.useEffect(() => {
    onGrow?.();
  }, [shown, onGrow]);
  return (
    <article
      aria-label="Lelañea said"
      className={cn('flex gap-3', rise && !reducedMotion && styles.rise)}
    >
      <HerMark />
      <div className="flex min-w-0 flex-col gap-2">
        <div
          className={cn(
            'rounded-[20px_20px_20px_6px] border px-[18px] py-[14px]',
            'text-foreground border-[var(--color-card-border)] bg-[var(--color-card)]',
            'text-[15px] leading-[1.62] whitespace-pre-line'
          )}
        >
          {shown}
        </div>
        {children}
      </div>
    </article>
  );
}

/**
 * The thinking row: her mark, three breathing dots, and one word. The label
 * changes at the first-words deadline (`still_thinking`) rather than a second
 * row appearing — a slow answer is still her answer, and the row that says
 * she is thinking is the honest place to say it is taking longer.
 */
export function ThinkingRow({ stillThinking }: { stillThinking: boolean }) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex gap-3', !reducedMotion && styles.rise)}
    >
      <HerMark />
      <div className="text-muted-foreground flex items-center gap-2 px-0.5 py-1 text-[13px]">
        <span aria-hidden="true" className="flex items-center gap-1">
          <i className={cn('block h-1.5 w-1.5 rounded-full bg-current', styles.dot)} />
          <i className={cn('block h-1.5 w-1.5 rounded-full bg-current', styles.dot)} />
          <i className={cn('block h-1.5 w-1.5 rounded-full bg-current', styles.dot)} />
        </span>
        <span>{stillThinking ? CONVERSATION_COPY.stillThinking : CONVERSATION_COPY.thinking}</span>
      </div>
    </div>
  );
}

/**
 * How a turn ended without her. The neutral copy the ending frame carries, in
 * the muted ink, where her reply would have been. t-65 replaces the words with
 * hers and makes it retryable; this task only makes sure a person is told.
 */
export function EndingRow({ message }: { message: string }) {
  return (
    <article aria-label="The turn ended" className="flex gap-3">
      <HerMark />
      <p className="text-muted-foreground px-0.5 py-1 text-[13px] leading-[1.6]">{message}</p>
    </article>
  );
}
