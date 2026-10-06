/**
 * A person's sessions — opened on arrival, closed lazily, read back with their
 * windows (f-recap t-141).
 *
 * ## Where they live: Daybreak's event stream, not a table of ours
 *
 * Owner ruling, 6 Oct 2026: a session is a `session.started` row in
 * `framework_journey_event`, closed by a `session.closed` row, both with
 * `journeyId` null. The stream's schema names `session.started` as one of its
 * non-journey engagement events, keys every row on `userId` with a cascading
 * FK, and Daybreak's export already returns it — so erasure and subject access
 * need nothing of ours. An `app_session` table was rejected as a parallel store
 * beside the stream Daybreak meant for this.
 *
 * **Daybreak has no writer for these events** (`recordModuleEngagement` is
 * module-only, and journey creation dropped `session.started`). So this file
 * writes the rows itself, shaped as the writer Daybreak would offer: open or
 * resume, read current and previous, close lazily. It is a stand-in, ledgered
 * in `.context/app/divergences.md`, and goes when Daybreak ships the writer.
 *
 * ## Two arrivals at once open one session: the primary key is the guard
 *
 * A session's row id is derived from the person and its ordinal
 * ({@link sessionEventId}), and so is its close row's. Two tabs arriving
 * together both read the same stale (or absent) session, both decide to open
 * session *n*, and both try to insert the same id: Postgres lets one commit and
 * fails the other with `P2002`. The loser reads the winner's row. The close and
 * the open are written in one transaction, so a loser writes neither; the
 * close skips a duplicate rather than failing, so the open is the one guard. Same
 * shape as the turn claim (`lib/app/agent/turn-record.ts`), not a
 * read-then-write behind a hope.
 *
 * ## Closed lazily
 *
 * Nothing runs on a timer. The next arrival after the gap writes the close,
 * stamped at the sitting's last activity — the latest turn's `completedAt`, or
 * the sitting's own start when it had none (`boundary.ts`).
 *
 * ## Both seats, one sitting
 *
 * A sitting is the person's, not the seat's: onboarding and the facilitator
 * share it, and the latest turn on either seat holds it open.
 *
 * @see lib/app/sessions/boundary.ts — the rule
 * @see .context/app/agent.md — "Sessions"
 */

import { z } from 'zod';

import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { logger } from '@/lib/logging';
import { isRecord } from '@/lib/utils';
import { decideSession } from '@/lib/app/sessions/boundary';

/** The event types, as written to `framework_journey_event.type`. */
export const SESSION_EVENT_TYPE = {
  started: 'session.started',
  closed: 'session.closed',
} as const;

/** One sitting, and its window. */
export interface Session {
  /** The `session.started` row's id — what a turn is stamped with. */
  id: string;
  /** 1 for the person's first session, counting up. */
  ordinal: number;
  startedAt: Date;
  /** When it went quiet. Null while it is the current session. */
  closedAt: Date | null;
}

/** What an arrival found. */
export interface Arrival {
  session: Session;
  /** Whether this arrival began the session — true once per sitting, for whoever won. */
  opened: boolean;
}

/** Both kinds of row carry their session's ordinal; a close also names its session. */
const ordinalPayloadSchema = z.object({ ordinal: z.number().int().positive() });

/**
 * The id of a session's started or closed row: a digest of the person, the
 * ordinal and the kind, so two writers deciding to open the same session write
 * the same id. Hashed so the row id does not spell out the user id; it is not
 * a secret, and anyone holding a user id can recompute it. Nothing takes a
 * session id as input, so nothing needs it to be one.
 */
export async function sessionEventId(
  userId: string,
  ordinal: number,
  kind: keyof typeof SESSION_EVENT_TYPE
): Promise<string> {
  // Web Crypto rather than `node:crypto`: lib/app/** stays realm-neutral.
  const bytes = new TextEncoder().encode(`${userId}\u0000${ordinal}\u0000${kind}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  return `ses_${hex.join('').slice(0, 32)}`;
}

/** P2002: another arrival already wrote this session's row. */
function isUniqueViolation(err: unknown): boolean {
  return isRecord(err) && err.code === 'P2002';
}

interface StartedRow {
  id: string;
  occurredAt: Date;
  payload: unknown;
}

function toSession(row: StartedRow, closedAt: Date | null): Session {
  const parsed = ordinalPayloadSchema.safeParse(row.payload);
  // Only this file writes the row, so an unreadable payload is a corrupt row,
  // and guessing its ordinal could reuse a live session's id.
  if (!parsed.success) throw new Error(`Session row ${row.id} has no readable ordinal`);
  return { id: row.id, ordinal: parsed.data.ordinal, startedAt: row.occurredAt, closedAt };
}

const STARTED_SELECT = { id: true, occurredAt: true, payload: true } as const;

/** The ordinal a close row names. Only this file writes it, so unreadable is corrupt. */
function closeOrdinal(row: { id: string; payload: unknown }): number {
  const parsed = ordinalPayloadSchema.safeParse(row.payload);
  if (!parsed.success) throw new Error(`Session close ${row.id} has no readable ordinal`);
  return parsed.data.ordinal;
}

/** When the person's latest turn, on any seat, finished — or began, while it runs. */
async function readLastTurnAt(userId: string): Promise<Date | null> {
  const turn = await prisma.appTurn.findFirst({
    where: { userId },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true, completedAt: true },
  });
  return turn ? (turn.completedAt ?? turn.startedAt) : null;
}

/**
 * Open the person's session, or resume the one they are in — closing the last
 * one first when it went quiet.
 *
 * Called before anything that counts as activity is written: an arrival at
 * the pane, and a turn's claim before its row exists. A turn row written first
 * would be its own last activity, and no sitting would ever end.
 */
export async function arriveSession(userId: string, now: Date = new Date()): Promise<Arrival> {
  const [latestRow, latestCloseRow, lastTurnAt] = await Promise.all([
    prisma.journeyEvent.findFirst({
      where: { userId, type: SESSION_EVENT_TYPE.started },
      orderBy: { occurredAt: 'desc' },
      select: STARTED_SELECT,
    }),
    prisma.journeyEvent.findFirst({
      where: { userId, type: SESSION_EVENT_TYPE.closed },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, payload: true },
    }),
    readLastTurnAt(userId),
  ]);
  const latest = latestRow ? toSession(latestRow, null) : null;
  const closedOrdinal = latestCloseRow ? closeOrdinal(latestCloseRow) : 0;

  // The latest session is already closed only when a later one was removed
  // (f-forget-session): sessions are closed by the arrival that opens the
  // next. Then open afresh, closing nothing, numbered past every session a
  // row still names, so no surviving row's id is reused. A removed CURRENT
  // session leaves no row naming it, so its ordinal can come round again:
  // f-forget-session must tombstone it if anything outlives it by its id.
  const decision =
    latest && closedOrdinal >= latest.ordinal
      ? ({ kind: 'open' } as const)
      : decideSession(latest, lastTurnAt, now);
  if (decision.kind === 'resume' && latest) return { session: latest, opened: false };

  const ordinal = Math.max(latest?.ordinal ?? 0, closedOrdinal) + 1;
  const id = await sessionEventId(userId, ordinal, 'started');
  const closeId =
    decision.kind === 'roll' && latest
      ? await sessionEventId(userId, latest.ordinal, 'closed')
      : null;
  try {
    await executeTransaction(async (tx) => {
      if (decision.kind === 'roll' && latest && closeId) {
        // A duplicate close is skipped rather than failing the transaction:
        // the started row below is the one guard, and the loser of a race
        // learns it there.
        await tx.journeyEvent.createMany({
          data: [
            {
              id: closeId,
              userId,
              type: SESSION_EVENT_TYPE.closed,
              occurredAt: decision.closeAt,
              payload: { sessionId: latest.id, ordinal: latest.ordinal },
            },
          ],
          skipDuplicates: true,
        });
      }
      await tx.journeyEvent.create({
        data: {
          id,
          userId,
          type: SESSION_EVENT_TYPE.started,
          occurredAt: now,
          payload: { ordinal },
        },
      });
    });
    return { session: { id, ordinal, startedAt: now, closedAt: null }, opened: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  // Another arrival opened this session first. Its row is the session.
  const winner = await prisma.journeyEvent.findUnique({ where: { id }, select: STARTED_SELECT });
  // Unreachable unless the row went between the insert and this read — an
  // erasure of this very person mid-request.
  if (!winner) throw new Error('Session lost its row between insert and read');
  return { session: toSession(winner, null), opened: false };
}

/**
 * {@link arriveSession}, never throwing: the session's id, or null when it
 * could not be written. For the paths that must not fail because of it — the
 * pane's read and a turn's claim. A turn stamped null is a turn with no
 * recorded sitting, which is what a turn from before sessions already is.
 */
export async function arriveSessionQuietly(
  userId: string,
  now: Date = new Date()
): Promise<Arrival | null> {
  try {
    return await arriveSession(userId, now);
  } catch (err) {
    logger.error('Session arrival failed', err instanceof Error ? err : new Error(String(err)), {
      userId,
    });
    return null;
  }
}

/**
 * The person's current session and the one before it, with their windows.
 *
 * "Current" is the latest session to start. It is closed only by the next
 * arrival, so read after arriving (as the pane's read does) it is the sitting
 * the person is in; read cold, it may be one that has already gone quiet.
 */
export async function readSessions(
  userId: string
): Promise<{ current: Session | null; previous: Session | null }> {
  const rows = await prisma.journeyEvent.findMany({
    where: { userId, type: SESSION_EVENT_TYPE.started },
    orderBy: { occurredAt: 'desc' },
    take: 2,
    select: STARTED_SELECT,
  });
  const sessions = rows.map((row) => toSession(row, null));
  if (sessions.length === 0) return { current: null, previous: null };

  const closeIds = await Promise.all(
    sessions.map((session) => sessionEventId(userId, session.ordinal, 'closed'))
  );
  const closes = await prisma.journeyEvent.findMany({
    where: { userId, type: SESSION_EVENT_TYPE.closed, id: { in: closeIds } },
    select: { id: true, occurredAt: true },
  });
  const closedAt = (index: number): Date | null =>
    closes.find((close) => close.id === closeIds[index])?.occurredAt ?? null;

  return {
    current: { ...sessions[0], closedAt: closedAt(0) },
    previous: sessions[1] ? { ...sessions[1], closedAt: closedAt(1) } : null,
  };
}

/**
 * Named sessions of one person's, with their windows, keyed by id
 * (f-journey-record t-145): what each synopsis in the record is about.
 *
 * Read by id rather than by listing every session, because the record names
 * the sessions it needs. An id that is not one of this person's started rows
 * is simply absent from the map: the `userId` filter is what keeps one
 * person's session ids from resolving another's.
 */
export async function readSessionsById(
  userId: string,
  ids: readonly string[]
): Promise<Map<string, Session>> {
  const found = new Map<string, Session>();
  if (ids.length === 0) return found;

  const rows = await prisma.journeyEvent.findMany({
    where: { userId, type: SESSION_EVENT_TYPE.started, id: { in: [...ids] } },
    select: STARTED_SELECT,
  });
  const sessions = rows.map((row) => toSession(row, null));
  const closeIds = await Promise.all(
    sessions.map((session) => sessionEventId(userId, session.ordinal, 'closed'))
  );
  const closes =
    closeIds.length === 0
      ? []
      : await prisma.journeyEvent.findMany({
          where: { userId, type: SESSION_EVENT_TYPE.closed, id: { in: closeIds } },
          select: { id: true, occurredAt: true },
        });
  const closedAtById = new Map(closes.map((close) => [close.id, close.occurredAt]));

  sessions.forEach((session, index) => {
    found.set(session.id, { ...session, closedAt: closedAtById.get(closeIds[index]) ?? null });
  });
  return found;
}
