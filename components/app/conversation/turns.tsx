'use client';

import * as React from 'react';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { useReducedMotion } from '@/components/app/ui/use-reduced-motion';
import { useTypedText } from '@/components/app/conversation/use-typed-text';
import styles from '@/components/app/conversation/turns.module.css';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import type { CrisisResource } from '@/lib/app/conversation/events';
import type { GenerationStatus } from '@/lib/app/conversation/client';
import { TURN_IN_FLIGHT } from '@/lib/app/agent/turn-codes';
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
  /** Called once the whole settled text has been shown. */
  onRevealed?: () => void;
  /** t-66 renders the account row here. */
  children?: React.ReactNode;
}

export function ReplyTurn({
  text,
  settled,
  animate,
  rise,
  onGrow,
  onRevealed,
  children,
}: ReplyTurnProps) {
  const reducedMotion = useReducedMotion();
  const shown = useTypedText(text, settled, animate && !reducedMotion);
  // The reveal keeps growing for seconds after the last chunk lands, and the
  // transcript cannot see that from its own props.
  React.useEffect(() => {
    onGrow?.();
  }, [shown, onGrow]);
  const done = settled && shown === text;
  React.useEffect(() => {
    if (done && animate) onRevealed?.();
  }, [done, animate, onRevealed]);
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
 * The crisis resource, laid out (safety.md → "The client frame"; t-65).
 *
 * Every word is authored and rendered verbatim — the intro, each service's
 * name, contact and hours, the emergency line, and on a hard frame the line
 * that says what they wrote is still in the box. Nothing here is rewritten
 * into her register: these are the words a person reads at the worst moment
 * they will bring to the app, and they wait on her sign-off as they are.
 *
 * Where the frame's `resource` did not parse, `text` — the whole resource as
 * plain text, the frame's `message` — is shown instead, so a shape mismatch
 * never costs the person the names and numbers.
 *
 * A service's `url` becomes a link only when it is `https://`. The admin write
 * already refuses anything else (`lib/validations/app-crisis-resources.ts`);
 * this is the same rule at the last step, so no path — a future table row, a
 * hand edit to the file — can put another scheme on a link a person in danger
 * is about to press.
 *
 * It is an `alert` because it is the one thing in a transcript that must be
 * read before anything after it.
 */
export function CrisisRow({ resource, text }: { resource?: CrisisResource; text: string }) {
  return (
    <article role="alert" aria-label={CONVERSATION_COPY.crisisLabel} className="flex gap-3">
      <HerMark />
      <div
        className={cn(
          'flex flex-col gap-3 rounded-[14px] border px-4 py-[13px]',
          'text-foreground border-[var(--color-border)] bg-[var(--color-muted)]',
          'text-[14px] leading-[1.6]'
        )}
      >
        {resource ? (
          <>
            <p>{resource.intro}</p>
            <ul className="flex flex-col gap-2">
              {resource.services.map((service) => (
                <li key={`${service.name}:${service.contact}`} className="flex flex-col">
                  <span className="font-medium">{service.name}</span>
                  <span>
                    {service.url?.startsWith('https://') ? (
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-secondary-ink)] underline underline-offset-2"
                      >
                        {service.contact}
                      </a>
                    ) : (
                      service.contact
                    )}
                    <span className="text-muted-foreground"> · {service.hours}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="font-medium">{resource.emergency}</p>
            {resource.keptMessage ? (
              <p className="text-muted-foreground">{resource.keptMessage}</p>
            ) : null}
          </>
        ) : (
          <p className="whitespace-pre-line">{text}</p>
        )}
      </div>
    </article>
  );
}

/**
 * How a turn ended without her, in her words (t-65).
 *
 * The frame carries the neutral contract copy; where the code is one this
 * pane knows — the four endings, and the one refusal a person can meet from
 * here — her words replace it (`CONVERSATION_COPY.endings`). A code it does
 * not know (the ceiling frame, with its figures) keeps the frame's own words.
 * Each `\n` in the copy is a beat and gets its own line.
 *
 * A hard crisis frame is not words of hers at all: the authored resource is
 * laid out instead, and nothing else is said under it.
 */
export function EndingRow({
  code,
  message,
  resource,
}: {
  code: string;
  message: string;
  resource?: CrisisResource;
}) {
  if (resource) return <CrisisRow resource={resource} text={message} />;
  const words = endingWords(code) ?? message;
  return (
    <article aria-label={CONVERSATION_COPY.endingLabel} className="flex gap-3">
      <HerMark />
      <p className="text-muted-foreground px-0.5 py-1 text-[14px] leading-[1.6] whitespace-pre-line">
        {words}
      </p>
    </article>
  );
}

function endingWords(code: string): string | null {
  if (code === TURN_IN_FLIGHT) return CONVERSATION_COPY.stillWorking;
  return Object.hasOwn(CONVERSATION_COPY.endings, code)
    ? CONVERSATION_COPY.endings[code as keyof typeof CONVERSATION_COPY.endings]
    : null;
}

/**
 * The quiet line above the composer, from the status read (t-65): one line in
 * the muted ink at the transcript's measure, no red, no icon. `paused` and
 * `unavailable` show it; anything else renders nothing. A `status` region, so
 * it is announced without interrupting.
 */
export function StatusLine({ generation }: { generation: GenerationStatus | null }) {
  if (generation !== 'paused' && generation !== 'unavailable') return null;
  return (
    <p
      role="status"
      className="text-muted-foreground mx-auto w-full max-w-[604px] flex-none px-6 pb-1 text-[13px] leading-[1.6] max-[760px]:px-3.5"
    >
      {CONVERSATION_COPY.banner[generation]}
    </p>
  );
}
