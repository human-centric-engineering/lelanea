/**
 * The browser's side of a turn (§10 t-64, t-65, t-67).
 *
 * Read the transcript back, take a turn on a seat, ask whether a turn can be
 * expected to be answered (the status read, for the banner), and — for the
 * microphone — ask whether a voice note may be sent and send one. The turn
 * goes to Daybreak's role route with the seam's request shape —
 * `{ message, turnId }` — and comes back as SSE frames, each one passed through
 * the leaf's own schema (`events.ts`). The client never handles a conversation
 * id: resume-by-context is the route's, and a member has no other door.
 *
 * ## The turn id is minted here
 *
 * `crypto.randomUUID()`, once per message, and kept with the message until the
 * turn ends. That is what makes "try again" safe (§08 t-54): a failed or
 * timed-out turn re-runs under the id, a completed one replays with no second
 * model call. The retry itself is t-65's; this task makes sure the id exists
 * to retry with.
 *
 * ## A refused request is not a stream
 *
 * The route answers a refusal — `404` no surface, `409` a turn still in flight
 * or an id reused for different words, `429` — as a JSON envelope, not as an
 * SSE frame. `streamTurn` reads the status before touching the body and throws
 * {@link TurnRefused} with the envelope's code, so the caller can tell a
 * refusal from a turn that ran and ended — and, for `TURN_IN_FLIGHT`, keep the
 * id rather than mint another (t-65).
 */

import { z } from 'zod';

import { parseConversationEvent, type ConversationEvent } from '@/lib/app/conversation/events';
import type { Transcript, TranscriptEntry } from '@/lib/app/conversation/transcript';
import { citationSchema } from '@/lib/validations/orchestration';

/** The seam's request shape on Daybreak's role route. */
export function streamRouteFor(seat: string): string {
  return `/api/v1/framework/facilitation/${encodeURIComponent(seat)}/chat/stream`;
}

export function transcriptRouteFor(seat: string): string {
  return `/api/v1/app/conversation?seat=${encodeURIComponent(seat)}`;
}

/** Whether a turn sent now can be expected to be answered (§08 t-55). Install-wide. */
export const STATUS_ROUTE = '/api/v1/app/agent/status';

/** A voice note: GET says whether one may be sent; POST transcribes one (t-67). */
export const TRANSCRIBE_ROUTE = '/api/v1/app/agent/transcribe';

/** One id per message, kept for as long as the message might be sent again. */
export function mintTurnId(): string {
  return crypto.randomUUID();
}

const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    // `details` is whatever the route put there — an object with a `reason`
    // on the seam's refusals, an `errors` array on a validation failure. Read
    // leniently, so an unexpected shape costs the reason, never the code.
    details: z.unknown().optional(),
  }),
});

const reasonSchema = z.object({ reason: z.string() });

/** The route refused the request before any turn ran. */
export class TurnRefused extends Error {
  readonly status: number;
  /** The envelope's `error.code`, or `details.reason` where that is more specific. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TurnRefused';
    this.status = status;
    this.code = code;
  }
}

async function refusalOf(response: Response): Promise<TurnRefused> {
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
  return new TurnRefused(response.status, code, message);
}

export interface TurnRequest {
  seat: string;
  message: string;
  turnId: string;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Take a turn and yield its frames as they arrive. Throws {@link TurnRefused}
 * before the first frame if the route refused the request.
 *
 * Frames the schema does not recognise are skipped, not raised — a new frame
 * type from the platform is not a broken turn.
 */
export async function* streamTurn(request: TurnRequest): AsyncGenerator<ConversationEvent> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const response = await fetchImpl(streamRouteFor(request.seat), {
    method: 'POST',
    credentials: 'include',
    signal: request.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: request.message, turnId: request.turnId }),
  });

  if (!response.ok || !response.body) throw await refusalOf(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = parseConversationEvent(block);
        if (event) yield event;
      }
    }
    // A final block with no trailing separator is still a frame.
    const last = buffer.trim() ? parseConversationEvent(buffer) : null;
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

const transcriptEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    seat: z.string(),
    conversationId: z.string().nullable(),
    entries: z.array(z.unknown()),
  }),
});

/**
 * The transcript, read back. The entries are validated as far as the client
 * needs to trust them; the shape is the server's `Transcript`.
 */
export async function fetchTranscript(
  seat: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<Transcript> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(transcriptRouteFor(seat), {
    credentials: 'include',
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await refusalOf(response);
  const parsed = transcriptEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) throw new TurnRefused(response.status, 'malformed', 'Unreadable transcript');
  return validateEntries(parsed.data.data);
}

const statusEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ generation: z.enum(['available', 'unavailable', 'paused']) }),
});

export type GenerationStatus = z.infer<typeof statusEnvelopeSchema>['data']['generation'];

/**
 * The status read, for the banner: asked on mount and after an ending, never
 * on a timer. A read that fails throws; the caller treats that as no news,
 * not as an outage — the banner is a courtesy, and a turn is still tried.
 */
export async function fetchGenerationStatus(
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<GenerationStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(STATUS_ROUTE, {
    credentials: 'include',
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await refusalOf(response);
  const parsed = statusEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) throw new TurnRefused(response.status, 'malformed', 'Unreadable status');
  return parsed.data.data.generation;
}

const voiceInputEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ voiceInput: z.enum(['available', 'off', 'no_provider']) }),
});

export type VoiceInputState = z.infer<typeof voiceInputEnvelopeSchema>['data']['voiceInput'];

/** Whether the microphone should be offered at all. Asked once, on mount. */
export async function fetchVoiceInput(
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<VoiceInputState> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(TRANSCRIBE_ROUTE, {
    credentials: 'include',
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await refusalOf(response);
  const parsed = voiceInputEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) throw new TurnRefused(response.status, 'malformed', 'Unreadable answer');
  return parsed.data.data.voiceInput;
}

const transcriptEnvelope = z.object({
  success: z.literal(true),
  data: z.object({ text: z.string() }),
});

/**
 * A clip to the transcribe route, as multipart, the way the platform's own
 * mic buttons post it. The words come back; the clip does not stay anywhere.
 */
export async function transcribeClip(
  clip: { blob: Blob; mimeType: string },
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new FormData();
  // Named by MIME, as the platform's own mic button names it: a browser with
  // none of the preferred MIMEs records its default (Firefox: ogg).
  const extension = clip.mimeType.startsWith('audio/mp4')
    ? 'mp4'
    : clip.mimeType.startsWith('audio/webm')
      ? 'webm'
      : clip.mimeType.startsWith('audio/ogg')
        ? 'ogg'
        : 'bin';
  body.set('audio', new File([clip.blob], `voice-note.${extension}`, { type: clip.mimeType }));
  const response = await fetchImpl(TRANSCRIBE_ROUTE, {
    method: 'POST',
    credentials: 'include',
    signal: options.signal,
    body,
  });
  if (!response.ok) throw await refusalOf(response);
  const parsed = transcriptEnvelope.safeParse(await response.json());
  if (!parsed.success) throw new TurnRefused(response.status, 'malformed', 'Unreadable answer');
  return parsed.data.data.text;
}

const accountSchema = z.object({
  turnId: z.string(),
  seat: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  attempts: z.number(),
  modelId: z.string().nullable(),
  providerSlug: z.string().nullable(),
  fingerprintVersion: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  pricing: z.enum(['priced', 'unpriced', 'local']).nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

const entrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    id: z.string(),
    text: z.string(),
    at: z.string(),
    turnId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('reply'),
    id: z.string(),
    text: z.string(),
    at: z.string(),
    turnId: z.string().nullable(),
    citations: z.array(citationSchema),
    // Absent on a body from before t-66 (a mixed-version window): the reply
    // is kept and says it called nothing, rather than being dropped.
    capabilities: z.array(z.string()).default([]),
    turn: accountSchema.nullable(),
  }),
]);

/**
 * Each entry validated on its own, so one row the client cannot read drops
 * that row rather than the whole transcript.
 */
function validateEntries(data: {
  seat: string;
  conversationId: string | null;
  entries: unknown[];
}): Transcript {
  const entries: TranscriptEntry[] = [];
  for (const raw of data.entries) {
    const parsed = entrySchema.safeParse(raw);
    if (parsed.success) entries.push(parsed.data);
  }
  return { seat: data.seat, conversationId: data.conversationId, entries };
}
