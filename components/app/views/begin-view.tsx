'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/app/ui/button';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { apiClient } from '@/lib/api/client';
import { logger } from '@/lib/logging';
import {
  ACKNOWLEDGEMENT_KINDS,
  type AcknowledgementKind,
  type GateStatusJson,
  type KindStatusJson,
} from '@/lib/app/gateway/kinds';
import { cn } from '@/lib/utils';

/** The API this view writes to and re-reads from. */
export const ACKNOWLEDGEMENTS_ROUTE = '/api/v1/app/acknowledgements';

/** Where `Begin` goes once every kind stands. */
export const SHELL_ROUTE = '/app';

/** The design guide's error line — a description of what happened, not a fault. */
export const DID_NOT_LAND = "Something didn't land. Try that once more.";

/**
 * The words for each step, in the prototype's register: sentence case, no
 * exclamation, "you". Exported so the tests can assert them without restating
 * them.
 *
 * `title` is the step's own heading — not the document's, which sits inside
 * the pane with its own header. `readAgain` is where the record screen sends
 * someone who wants the text back; the two public pages carry the same
 * documents, with no controls.
 */
export const STEP_COPY: Record<
  AcknowledgementKind,
  { title: string; statement: string; action: string; record: string; readAgain: string | null }
> = {
  disclaimer: {
    title: 'First, what this is — and what it is not.',
    statement: 'You have read the disclaimer, and you understand what Lelañea is and is not.',
    action: 'I have read the disclaimer',
    record: 'Disclaimer acknowledged',
    readAgain: '/disclaimer',
  },
  terms: {
    title: 'Then, the terms.',
    statement: 'You have read the terms of use, and you agree to them.',
    action: 'I agree to the terms',
    record: 'Terms acknowledged',
    readAgain: '/terms',
  },
  age_18: {
    title: 'And one thing to confirm.',
    statement: 'Lelañea is for adults. The terms ask that you are eighteen or over.',
    action: 'I am eighteen or over',
    record: 'Age confirmed',
    readAgain: null,
  },
};

/**
 * The body of the age step, which has no document to fill it. What the
 * confirmation is, that it is kept, and what comes after — and nothing the app
 * does not yet do: the product description's "if you say you are under
 * eighteen the app stops" is later work, so it is not promised here.
 */
export const AGE_STEP_BODY = [
  'The work Lelañea invites is a grown-up\u2019s work \u2014 slow, honest, and yours to carry \u2014 and the terms of use ask that you are eighteen or over before you take it on.',
  'Confirming this is kept beside the two acknowledgements, with the date. After it, you begin: the conversation, the map, and the first room. Everything you have agreed to here can be read back from this page whenever you want it.',
];

/** "one of three" — words, not a progress bar; there are three and they are short. */
const ORDINAL: Record<number, string> = { 0: 'one', 1: 'two', 2: 'three' };

/**
 * A date for the record line, formatted the same way on the server and in the
 * browser. `timeZone: 'UTC'` is what makes it deterministic — a formatter left
 * to the reader's zone can produce one string during SSR and another on
 * hydration, and React answers that with a warning and a re-render on the one
 * page whose job is to be a reliable record. The cost is a date that can sit a
 * day off for someone far from UTC, on a line whose point is "this stands"
 * rather than the hour it was clicked.
 */
const RECORD_DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

export function formatRecordDate(iso: string): string {
  return RECORD_DATE.format(new Date(iso));
}

export interface BeginViewProps {
  /** Where the person stands on first paint, from `getGateStatus()` on the server. */
  initialStatus: GateStatusJson;
  /**
   * The two documents, already rendered on the server — `AuthoredBlocks` is a
   * server component and the words never need to reach the browser as data.
   * Keyed by kind so the view can place each in its own step.
   */
  documents: { disclaimer: React.ReactNode; terms: React.ReactNode };
}

/**
 * The gate: one thing at a time, and then you begin.
 *
 * ## Why steps, and not one page
 *
 * The first version put both documents in full on one page with the controls
 * underneath — about ten screens of legal text before the first button. The
 * owner's reaction was that anyone landing there would leave and not come
 * back, which is the whole gate failing at its one job. So: one step per kind.
 * Each is a single viewport — the step's heading, the document in a pane that
 * scrolls on its own, and the control always in view beneath it. The text is
 * still there in full, and it is still read before it is agreed to; it is just
 * not a wall.
 *
 * The current step is the first outstanding kind, so a person who did two of
 * three last week lands on the third. There is no "back": an acknowledged
 * document is on its public page, and the record screen links there.
 *
 * ## The status after a POST is the server's, not a guess
 *
 * `POST` answers with the whole gate status after the write, so the view
 * replaces its state with the response rather than flipping one flag locally.
 * That is what keeps a double-click, a second tab, or a content version bump
 * between paint and click from leaving the page showing a state the ledger
 * does not hold — and it is what moves the step on.
 *
 * ## Afterwards, this is the record
 *
 * With every kind satisfied the same page renders the three facts with their
 * dates, a way back to each text, and `Begin`. The shell layout no longer
 * redirects here, but the page stays reachable, because "what did I agree to,
 * and when" is a question a person is entitled to have answered without
 * asking us.
 */
export function BeginView({ initialStatus, documents }: BeginViewProps) {
  const [status, setStatus] = React.useState<GateStatusJson>(initialStatus);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const acknowledge = (kind: AcknowledgementKind): void => {
    setBusy(true);
    setError(null);
    apiClient
      .post<GateStatusJson>(ACKNOWLEDGEMENTS_ROUTE, { body: { kind } })
      .then(setStatus)
      .catch((caught: unknown) => {
        logger.warn('Acknowledgement did not land', { kind, error: String(caught) });
        setError(DID_NOT_LAND);
      })
      .finally(() => setBusy(false));
  };

  if (status.complete) {
    // `Begin` for the person who just finished the third step; `Return` for
    // the one who came back to read the record (from the account view), who
    // began some time ago and has nothing to begin.
    return <Record status={status} justCompleted={!initialStatus.complete} />;
  }

  // `complete` is false exactly when `outstanding` is non-empty.
  const current = status.outstanding[0];
  const stepIndex = ACKNOWLEDGEMENT_KINDS.indexOf(current);
  const copy = STEP_COPY[current];
  const document = current === 'age_18' ? null : documents[current];

  return (
    // A document step is a fixed frame — the pane scrolls, the control stays in
    // view. The age step has no pane, so it flows at its own height instead of
    // stranding the control at the bottom of an empty viewport.
    <div
      className={cn('flex flex-col', document ? 'h-dvh' : 'min-h-[60dvh]')}
      data-testid={`step-${current}`}
    >
      <header className="flex flex-col gap-2 pt-[clamp(28px,5vw,48px)] pb-6">
        <Eyebrow as="p">before you begin · {ORDINAL[stepIndex]} of three</Eyebrow>
        <h1 className="brand-display text-3xl text-[var(--color-heading)] sm:text-4xl">
          {copy.title}
        </h1>
        {stepIndex === 0 ? (
          <p className="text-muted-foreground max-w-prose">
            Three short steps, and each one is recorded — what you agreed to, which version, and
            when. You can come back to this page to see it.
          </p>
        ) : null}
      </header>

      {document ? (
        // Keyed by step, so the pane is a NEW element for each document. Without
        // it React keeps the same div — same place in the tree — and swaps its
        // children, and the scroll position of step one is the scroll position
        // step two opens at (owner, first walk-through).
        <div
          key={current}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            'border-y border-[var(--color-divider)] py-8',
            // A little room on the right so the scrollbar does not sit on the text.
            'pr-4'
          )}
          data-testid="document-pane"
        >
          {document}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 py-2" data-testid="age-body">
          {AGE_STEP_BODY.map((paragraph) => (
            <p key={paragraph} className="text-foreground max-w-prose text-lg">
              {paragraph}
            </p>
          ))}
        </div>
      )}

      <footer className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-prose text-[var(--color-heading)]">{copy.statement}</p>
        <div className="flex shrink-0 flex-col items-start gap-2">
          <Button type="button" disabled={busy} onClick={() => acknowledge(current)}>
            {copy.action}
          </Button>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** Where `Return` goes: the row that leads here is on the account view. */
export const ACCOUNT_ROUTE = '/app/account';

/** The screen once every kind stands — three facts, their dates, and one way on. */
function Record({ status, justCompleted }: { status: GateStatusJson; justCompleted: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col gap-10 pt-[clamp(28px,5vw,48px)] pb-20">
      <header className="flex flex-col gap-2">
        <Eyebrow as="p">what you agreed to</Eyebrow>
        <h1 className="brand-display text-3xl text-[var(--color-heading)] sm:text-4xl">
          This stands.
        </h1>
      </header>

      <ul className="flex flex-col gap-3">
        {status.kinds.map((entry: KindStatusJson) => {
          const copy = STEP_COPY[entry.kind];
          return (
            <li
              key={entry.kind}
              data-testid={`record-${entry.kind}`}
              className={cn(
                'bg-background rounded-lg border border-[var(--color-card-border)]',
                'px-[22px] py-4 shadow-[var(--shadow-rest)]',
                'flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between'
              )}
            >
              <span className="text-[var(--color-heading)]">
                {copy.record}
                {entry.acknowledgedAt ? (
                  <>
                    {' · '}
                    <time dateTime={entry.acknowledgedAt} className="text-muted-foreground">
                      {formatRecordDate(entry.acknowledgedAt)}
                    </time>
                  </>
                ) : null}
              </span>
              {copy.readAgain ? (
                <Link
                  href={copy.readAgain}
                  className="text-muted-foreground text-sm underline underline-offset-4"
                >
                  Read it again
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>

      {justCompleted ? (
        <Button asChild size="lg" className="self-start">
          <Link href={SHELL_ROUTE}>Begin</Link>
        </Button>
      ) : (
        <Button asChild variant="secondary" className="self-start">
          <Link href={ACCOUNT_ROUTE}>Return</Link>
        </Button>
      )}
    </div>
  );
}
