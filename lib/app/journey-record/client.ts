/**
 * The journey record's routes, as the timeline at `/app/journey` calls them
 * (f-journey-record t-148).
 *
 * Every call answers nothing on success: the page re-reads the whole record
 * afterwards (`router.refresh()`), the way the notes panel re-reads after a
 * correction, so what is on screen is always one server read and never a
 * patch the browser made up. A refusal throws {@link JourneyRefused}, whose
 * message is the route's own and is written to be shown.
 *
 * @see app/api/v1/app/journey-record/ — the routes
 * @see .context/app/journey-record.md
 */

import { z } from 'zod';

import type { JourneyNoteRef, JourneyOutcome } from '@/lib/app/journey-record/entry';

export const JOURNEY_RECORD_ENDPOINT = '/api/v1/app/journey-record';

/** The kept record as a Markdown download. */
export const JOURNEY_RECORD_EXPORT = `${JOURNEY_RECORD_ENDPOINT}/export`;

/** The route answered, and the answer was no. */
export class JourneyRefused extends Error {
  readonly status: number;
  /** `details.reason` where the route gave one (`changed_meanwhile`, `busy`…), else the envelope's code. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'JourneyRefused';
    this.status = status;
    this.code = code;
  }
}

const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const reasonSchema = z.object({ reason: z.string() });

/**
 * The words a refusal is shown in. The routes' own messages are written for
 * a person; these replace the few that are not, or that need a next step.
 */
const REASON_WORDS: Readonly<Record<string, string>> = {
  changed_meanwhile:
    'This changed since the page loaded, perhaps in another tab. The page now shows the latest version.',
  busy: 'This is still being saved. Try again in a moment.',
  still_answering:
    'Lelañea is still answering in this session. Try again once the reply has finished.',
  regenerating: 'Another draft is already being written. Try again in a moment.',
  no_more_drafts: 'There are no more drafts to ask for. Change this one yourself instead.',
  paused: 'Lelañea is paused just now, so no new draft can be written.',
  ceiling_reached: 'You have reached this month’s limit, so no new draft can be written.',
  no_agent: 'Nothing is set up to write drafts just now.',
};

async function refusalOf(response: Response): Promise<JourneyRefused> {
  let code = `http_${response.status}`;
  let message = 'That did not go through. Try again in a moment.';
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) {
      const reason = reasonSchema.safeParse(parsed.data.error.details);
      code = reason.success ? reason.data.reason : parsed.data.error.code;
      message = parsed.data.error.message;
    }
  } catch {
    // Not JSON: the status is all we know.
  }
  return new JourneyRefused(response.status, code, REASON_WORDS[code] ?? message);
}

interface Options {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

async function send(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  options: Options
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await refusalOf(response);
}

const entryPath = (id: string) => `${JOURNEY_RECORD_ENDPOINT}/${encodeURIComponent(id)}`;

export interface OwnEntryWords {
  summary: string;
  body: string;
  withheldFromAgent: boolean;
}

/** Something the person writes themselves. */
export async function writeOwnEntry(entry: OwnEntryWords, options: Options = {}): Promise<void> {
  await send(JOURNEY_RECORD_ENDPOINT, 'POST', entry, options);
}

/** Change an own entry's words, or whether Lelañea may read it. */
export async function changeOwnEntry(
  id: string,
  change: Partial<OwnEntryWords>,
  options: Options = {}
): Promise<void> {
  await send(entryPath(id), 'PATCH', change, options);
}

/** Remove any entry, words and all. How a draft is discarded. */
export async function removeEntry(id: string, options: Options = {}): Promise<void> {
  await send(entryPath(id), 'DELETE', undefined, options);
}

export interface SynopsisKeepRequest {
  /** The entry's `updatedAt` as the page showed it. */
  seen: string;
  /** The listed notes still ticked. */
  confirm: JourneyNoteRef[];
  /** The person's changes; absent to keep it as written. */
  edit?: { summary: string; body: string; outcomes: JourneyOutcome[] };
}

/**
 * Keep a synopsis as written or changed, or change one already kept. What it
 * did to the notes reaches the page through the re-read after it: a keep that
 * could not settle them leaves the entry `notesPending`, which the stop shows.
 */
export async function keepSynopsis(
  id: string,
  keep: SynopsisKeepRequest,
  options: Options = {}
): Promise<void> {
  await send(`${entryPath(id)}/keep`, 'POST', keep, options);
}

/** Another draft in place of this one, optionally saying what was wrong. */
export async function regenerateSynopsis(
  id: string,
  steer: string,
  options: Options = {}
): Promise<void> {
  await send(`${entryPath(id)}/regenerate`, 'POST', { steer }, options);
}

/** `DELETE /api/v1/app/sessions/:id` (f-forget-session t-153). */
export const SESSIONS_ENDPOINT = '/api/v1/app/sessions';

/**
 * Delete a whole session: what was said in it, Lelañea's replies, the notes it
 * wrote, the recaps of it, and its draft (t-154). `removeAccount` takes a kept
 * account with it; without it, the kept account stays and is marked as written
 * from a conversation since deleted.
 */
export async function deleteSession(
  sessionId: string,
  removeAccount: boolean,
  options: Options = {}
): Promise<void> {
  await send(
    `${SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}`,
    'DELETE',
    { removeAccount },
    options
  );
}
