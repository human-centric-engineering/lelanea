/**
 * The browser's side of her notes (f-slots t-73).
 *
 * Read the page, and send a correction. Kept apart from the store for the
 * reason `notes-view.ts` gives — the panel is a client component and the store
 * reaches `@/lib/db/client` — and apart from `notes-view.ts` so the wire *shape*
 * stays importable by the server without dragging a `fetch` wrapper with it.
 *
 * Same discipline as `lib/app/conversation/client.ts`: the envelope is parsed
 * rather than cast, a refusal is read before the body is trusted, and the
 * refusal's **message is kept** — the two 409s this route can answer say
 * different things, and both are written to be shown to a person as they are
 * (`HB10`: each names its remedy).
 */

import { z } from 'zod';

import { notesSearch, type NotesQuery } from '@/lib/app/slots/notes-query';
import type { NotesView } from '@/lib/app/slots/notes-view';

/** Her notes: `GET` reads them, `POST { slotSlug, value }` corrects one. */
export const NOTES_ENDPOINT = '/api/v1/app/notes';

/** Where a person reads them. The nav item and the page both name it here. */
export const NOTES_PAGE = '/app/notes';

/** The route answered, and the answer was no. `message` is written to be shown. */
export class NotesRefused extends Error {
  readonly status: number;
  /** `details.reason` where the route gave one, else the envelope's `error.code`. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NotesRefused';
    this.status = status;
    this.code = code;
  }
}

const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const reasonSchema = z.object({ reason: z.string() });

async function refusalOf(response: Response): Promise<NotesRefused> {
  let code = `http_${response.status}`;
  let message = response.statusText;
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) {
      const reason = reasonSchema.safeParse(parsed.data.error.details);
      code = reason.success ? reason.data.reason : parsed.data.error.code;
      message = parsed.data.error.message;
    }
  } catch {
    // Not JSON — the status is all we know.
  }
  return new NotesRefused(response.status, code, message);
}

const historySchema = z.object({
  version: z.number(),
  value: z.string(),
  withheld: z.boolean(),
  sourceType: z.string(),
  confidence: z.number(),
  capturedAt: z.string(),
});

const noteSchema = z.object({
  slotSlug: z.string(),
  asking: z.string().nullable(),
  value: z.string(),
  withheld: z.boolean(),
  confidence: z.number(),
  sourceType: z.string(),
  // `null` on an Art. 9 note, where the server withholds it (t-80).
  reasoningNote: z.string().nullable(),
  version: z.number(),
  capturedAt: z.string(),
  conversationId: z.string().nullable(),
  sensitivity: z.string(),
  retired: z.boolean(),
  correctable: z.boolean(),
  previous: historySchema.nullable(),
  group: z.string().nullable(),
});

const notesEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    notes: z.array(noteSchema),
    groups: z.array(z.object({ key: z.string(), title: z.string(), count: z.number() })),
    own: z.number(),
    total: z.number(),
    matched: z.number(),
  }),
});

interface Options {
  signal?: AbortSignal;
  /** The search, the group and the sort. Defaults are left out of the URL. */
  query?: NotesQuery;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * The page as asked for, in one read.
 *
 * Validated as a unit rather than per note, unlike the transcript: there, a row
 * the client cannot read costs that row and the conversation survives. Here a
 * shape this cannot parse means the contract moved, and showing a partial
 * picture of what she holds — on the one surface whose promise is that it is
 * the whole picture — is worse than saying it could not be read.
 */
export async function fetchNotes(options: Options = {}): Promise<NotesView> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const query = options.query ?? {};
  const search = notesSearch({ q: query.q, group: query.group, sort: query.sort });
  const response = await fetchImpl(`${NOTES_ENDPOINT}${search}`, {
    credentials: 'include',
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await refusalOf(response);
  const parsed = notesEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new NotesRefused(response.status, 'malformed', 'Her notes could not be read.');
  }
  return parsed.data.data;
}

const correctedEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ slotSlug: z.string(), version: z.number() }),
});

/**
 * Your words, as a new version. Throws {@link NotesRefused} with a message
 * meant to be printed when the route says no.
 */
export async function correctNote(
  correction: { slotSlug: string; value: string },
  options: Options = {}
): Promise<{ slotSlug: string; version: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(NOTES_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(correction),
  });
  if (!response.ok) throw await refusalOf(response);
  const parsed = correctedEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new NotesRefused(response.status, 'malformed', 'The correction could not be confirmed.');
  }
  return parsed.data.data;
}
