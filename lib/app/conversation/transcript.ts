/**
 * The conversation, read back (§10 t-64).
 *
 * What the pane shows on load, and what the disclosure drawer (t-66) reads
 * from: the person's conversation on a seat, as turns — what they said, what
 * she said, and the turn row that says what produced the reply.
 *
 * ## Why this is a leaf read and not Sunrise's
 *
 * `GET /api/v1/chat/conversations/:id/messages` returns `id/role/content/
 * createdAt` and nothing else, and a member has no way to learn the surface
 * conversation's id in the first place. Everything the drawer needs — model,
 * fingerprint version, seat, cost, whether the turn ended — is on `app_turn`
 * (§08 t-54), joined to the message rows by `userMessageId` and
 * `assistantMessageId`. So the read is ours.
 *
 * ## Two corrections the platform cannot make
 *
 * Both recorded on this feature by §08 (`.context/app/agent.md` → "What a
 * second request with the same id gets", "The deadlines"):
 *
 * - **A retried failed turn writes the person's message twice.** The platform
 *   writes it before every model call and offers no way to reuse the first.
 *   Consecutive rows from the same turn id collapse to one — the row the turn
 *   row points at, which is the attempt that ran.
 * - **A timed-out turn leaves the platform's error-marker row** —
 *   `[An error occurred and the response could not be completed.]` with
 *   `metadata.error: true`. That is not her voice; it is dropped, and the turn
 *   row's `errorCode` says what happened instead.
 *
 * ## Which conversation
 *
 * The one the next turn would resume — `resolveFacilitationSurface`, the same
 * door the stream route opens. No surface (the seat unbound, her visibility
 * narrowed, a stage policy) reads as an empty transcript, not an error: the
 * pane still renders, with nothing in it, and a turn would 404 the same way.
 *
 * The message rows are read through the platform's `conversationVisibilityWhere`
 * (the ownerless-surfaces guard), AND-ed with the caller's own id: a transcript
 * is the person's own, so neither the shared arm nor an admin's ownerless arm
 * may widen it.
 *
 * @see .context/app/conversation.md
 */

import { z } from 'zod';

import { prisma } from '@/lib/db/client';
import type { AuthenticatedSession } from '@/lib/auth/guards';
import { conversationVisibilityWhere } from '@/lib/orchestration/access/conversation-access';
import type { Citation } from '@/types/orchestration';
import { citationSchema } from '@/lib/validations/orchestration';
import { resolveFacilitationSurface } from '@/lib/framework/facilitation/agents/surface';
import { FACILITATION_ROLES } from '@/lib/framework/facilitation/agents/roles';
import { SEATED_ROLES } from '@/lib/app/agent/pins';

/** The seat the conversation pane speaks to in release 1. */
export const CONVERSATION_SEAT = FACILITATION_ROLES.facilitator;

/** The seats a member may read a transcript for — the two this leaf seeds. */
export const READABLE_SEATS: readonly string[] = SEATED_ROLES;

/** What a turn row says about the reply above it. Null fields are honest unknowns. */
export interface TurnAccount {
  turnId: string;
  seat: string;
  status: 'running' | 'completed' | 'failed';
  attempts: number;
  modelId: string | null;
  providerSlug: string | null;
  fingerprintVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Null when unpriced — never zero, which would read as free. */
  costUsd: number | null;
  pricing: 'priced' | 'unpriced' | 'local' | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface TranscriptUserEntry {
  kind: 'user';
  id: string;
  text: string;
  at: string;
  /** The turn this message opened, when the seam recorded one. */
  turnId: string | null;
}

export interface TranscriptReplyEntry {
  kind: 'reply';
  /** The terminal assistant row — the one the turn row points at. */
  id: string;
  text: string;
  at: string;
  turnId: string | null;
  citations: Citation[];
  /** The turn row, when there is one; null for rows written before the seam. */
  turn: TurnAccount | null;
}

export type TranscriptEntry = TranscriptUserEntry | TranscriptReplyEntry;

export interface Transcript {
  seat: string;
  /** Null when nothing has been said yet. */
  conversationId: string | null;
  entries: TranscriptEntry[];
}

/** `metadata.app` on the person's row, as the turn seam writes it. */
const appMetadataSchema = z.object({
  app: z.object({ turnId: z.string() }).partial(),
});

/** `metadata.error` on the platform's error-marker assistant row. */
const errorMarkerSchema = z.object({ error: z.literal(true) });

const provenanceSchema = z.object({ citations: z.array(citationSchema) });

interface MessageRow {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  metadata: unknown;
  provenance: unknown;
}

interface TurnRow {
  turnId: string;
  seat: string;
  status: 'running' | 'completed' | 'failed';
  attempts: number;
  modelId: string | null;
  providerSlug: string | null;
  fingerprintVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  pricing: 'priced' | 'unpriced' | 'local' | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
}

function turnIdOf(metadata: unknown): string | null {
  const parsed = appMetadataSchema.safeParse(metadata);
  return parsed.success ? (parsed.data.app.turnId ?? null) : null;
}

function isErrorMarker(metadata: unknown): boolean {
  return errorMarkerSchema.safeParse(metadata).success;
}

function citationsOf(provenance: unknown): Citation[] {
  const parsed = provenanceSchema.safeParse(provenance);
  return parsed.success ? parsed.data.citations : [];
}

function accountOf(turn: TurnRow): TurnAccount {
  return {
    turnId: turn.turnId,
    seat: turn.seat,
    status: turn.status,
    attempts: turn.attempts,
    modelId: turn.modelId,
    providerSlug: turn.providerSlug,
    fingerprintVersion: turn.fingerprintVersion,
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    costUsd: turn.costUsd,
    pricing: turn.pricing,
    errorCode: turn.errorCode,
    startedAt: turn.startedAt.toISOString(),
    completedAt: turn.completedAt?.toISOString() ?? null,
  };
}

/**
 * Message rows + turn rows → the entries the pane renders. Pure, so the two
 * corrections above are testable on fixtures without a database.
 *
 * Assistant rows are grouped: a tool-using turn writes one row per pass and
 * the reply is all of them in order (as `readTurnReply` joins them), so
 * consecutive assistant rows between two of the person's rows become one
 * reply whose id is the last row's — the terminal one the turn row names and
 * the one carrying the citations.
 */
export function assembleTranscript(messages: MessageRow[], turns: TurnRow[]): TranscriptEntry[] {
  const byUserMessage = new Map<string, TurnRow>();
  const byAssistantMessage = new Map<string, TurnRow>();
  for (const turn of turns) {
    if (turn.userMessageId) byUserMessage.set(turn.userMessageId, turn);
    if (turn.assistantMessageId) byAssistantMessage.set(turn.assistantMessageId, turn);
  }

  const entries: TranscriptEntry[] = [];
  let pendingReply: { rows: MessageRow[] } | null = null;

  const flushReply = () => {
    if (!pendingReply || pendingReply.rows.length === 0) return;
    const rows = pendingReply.rows;
    const terminal = rows[rows.length - 1];
    const turn = rows.map((row) => byAssistantMessage.get(row.id)).find((t) => t !== undefined);
    entries.push({
      kind: 'reply',
      id: terminal.id,
      text: rows.map((row) => row.content).join(''),
      at: terminal.createdAt.toISOString(),
      turnId: turn?.turnId ?? null,
      citations: citationsOf(terminal.provenance),
      turn: turn ? accountOf(turn) : null,
    });
    pendingReply = null;
  };

  for (const row of messages) {
    if (row.role === 'assistant') {
      // The platform's own marker for a turn that ended without her. Not her
      // words; the turn row's `errorCode` is the record of what happened.
      if (isErrorMarker(row.metadata)) continue;
      (pendingReply ??= { rows: [] }).rows.push(row);
      continue;
    }
    if (row.role !== 'user') continue;
    flushReply();

    const turnId = turnIdOf(row.metadata);
    const previous = entries[entries.length - 1];
    if (previous?.kind === 'user' && turnId !== null && previous.turnId === turnId) {
      // The same turn, sent again after a failure: one message from the person,
      // whichever attempt the turn row names — that is the one that ran.
      const turn = byUserMessage.get(row.id);
      if (turn) {
        entries[entries.length - 1] = {
          kind: 'user',
          id: row.id,
          text: row.content,
          at: row.createdAt.toISOString(),
          turnId,
        };
      }
      continue;
    }
    entries.push({
      kind: 'user',
      id: row.id,
      text: row.content,
      at: row.createdAt.toISOString(),
      turnId,
    });
  }
  flushReply();
  return entries;
}

/**
 * The signed-in person's transcript on a seat. Empty — not an error — when
 * there is no surface or nothing has been said.
 */
export async function readTranscript(
  session: AuthenticatedSession,
  seat: string
): Promise<Transcript> {
  const userId = session.user.id;
  const surface = await resolveFacilitationSurface(userId, seat);
  if (!surface || !surface.conversationId) {
    return { seat, conversationId: null, entries: [] };
  }
  const conversationId = surface.conversationId;

  const [messages, turns] = await Promise.all([
    prisma.aiMessage.findMany({
      // The conversation was resolved under the caller's id; the join keeps
      // the rows theirs even so — the visibility helper composed with `AND`,
      // as its docblock asks, and narrowed to the owner arm alone.
      where: {
        conversationId,
        conversation: {
          AND: [conversationVisibilityWhere(session, { excludeShared: true }), { userId }],
        },
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        metadata: true,
        provenance: true,
      },
    }),
    prisma.appTurn.findMany({
      where: { userId, conversationId },
      select: {
        turnId: true,
        seat: true,
        status: true,
        attempts: true,
        modelId: true,
        providerSlug: true,
        fingerprintVersion: true,
        inputTokens: true,
        outputTokens: true,
        costUsd: true,
        pricing: true,
        errorCode: true,
        startedAt: true,
        completedAt: true,
        userMessageId: true,
        assistantMessageId: true,
      },
    }),
  ]);

  return { seat, conversationId, entries: assembleTranscript(messages, turns) };
}
