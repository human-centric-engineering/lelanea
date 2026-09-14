'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/app/ui/button';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { apiClient } from '@/lib/api/client';
import { logger } from '@/lib/logging';
import type { AcknowledgementKind, GateStatusJson, KindStatusJson } from '@/lib/app/gateway/kinds';
import { cn } from '@/lib/utils';

/** The API this view writes to and re-reads from. */
export const ACKNOWLEDGEMENTS_ROUTE = '/api/v1/app/acknowledgements';

/** Where `Begin` goes once every kind stands. */
export const SHELL_ROUTE = '/app';

/** The design guide's error line — a description of what happened, not a fault. */
export const DID_NOT_LAND = "Something didn't land. Try that once more.";

/**
 * The words on each control, in the prototype's register: sentence case, no
 * exclamation, "you". Exported so the page test can assert them without
 * restating them.
 */
export const CONTROL_COPY: Record<
  AcknowledgementKind,
  { statement: string; action: string; record: string }
> = {
  disclaimer: {
    statement: 'You have read the disclaimer, and you understand what Lelañea is and is not.',
    action: 'I have read the disclaimer',
    record: 'Disclaimer acknowledged',
  },
  terms: {
    statement: 'You have read the terms of use, and you agree to them.',
    action: 'I agree to the terms',
    record: 'Terms acknowledged',
  },
  age_18: {
    statement: 'The terms ask that you are eighteen or over.',
    action: 'I am eighteen or over',
    record: 'Age confirmed',
  },
};

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

interface ControlProps {
  entry: KindStatusJson;
  busy: boolean;
  onAcknowledge: (kind: AcknowledgementKind) => void;
}

/**
 * One acknowledgement: the statement, then either the action or the record.
 *
 * Once satisfied it is a `<p>` with a `<time>`, not a disabled button — the
 * control has become a fact, and a fact reads as one. There is no way to
 * un-acknowledge from here, and there should not be: the ledger is insert-only.
 */
function Control({ entry, busy, onAcknowledge }: ControlProps) {
  const copy = CONTROL_COPY[entry.kind];

  return (
    <div
      className={cn(
        'bg-background rounded-lg border border-[var(--color-card-border)]',
        'px-[22px] py-5 shadow-[var(--shadow-rest)]',
        'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'
      )}
    >
      <p className="text-[var(--color-heading)]">{copy.statement}</p>
      {entry.satisfied && entry.acknowledgedAt ? (
        <p className="text-muted-foreground shrink-0 text-sm" data-testid={`record-${entry.kind}`}>
          {copy.record} ·{' '}
          <time dateTime={entry.acknowledgedAt}>{formatRecordDate(entry.acknowledgedAt)}</time>
        </p>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={() => onAcknowledge(entry.kind)}
        >
          {copy.action}
        </Button>
      )}
    </div>
  );
}

export interface BeginViewProps {
  /** Where the person stands on first paint, from `getGateStatus()` on the server. */
  initialStatus: GateStatusJson;
  /**
   * The two documents, already rendered on the server — `AuthoredBlocks` is a
   * server component and the words never need to reach the browser as data.
   * Keyed by kind so the view can place each above its own control.
   */
  documents: { disclaimer: React.ReactNode; terms: React.ReactNode };
}

/**
 * The gate: read both documents in full, say so, confirm your age, then begin.
 *
 * ## What is client-side here, and what is not
 *
 * The documents arrive as rendered nodes. Only the three controls and the
 * status they change are state, so this is the smallest island the page can
 * have — the prose is not re-shipped as JSON and is not re-rendered on a click.
 *
 * ## The status after a POST is the server's, not a guess
 *
 * `POST` answers with the whole gate status after the write, so the view
 * replaces its state with the response rather than flipping one flag locally.
 * That is what keeps a double-click, a second tab, or a content version bump
 * between paint and click from leaving the page showing a state the ledger
 * does not hold.
 *
 * ## Afterwards, this is the record
 *
 * With every kind satisfied the same page renders each control as a fact with
 * its date, and `Begin` is the only action left. The shell layout no longer
 * redirects here, but the page stays reachable, because "what did I agree to,
 * and when" is a question a person is entitled to have answered without
 * asking us.
 */
export function BeginView({ initialStatus, documents }: BeginViewProps) {
  const [status, setStatus] = React.useState<GateStatusJson>(initialStatus);
  const [busy, setBusy] = React.useState<AcknowledgementKind | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const entryFor = (kind: AcknowledgementKind): KindStatusJson => {
    // Non-null: the ledger presents every kind, in order, every time.
    return status.kinds.find((entry) => entry.kind === kind)!;
  };

  const acknowledge = (kind: AcknowledgementKind): void => {
    setBusy(kind);
    setError(null);
    apiClient
      .post<GateStatusJson>(ACKNOWLEDGEMENTS_ROUTE, { body: { kind } })
      .then(setStatus)
      .catch((caught: unknown) => {
        logger.warn('Acknowledgement did not land', { kind, error: String(caught) });
        setError(DID_NOT_LAND);
      })
      .finally(() => setBusy(null));
  };

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <Eyebrow as="p">before you begin</Eyebrow>
        <h1 className="brand-display text-4xl text-[var(--color-heading)] sm:text-5xl">
          Two things to read, and one thing to confirm.
        </h1>
        <p className="text-muted-foreground max-w-prose text-lg">
          Lelañea is a place to return to. It is not therapy, not healthcare, and not crisis support
          — the disclaimer says what it is and is not, and the terms say how it is used. Read both,
          in full, and say so below. What you agree to here is recorded, with the version and the
          date, and you can come back to this page to see it.
        </p>
      </header>

      <section className="flex flex-col gap-6" aria-labelledby="begin-disclaimer">
        <div id="begin-disclaimer">{documents.disclaimer}</div>
        <Control entry={entryFor('disclaimer')} busy={busy !== null} onAcknowledge={acknowledge} />
      </section>

      <section className="flex flex-col gap-6" aria-labelledby="begin-terms">
        <div id="begin-terms">{documents.terms}</div>
        <Control entry={entryFor('terms')} busy={busy !== null} onAcknowledge={acknowledge} />
      </section>

      <section className="flex flex-col gap-6" aria-labelledby="begin-age">
        <Eyebrow as="h2" id="begin-age">
          your age
        </Eyebrow>
        <Control entry={entryFor('age_18')} busy={busy !== null} onAcknowledge={acknowledge} />
      </section>

      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-col gap-3 pb-20">
        {status.complete ? (
          <Button asChild size="lg" className="self-start">
            <Link href={SHELL_ROUTE}>Begin</Link>
          </Button>
        ) : (
          <p className="text-muted-foreground">Begin once all three stand. There is no hurry.</p>
        )}
      </footer>
    </div>
  );
}
