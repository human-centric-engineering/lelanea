'use client';

import { Download } from 'lucide-react';
import * as React from 'react';

import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/** The self-service Art. 15 route — the only thing in the tree that exports. */
export const EXPORT_ROUTE = '/api/v1/users/me/export';

/**
 * Where an ended session is sent, and where it comes back to.
 *
 * The clear-session route, not `/login` directly: a 401 with the cookie still
 * in the jar (revoked from another device, session row pruned) would hit the
 * proxy's cookie-presence check on `/login` and be bounced into the shell,
 * which clears it and comes back to `/login?callbackUrl=/app` — the way back
 * here lost. This is what the server's own `clearInvalidSession()` does, from
 * the browser (code review, round 2).
 */
export const SIGN_IN_ROUTE = '/api/auth/clear-session?returnUrl=%2Fapp%2Faccount';

/**
 * The row's answers, in the prototype's register — a description of what
 * happened and what to do, never a fault. Exported for the tests.
 */
export const EXPORT_COPY = {
  idle: 'Everything held about you, as one file. It is yours to keep.',
  busy: 'Gathering it. This can take a moment.',
  done: 'Saved. Look for it where your browser keeps downloads.',
  limited: 'You have asked for a few copies just now. Give it a minute, then try once more.',
  failed: "Something didn't land. Try that once more.",
} as const;

export type ExportState = keyof typeof EXPORT_COPY;

/**
 * The file the browser is handed. Dated in the READER's calendar, not UTC —
 * someone in Sydney exporting at eight in the morning should not receive
 * yesterday's date (code review, round 1). Informational: same-day copies are
 * suffixed by the browser anyway.
 */
export function exportFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `lelanea-my-data-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * Hand a file to the browser.
 *
 * A blob URL and a synthetic click, because the route's own
 * `Content-Disposition: attachment` only helps a NAVIGATION — and navigating
 * to it was the problem this row replaces (see below).
 */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * How long the blob URL outlives the click. Chrome resolves it synchronously;
 * Firefox and Safari begin the read asynchronously, and a URL revoked on the
 * next tick can fail a large download with a network error while the row
 * says "Saved". A minute is what the file-saver libraries settle on; the cost
 * is the bundle staying in memory that long (code review, round 2).
 */
const REVOKE_AFTER_MS = 60_000;

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
 * ## `fetch` and `res.blob()`, not `apiClient`
 *
 * The bundle is the whole account — the route's header lists about
 * twenty-eight tables, every conversation and message among them. `apiClient`
 * would parse all of it into objects so the row could stringify it again,
 * holding a heavy account three times over in the tab. `res.blob()` moves the
 * bytes straight to the file, as `backup-panel.tsx` does for the same reason,
 * and a non-2xx never reaches the parser at all: its status is the whole
 * answer. The file is the route's own body, byte for byte.
 *
 * ## The three refusals
 *
 * 429 is "give it a minute". 401 is a session that has ended while the page
 * sat open — "try once more" can never succeed there, so the row sends the
 * person to sign in and back here. Anything else is the guide's line.
 *
 * ## One button on a page of links
 *
 * Every other row on the account view is a link, and the view's test insists
 * on that — "a link rather than a button that lies". This is the one control
 * that is genuinely an action: nothing is navigated to, a file is produced.
 *
 * ## The status line is a SIBLING of the button, not a child
 *
 * The first shape put the line inside the `<button>`. A button's children are
 * presentational, so assistive tech flattens them: the line was not a live
 * region at all, its text was folded into the button's name, and a
 * screen-reader user who hit the rate limit heard nothing. Now the card is a
 * `<div>`, the button is the title, and one always-mounted `role="status"`
 * region beneath it carries every answer — a region that exists before the
 * text changes is what gets announced (code review, round 2).
 */
export function ExportDataRow() {
  const [state, setState] = React.useState<ExportState>('idle');

  const request = (): void => {
    setState('busy');
    fetch(EXPORT_ROUTE, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (res.ok) {
          save(await res.blob(), exportFilename());
          setState('done');
          return;
        }
        if (res.status === 401) {
          window.location.assign(SIGN_IN_ROUTE);
          return;
        }
        logger.warn('Self-service export refused', { status: res.status });
        setState(res.status === 429 ? 'limited' : 'failed');
      })
      .catch((caught: unknown) => {
        logger.warn('Self-service export did not complete', { error: String(caught) });
        setState('failed');
      });
  };

  const busy = state === 'busy';
  const refused = state === 'failed' || state === 'limited';

  return (
    <div
      className={cn(
        'bg-background mb-2 rounded-[15px] border border-[var(--color-card-border)]',
        'px-[15px] py-[13px]'
      )}
    >
      <button
        type="button"
        onClick={request}
        disabled={busy}
        aria-busy={busy}
        aria-describedby="export-data-status"
        className={cn(
          'flex w-full items-center gap-2 rounded-md text-left text-[var(--color-heading)]',
          'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid',
          'focus-visible:outline-[var(--color-ring)]',
          'disabled:cursor-progress'
        )}
      >
        Export a copy of everything held about you
        <Download size={14} strokeWidth={1.5} aria-hidden="true" className="flex-none" />
      </button>
      <p
        id="export-data-status"
        role="status"
        data-state={state}
        className={cn(
          'mt-1 text-[13px] leading-[1.55]',
          refused ? 'text-[var(--color-heading)]' : 'text-muted-foreground'
        )}
      >
        {EXPORT_COPY[state]}
      </p>
    </div>
  );
}
