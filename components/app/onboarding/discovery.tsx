'use client';

import * as React from 'react';
import Link from 'next/link';

import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { useConsentBannerClearance } from '@/components/app/ui/consent-clearance';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { APIClientError, apiClient } from '@/lib/api/client';
import {
  MAX_ANSWER_LENGTH,
  discoveryPosition,
  type DiscoveryAnswer,
  type DiscoveryBranch,
} from '@/lib/app/onboarding/discovery';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/** The API every answer, skip and leave goes through. */
export const DISCOVERY_ROUTE = '/api/v1/app/onboarding/discovery';

/** Onboarding's own area, where the questions can always be picked up. */
export const ONBOARDING_MODULE_PATH = '/app/modules/onboarding';

/**
 * The build's words around her questions: plain, and about the mechanics only.
 * No counts, so a question added or removed never leaves a sentence saying how
 * many there are.
 */
export const DISCOVERY_COPY = {
  eyebrow: 'onboarding',
  breakAway:
    'You don’t have to answer them all at once. Break away whenever you like, and come back to them any time in Onboarding, on the map.',
  offer: 'When you’re ready, here is the next question.',
  answerIt: 'Answer it',
  notNow: 'Not now',
  save: 'Save and continue',
  saveRevision: 'Save',
  skip: 'Skip for now',
  leave: 'Leave for now',
  yes: 'Yes',
  no: 'No',
  yesOrNo: 'Your answer',
  answerLabel: 'Your answer',
  notSaved: 'Not saved.',
  saveFailed: 'Your answer did not save. It is still here, so you can try again.',
  answered: 'answered',
  skipped: 'skipped',
  notYet: 'not yet',
  allBehind:
    'Every question has been answered or skipped. You can go back to any of them, to answer or change what you wrote.',
  skippedWaiting: 'Some questions are waiting for you, whenever you want to come back to them.',
  listLabel: 'The discovery questions',
  goTo: 'Go to Onboarding',
} as const;

/** One question as the surface shows it: only what it needs, all serialisable. */
export interface DiscoveryQuestionProps {
  id: string;
  number: number;
  text: string;
  hint?: string;
  followUp?: { ifYes: string; ifNo: string };
  /** Always asked: there is no way past it but an answer. */
  core: boolean;
}

/**
 * - `first`: the first sitting, straight after the reads on `/app`. The
 *   preamble, the line about breaking away, and the questions in turn.
 * - `offer`: a later return to `/app`. The next question is offered, not
 *   asked, and "Not now" leaves the conversation.
 * - `module`: Onboarding's own area. Every question, with where each stands;
 *   any can be answered, revised, or picked up after a skip.
 */
export type DiscoveryVariant = 'first' | 'offer' | 'module';

export interface DiscoveryProps {
  userId: string;
  variant: DiscoveryVariant;
  preamble: string;
  questions: readonly DiscoveryQuestionProps[];
  answers: Readonly<Record<string, DiscoveryAnswer>>;
  skipped: readonly string[];
}

/**
 * What the person has done on this page, per person, since it loaded.
 *
 * The server's output is the state when it rendered, and a Back navigation
 * restores it from the router's cache. So a remount would ask again a
 * question just answered, or offer again what was just declined, the way
 * t-103's stepper restarted (`first-run.tsx`). Held at module scope, which
 * lives as long as the page, and laid over what the server said. A reload
 * clears it and reads the server again, which by then has every write.
 */
interface PageLocal {
  answers: Record<string, DiscoveryAnswer>;
  skipped: Set<string>;
  /** Left, or declined the offer: `/app` shows nothing more on this page. */
  away: boolean;
}
const local = new Map<string, PageLocal>();

function localFor(userId: string): PageLocal {
  let entry = local.get(userId);
  if (!entry) {
    entry = { answers: {}, skipped: new Set(), away: false };
    local.set(userId, entry);
  }
  return entry;
}

/** For tests: forget what this page has done. */
export function forgetDiscoveryPage(): void {
  local.clear();
}

/**
 * The discovery questions (§3.9, f-onboarding t-104): asked on `/app` after
 * the reads, offered there on a return, and kept in Onboarding's own area.
 *
 * Every answer is posted and waited on, because it is the person's words: a
 * save that fails says so and keeps the text. A skip is posted and not waited
 * on, as the first run's beats are; one that does not land is offered again
 * on the next visit, which is the remedy.
 *
 * ## Focus follows the question
 *
 * A question replaces the one before it in place, so its heading takes focus
 * when the person moves on, and not on the first render.
 */
export function Discovery({
  userId,
  variant,
  preamble,
  questions,
  answers: fromServer,
  skipped: skippedOnServer,
}: DiscoveryProps) {
  const [answers, setAnswers] = React.useState<Record<string, DiscoveryAnswer>>(() => ({
    ...fromServer,
    ...localFor(userId).answers,
  }));
  const [skipped, setSkipped] = React.useState<ReadonlySet<string>>(
    () => new Set([...skippedOnServer, ...localFor(userId).skipped])
  );
  const [away, setAway] = React.useState(() => variant !== 'module' && localFor(userId).away);
  const [offerTaken, setOfferTaken] = React.useState(false);
  /** The question the module view has open, when the person chose one. */
  const [chosen, setChosen] = React.useState<string | null>(null);
  /** The person has moved past a question here: the preamble has done its job. */
  const [movedOn, setMovedOn] = React.useState(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const moved = React.useRef(false);
  const clearance = useConsentBannerClearance();

  const position = discoveryPosition(questions, new Set(Object.keys(answers)), skipped);
  const currentId = chosen ?? position.next;
  const current = questions.find((q) => q.id === currentId) ?? null;

  React.useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start' });
  }, [currentId, offerTaken]);

  const goAway = (): void => {
    localFor(userId).away = true;
    setAway(true);
  };

  const onSaved = (question: DiscoveryQuestionProps, answer: DiscoveryAnswer): void => {
    localFor(userId).answers[question.id] = answer;
    moved.current = true;
    setMovedOn(true);
    setAnswers((prev) => ({ ...prev, [question.id]: answer }));
    setChosen(null);
  };

  const onSkip = (question: DiscoveryQuestionProps): void => {
    localFor(userId).skipped.add(question.id);
    moved.current = true;
    setMovedOn(true);
    setSkipped((prev) => new Set([...prev, question.id]));
    setChosen(null);
    apiClient
      .post(DISCOVERY_ROUTE, { body: { action: 'skip', questionId: question.id } })
      .catch((caught: unknown) => {
        logger.warn('Discovery skip did not land', {
          questionId: question.id,
          error: String(caught),
        });
      });
  };

  const onLeave = (): void => {
    goAway();
    apiClient.post(DISCOVERY_ROUTE, { body: { action: 'leave' } }).catch((caught: unknown) => {
      logger.warn('Discovery leave did not land', { error: String(caught) });
    });
  };

  if (variant === 'module') {
    return (
      <div className="flex max-w-[52rem] flex-col gap-6" data-testid="discovery-module">
        {current ? (
          <QuestionEditor
            key={current.id}
            question={current}
            existing={answers[current.id]}
            headingRef={heading}
            onSaved={onSaved}
            onSkip={answers[current.id] || current.core ? undefined : onSkip}
          />
        ) : (
          <p className="text-foreground max-w-prose leading-[1.65]" data-testid="discovery-done">
            {DISCOVERY_COPY.allBehind}
          </p>
        )}
        <QuestionList
          questions={questions}
          answers={answers}
          skipped={skipped}
          currentId={currentId}
          onChoose={(id) => {
            moved.current = true;
            setChosen(id);
          }}
        />
      </div>
    );
  }

  // On `/app`, the set ends when every question is answered or skipped. The
  // skipped ones wait in Onboarding's area; they are not pushed here again.
  if (away || !current) return null;

  const offering = variant === 'offer' && !offerTaken;

  return (
    <div
      className="bg-background min-h-full"
      style={clearance > 0 ? { paddingBottom: clearance } : undefined}
      data-testid={`discovery-${variant}`}
    >
      <div
        className={cn(
          'mx-auto flex w-full max-w-[42rem] flex-col gap-8',
          'px-6 pt-[clamp(28px,5vw,56px)] pb-16 max-[480px]:px-4'
        )}
      >
        {variant === 'first' && !movedOn ? (
          <header className="flex flex-col gap-4">
            <Eyebrow as="p">{DISCOVERY_COPY.eyebrow}</Eyebrow>
            <p className="brand-display text-xl leading-[1.5] text-[var(--color-heading)] italic">
              {preamble}
            </p>
            <p className="text-muted-foreground max-w-prose">{DISCOVERY_COPY.breakAway}</p>
          </header>
        ) : null}

        {offering ? (
          <section className="flex flex-col gap-4" data-testid="discovery-offer">
            <Eyebrow as="p">{DISCOVERY_COPY.eyebrow}</Eyebrow>
            <p className="text-foreground max-w-prose">{DISCOVERY_COPY.offer}</p>
            <p className="brand-display text-2xl leading-[1.3] text-[var(--color-heading)]">
              {current.text}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => {
                  moved.current = true;
                  setOfferTaken(true);
                }}
              >
                {DISCOVERY_COPY.answerIt}
              </Button>
              <Button type="button" variant="ghost" onClick={goAway}>
                {DISCOVERY_COPY.notNow}
              </Button>
            </div>
            <p className="text-muted-foreground text-[13.5px]">
              <Link href={ONBOARDING_MODULE_PATH} className="underline underline-offset-2">
                {DISCOVERY_COPY.goTo}
              </Link>
            </p>
          </section>
        ) : (
          <QuestionEditor
            key={current.id}
            question={current}
            existing={answers[current.id]}
            headingRef={heading}
            onSaved={onSaved}
            onSkip={current.core ? undefined : onSkip}
            onLeave={onLeave}
          />
        )}
      </div>
    </div>
  );
}

/** One question, asked: its words, its hint, the yes or no where it branches, and the box. */
function QuestionEditor({
  question,
  existing,
  headingRef,
  onSaved,
  onSkip,
  onLeave,
}: {
  question: DiscoveryQuestionProps;
  existing: DiscoveryAnswer | undefined;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onSaved: (question: DiscoveryQuestionProps, answer: DiscoveryAnswer) => void;
  onSkip?: (question: DiscoveryQuestionProps) => void;
  onLeave?: () => void;
}) {
  const [words, setWords] = React.useState(existing?.words ?? '');
  const [branch, setBranch] = React.useState<DiscoveryBranch | undefined>(existing?.branch);
  const [saving, setSaving] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const baseId = React.useId();
  const hintId = `${baseId}-hint`;
  const boxId = `${baseId}-answer`;

  const followUp = question.followUp;
  const prompt = followUp && branch ? (branch === 'yes' ? followUp.ifYes : followUp.ifNo) : null;
  const ready = words.trim().length > 0 && (!followUp || branch !== undefined);

  const save = async (): Promise<void> => {
    if (!ready || saving) return;
    const answer: DiscoveryAnswer = {
      words: words.trim(),
      ...(followUp && branch ? { branch } : {}),
    };
    setSaving(true);
    setRefusal(null);
    try {
      await apiClient.post(DISCOVERY_ROUTE, {
        body: {
          action: 'answer',
          questionId: question.id,
          answer: answer.words,
          ...(answer.branch ? { branch: answer.branch } : {}),
        },
      });
      onSaved(question, answer);
    } catch (caught) {
      logger.warn('Discovery answer did not save', {
        questionId: question.id,
        error: String(caught),
      });
      setRefusal(
        caught instanceof APIClientError && caught.status === 400
          ? caught.message
          : DISCOVERY_COPY.saveFailed
      );
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      data-testid={`discovery-question-${question.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="flex flex-col gap-2">
        <Eyebrow as="p">{`question ${question.number}`}</Eyebrow>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="brand-display text-2xl leading-[1.3] text-[var(--color-heading)] outline-none"
        >
          {question.text}
        </h2>
        {question.hint ? (
          <p id={hintId} className="text-muted-foreground text-[14px] leading-[1.6] italic">
            {question.hint}
          </p>
        ) : null}
      </header>

      {followUp ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-foreground mb-2 text-[14px] font-medium">
            {DISCOVERY_COPY.yesOrNo}
          </legend>
          <div className="flex gap-5">
            {(['yes', 'no'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name={`${baseId}-branch`}
                  value={option}
                  checked={branch === option}
                  onChange={() => setBranch(option)}
                />
                {option === 'yes' ? DISCOVERY_COPY.yes : DISCOVERY_COPY.no}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {!followUp || prompt ? (
        <div className="flex flex-col gap-2">
          <label
            htmlFor={boxId}
            className={cn(prompt ? 'text-foreground text-[15px] font-medium' : 'sr-only')}
          >
            {prompt ?? DISCOVERY_COPY.answerLabel}
          </label>
          <textarea
            id={boxId}
            value={words}
            rows={7}
            maxLength={MAX_ANSWER_LENGTH}
            aria-describedby={question.hint ? hintId : undefined}
            onChange={(event) => setWords(event.currentTarget.value)}
            className={cn(
              'text-foreground block w-full resize-y rounded-md border p-3 text-[15px]',
              'border-[var(--color-border)] bg-[var(--color-popover)] leading-[1.65] outline-none',
              'focus-visible:border-[var(--color-secondary)]'
            )}
          />
        </div>
      ) : null}

      {refusal ? (
        <Banner tone="error" lead={DISCOVERY_COPY.notSaved}>
          {refusal}
        </Banner>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={!ready || saving}>
          {existing ? DISCOVERY_COPY.saveRevision : DISCOVERY_COPY.save}
        </Button>
        {onSkip ? (
          <Button type="button" variant="ghost" size="lg" onClick={() => onSkip(question)}>
            {DISCOVERY_COPY.skip}
          </Button>
        ) : null}
        {onLeave ? (
          <Button type="button" variant="ghost" size="lg" onClick={onLeave}>
            {DISCOVERY_COPY.leave}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Every question in the set with where it stands, each a way back to it. */
function QuestionList({
  questions,
  answers,
  skipped,
  currentId,
  onChoose,
}: {
  questions: readonly DiscoveryQuestionProps[];
  answers: Readonly<Record<string, DiscoveryAnswer>>;
  skipped: ReadonlySet<string>;
  currentId: string | null;
  onChoose: (id: string) => void;
}) {
  const waiting = questions.some((q) => skipped.has(q.id) && !answers[q.id]);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-foreground text-[15px] font-medium">{DISCOVERY_COPY.listLabel}</h2>
      {waiting ? (
        <p className="text-muted-foreground text-[14px]">{DISCOVERY_COPY.skippedWaiting}</p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label={DISCOVERY_COPY.listLabel}>
        {questions.map((q) => {
          const status = answers[q.id]
            ? DISCOVERY_COPY.answered
            : skipped.has(q.id)
              ? DISCOVERY_COPY.skipped
              : DISCOVERY_COPY.notYet;
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => onChoose(q.id)}
                aria-current={q.id === currentId ? 'step' : undefined}
                className={cn(
                  'flex w-full items-baseline gap-3 rounded-md px-3 py-2 text-left text-[14px]',
                  'hover:bg-[var(--color-pill)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]',
                  q.id === currentId && 'bg-[var(--color-pill)]'
                )}
              >
                <span className="text-muted-foreground w-6 flex-none tabular-nums">{q.number}</span>
                <span className="text-foreground line-clamp-2 flex-1">{q.text}</span>
                <span className="text-muted-foreground flex-none text-[12.5px]">{status}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
