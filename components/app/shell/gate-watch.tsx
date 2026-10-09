'use client';

/**
 * Takes someone to the gate when the API says they have not passed it (t-159).
 *
 * The shell layout checks the gate on entry, and a layout is not re-rendered
 * between its own pages. So a person can be in the shell when the gate closes
 * on them — a new version of the terms, which re-gates everyone — and from then
 * every app route refuses them (`403 GATE_REQUIRED`) and every turn too (`409`,
 * reason `GATE_REQUIRED`). Without this the panes would each fail in their own
 * way and nothing would say why (`HB10`).
 *
 * ## Why it watches `fetch` rather than each caller
 *
 * The shell reaches the API from some thirty call sites across `apiClient`,
 * plain `fetch` and the conversation's stream client. Teaching each of them the
 * gate is thirty places to forget it in, and the next view added would be the
 * thirty-first. Every one of them goes through the page's `fetch`, so this
 * wraps it once, while the shell is mounted, and restores it on unmount.
 *
 * It only ever reads a refusal: a response that is not a same-origin
 * `/api/v1/` `403` or `409` is handed back untouched and never cloned, so a
 * stream is never teed. The body is read from a clone, so the caller still gets
 * the response it asked for.
 *
 * @see lib/app/gateway/gate-codes.ts — the code, and the two shapes it arrives in
 */

import { useEffect } from 'react';
import { z } from 'zod';

import { GATE_FALLBACK_LOCATION, GATE_REQUIRED } from '@/lib/app/gateway/gate-codes';

const refusalSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().optional(),
    details: z
      .object({
        location: z.string().optional(),
        reason: z.string().optional(),
      })
      .passthrough()
      .optional(),
  }),
});

/** A path on this site — never another origin, never protocol-relative. */
function isLocalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isOwnApi(input: RequestInfo | URL, origin: string): boolean {
  try {
    const url = new URL(requestUrl(input), origin);
    return url.origin === origin && url.pathname.startsWith('/api/v1/');
  } catch {
    return false;
  }
}

/**
 * Where a response says to send the person, or `null` when it is not a gate
 * refusal. Exported for the test.
 */
export async function gateLocationFrom(response: Response): Promise<string | null> {
  if (response.status !== 403 && response.status !== 409) return null;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  const parsed = refusalSchema.safeParse(body);
  if (!parsed.success) return null;
  const { code, details } = parsed.data.error;

  if (response.status === 403 && code === GATE_REQUIRED) {
    const location = details?.location;
    return location !== undefined && isLocalPath(location) ? location : GATE_FALLBACK_LOCATION;
  }
  if (response.status === 409 && details?.reason === GATE_REQUIRED) {
    return GATE_FALLBACK_LOCATION;
  }
  return null;
}

/**
 * Wrap `target.fetch` so a gate refusal from our own API — `origin` — navigates
 * to the gate. Returns the function that puts the original back. Exported for
 * the test.
 */
export function watchForGate(
  target: { fetch: typeof fetch },
  navigate: (location: string) => void,
  origin: string
): () => void {
  const original = target.fetch;
  let leaving = false;

  const watched: typeof fetch = async (input, init) => {
    // Called on its owner: the browser's `fetch` throws "Illegal invocation"
    // when called detached from `window`.
    const response = await original.call(target, input, init);
    if (
      !leaving &&
      (response.status === 403 || response.status === 409) &&
      isOwnApi(input, origin)
    ) {
      const location = await gateLocationFrom(response);
      if (location !== null && !leaving) {
        leaving = true;
        navigate(location);
      }
    }
    return response;
  };

  target.fetch = watched;
  return () => {
    // Only undo our own wrapping: something that wrapped fetch after us keeps its own.
    if (target.fetch === watched) target.fetch = original;
  };
}

/** Mounted once, in the shell layout. Renders nothing. */
export function GateWatch() {
  useEffect(
    () =>
      watchForGate(
        window,
        (location) => {
          // A full navigation, not the router: the layout's gate has to run again.
          window.location.assign(location);
        },
        window.location.origin
      ),
    []
  );
  return null;
}
