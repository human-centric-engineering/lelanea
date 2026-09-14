'use client';

import { Download } from 'lucide-react';
import * as React from 'react';

import { apiClient, APIClientError } from '@/lib/api/client';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/** The self-service Art. 15 route — the only thing in the tree that exports. */
export const EXPORT_ROUTE = '/api/v1/users/me/export';

/**
 * The row's three answers, in the prototype's register — a description of
 * what happened and what to do, never a fault. Exported for the tests.
 */
export const EXPORT_COPY = {
  idle: 'Everything held about you, as one file. It is yours to keep.',
  busy: 'Gathering it. This can take a moment.',
  done: 'Saved. Look for it where your browser keeps downloads.',
  limited: 'You have asked for a few copies just now. Give it a minute, then try once more.',
  failed: "Something didn't land. Try that once more.",
} as const;

export type ExportState = keyof typeof EXPORT_COPY;

/** The file the browser is handed. Dated, so two copies do not overwrite each other. */
export function exportFilename(now = new Date()): string {
  return `lelanea-my-data-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Hand a JSON document to the browser as a download.
 *
 * A blob URL and a synthetic click, because the route's own
 * `Content-Disposition: attachment` only helps a NAVIGATION — and navigating
 * to it was the problem this row replaces (see below). Revoked on the next
 * tick: the click has already consumed the URL by then.
 */
function saveJson(document: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Export a copy of everything held about you" — a control, not a link.
 *
 * ## Why not a link to the route
 *
 * t-11 linked the account view straight at `GET /api/v1/users/me/export` in a
 * new tab. On a 2xx the `Content-Disposition: attachment` makes the browser
 * download and nothing opens — but the route answers a rate-limit refusal, and
 * anything thrown inside `exportUserData()`, as a bare JSON envelope with no
 * disposition, and a NAVIGATION to that commits: raw `{"success":false,…}`
 * in a tab, on an Art. 15 control, with nothing on the page saying what
 * happened. A fetch keeps the answer in the row: the file is handed over on
 * success, and a refusal is a sentence rather than a JSON screen.
 *
 * `apiClient` unwraps the envelope, so `data` IS the bundle — what the route
 * would have written to the file, re-serialised here with the same two-space
 * indent. The filename is the client's: the route's header is not readable
 * through the client, and a date is more useful than a user id anyway.
 *
 * ## One button on a page of links
 *
 * Every other row on the account view is a link, and the view's test insists
 * on that — "a link rather than a button that lies". This is the one control
 * that is genuinely an action: nothing is navigated to, a file is produced.
 */
export function ExportDataRow() {
  const [state, setState] = React.useState<ExportState>('idle');

  const request = (): void => {
    setState('busy');
    apiClient
      .get<unknown>(EXPORT_ROUTE)
      .then((bundle) => {
        saveJson(bundle, exportFilename());
        setState('done');
      })
      .catch((caught: unknown) => {
        const limited = caught instanceof APIClientError && caught.status === 429;
        logger.warn('Self-service export did not complete', {
          limited,
          error: String(caught),
        });
        setState(limited ? 'limited' : 'failed');
      });
  };

  const busy = state === 'busy';

  return (
    <button
      type="button"
      onClick={request}
      disabled={busy}
      aria-busy={busy}
      className={cn(
        'bg-background mb-2 block w-full rounded-[15px] border border-[var(--color-card-border)]',
        'px-[15px] py-[13px] text-left',
        'disabled:hover:bg-background hover:bg-[var(--color-pill-hover)]',
        'transition-[background-color] duration-200 ease-[var(--ease-brand)]',
        'motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
        'focus-visible:outline-[var(--color-ring)]',
        'disabled:cursor-progress'
      )}
    >
      <span className="flex items-center gap-2 text-[var(--color-heading)]">
        Export a copy of everything held about you
        <Download size={14} strokeWidth={1.5} aria-hidden="true" className="flex-none" />
      </span>
      <span
        className={cn(
          'mt-1 block text-[13px] leading-[1.55]',
          state === 'failed' || state === 'limited'
            ? 'text-[var(--color-heading)]'
            : 'text-muted-foreground'
        )}
        role={state === 'failed' || state === 'limited' ? 'alert' : undefined}
        aria-live="polite"
        data-state={state}
      >
        {EXPORT_COPY[state]}
      </span>
    </button>
  );
}
