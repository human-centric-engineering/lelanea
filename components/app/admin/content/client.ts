/**
 * The content editor's requests (f-content-seeds t-91): one `send()` for every
 * write, one error reader, one download.
 *
 * Shaped like the slot editor's (`components/app/admin/slot-definitions.tsx`):
 * a write returns `{ ok, data }` or `{ ok: false, message }` rather than
 * throwing, so every panel shows the server's own sentence (which names the
 * reader that blocked a delete, or the revision that moved) instead of a
 * generic failure.
 */

import { parseApiResponse } from '@/lib/api/parse-response';

export type Result<T> = { ok: true; data: T } | { ok: false; message: string; details?: unknown };

/** The first field error when there is one, the message otherwise. */
export function errorMessage(error: { message: string; details?: unknown }): string {
  const details = error.details;
  if (details && typeof details === 'object') {
    if ('refusals' in details && Array.isArray(details.refusals)) {
      return details.refusals.filter((line): line is string => typeof line === 'string').join(' ');
    }
    if ('errors' in details && Array.isArray(details.errors)) {
      const first: unknown = details.errors[0];
      if (
        first &&
        typeof first === 'object' &&
        'message' in first &&
        typeof first.message === 'string'
      ) {
        const path = 'path' in first && typeof first.path === 'string' ? first.path : '';
        return path !== '' ? `${path} — ${first.message}` : first.message;
      }
    }
  }
  return error.message;
}

export async function send<T>(method: string, url: string, body?: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await parseApiResponse<T>(response);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, message: errorMessage(parsed.error), details: parsed.error.details };
  } catch {
    return { ok: false, message: 'The request did not reach the server. Nothing was changed.' };
  }
}

/**
 * How long the blob URL outlives the click. Firefox and Safari read a blob URL
 * asynchronously, so revoking it on the next tick fails the download; the
 * slot export and the Art. 15 row settled on a minute for the same reason.
 */
const REVOKE_AFTER_MS = 60_000;

/**
 * Fetch an export and hand it to the browser. Fetched rather than linked
 * because the route can refuse (nothing seeded, or a stored row the file
 * format cannot hold), and a link would save the error envelope to disk.
 */
export async function downloadExport(url: string, fallbackName: string): Promise<Result<null>> {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      const parsed = await parseApiResponse<unknown>(response);
      return {
        ok: false,
        message: parsed.success ? 'The export failed.' : errorMessage(parsed.error),
      };
    }
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = window.document.createElement('a');
    link.href = blobUrl;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), REVOKE_AFTER_MS);
    return { ok: true, data: null };
  } catch {
    return { ok: false, message: 'The export did not reach the server. Nothing was downloaded.' };
  }
}

/** An optional text field as the API takes it: empty is "none". */
export function orNull(value: string): string | null {
  return value.trim() === '' ? null : value;
}
