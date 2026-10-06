/**
 * A person's sessions, written to Daybreak's event stream (f-recap t-141).
 *
 * Runs the real `store.ts` (and, for the stamping cases, the real
 * `claimTurn`) against a small STATEFUL in-memory fake of the two tables they
 * touch. The properties worth proving are about state across requests — a
 * reload finds the session the first arrival wrote, a second tab loses the
 * race to the first — and a canned mock can only echo what it was told.
 *
 * The fake enforces the primary key the way Postgres does: an insert of an id
 * already committed, or held by another open transaction, fails with Prisma's
 * own `P2002`, and a failed transaction writes none of its rows. That key IS
 * the concurrency guard.
 *
 * ## Reverting the guard fails this file (`fp6`)
 *
 * Give the started row a fresh random id and "two tabs arriving together"
 * writes two `session.started` rows; the case counts them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

interface EventRow {
  id: string;
  userId: string;
  journeyId: string | null;
  type: string;
  payload: unknown;
  occurredAt: Date;
}
interface TurnRow {
  id: string;
  userId: string;
  turnId: string;
  requestHash: string;
  seat: string;
  status: 'running' | 'completed' | 'failed';
  attempts: number;
  sessionId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  [key: string]: unknown;
}

const db = vi.hoisted(() => ({
  events: [] as EventRow[],
  turns: [] as TurnRow[],
  /** Ids an open transaction has inserted but not yet committed, each settling when it ends. */
  held: new Map<string, Promise<void>>(),
  seq: 0,
  /** When set, every session read waits here — so concurrent arrivals all read before any writes. */
  readGate: null as Promise<void> | null,
}));

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The draft a close queues (f-journey-record t-146) runs off the request path;
// here it is a spy, so these cases see what was queued and nothing more.
const { queueSynopsisDraft } = vi.hoisted(() => ({
  queueSynopsisDraft: vi.fn(async (_userId: string, _closed: { id: string }) => undefined),
}));
vi.mock('@/lib/app/journey-record/synopsis/draft', () => ({ queueSynopsisDraft }));

vi.mock('@/lib/db/client', () => {
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
  const pick = <T extends object>(row: T, select?: Record<string, boolean>): Partial<T> =>
    select
      ? (Object.fromEntries(
          Object.keys(select).map((key) => [key, row[key as keyof T]])
        ) as Partial<T>)
      : { ...row };
  const matches = (row: EventRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id' && value && typeof value === 'object' && 'in' in value) {
        return (value as { in: string[] }).in.includes(row.id);
      }
      return row[key as keyof EventRow] === value;
    });
  const newestFirst = (a: EventRow, b: EventRow) => b.occurredAt.getTime() - a.occurredAt.getTime();

  const journeyEvent = {
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        if (db.readGate) await db.readGate;
        const row = db.events.filter((e) => matches(e, where)).sort(newestFirst)[0];
        return row ? pick(row, select) : null;
      }
    ),
    findMany: vi.fn(
      async ({
        where,
        take,
        select,
      }: {
        where: Record<string, unknown>;
        take?: number;
        select?: Record<string, boolean>;
      }) =>
        db.events
          .filter((e) => matches(e, where))
          .sort(newestFirst)
          .slice(0, take)
          .map((row) => pick(row, select))
    ),
    findUnique: vi.fn(
      async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = db.events.find((e) => e.id === where.id);
        return row ? pick(row, select) : null;
      }
    ),
  };

  const appTurn = {
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { userId: string };
        select?: Record<string, boolean>;
      }) => {
        const row = db.turns
          .filter((t) => t.userId === where.userId)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
        return row ? pick(row, select) : null;
      }
    ),
    create: vi.fn(async ({ data }: { data: Partial<TurnRow> }) => {
      if (db.turns.some((t) => t.userId === data.userId && t.turnId === data.turnId)) throw p2002();
      const row = {
        id: `turn-${++db.seq}`,
        status: 'running',
        attempts: 1,
        sessionId: null,
        completedAt: null,
        startedAt: new Date(),
        ...data,
      } as TurnRow;
      db.turns.push(row);
      return { ...row };
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { userId_turnId: { userId: string; turnId: string } } }) => {
        const { userId, turnId } = where.userId_turnId;
        const row = db.turns.find((t) => t.userId === userId && t.turnId === turnId);
        return row ? { ...row } : null;
      }
    ),
  };

  return { prisma: { journeyEvent, appTurn }, __p2002: p2002 };
});

vi.mock('@/lib/db/utils', async () => {
  const { __p2002 } = (await import('@/lib/db/client')) as unknown as {
    __p2002: () => Error;
  };
  return {
    // A transaction, as Postgres runs one: its inserts land only on commit, and
    // a racer inserting an id it holds WAITS for it to end — then fails if it
    // committed, or goes ahead if it rolled back.
    executeTransaction: vi.fn(async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      const pending: EventRow[] = [];
      let end!: () => void;
      const ended = new Promise<void>((resolve) => (end = resolve));
      const tx = {
        journeyEvent: {
          create: vi.fn(async ({ data }: { data: Partial<EventRow> }) => {
            const id = data.id ?? `evt-${++db.seq}`;
            const holder = db.held.get(id);
            if (holder) await holder;
            if (db.events.some((e) => e.id === id)) throw __p2002();
            db.held.set(id, ended);
            const row: EventRow = {
              journeyId: null,
              payload: null,
              occurredAt: new Date(),
              ...data,
              id,
            } as EventRow;
            pending.push(row);
            // Yield, as a round trip would, so racers interleave.
            await Promise.resolve();
            return { ...row };
          }),
          // `skipDuplicates`: ON CONFLICT DO NOTHING. It waits on a holder the
          // same way, then skips a row whose id is already committed.
          createMany: vi.fn(
            async ({
              data,
              skipDuplicates,
            }: {
              data: Partial<EventRow>[];
              skipDuplicates?: boolean;
            }) => {
              let count = 0;
              for (const item of data) {
                const id = item.id ?? `evt-${++db.seq}`;
                const holder = db.held.get(id);
                if (holder) await holder;
                if (db.events.some((e) => e.id === id) || pending.some((e) => e.id === id)) {
                  if (skipDuplicates) continue;
                  throw __p2002();
                }
                db.held.set(id, ended);
                pending.push({
                  journeyId: null,
                  payload: null,
                  occurredAt: new Date(),
                  ...item,
                  id,
                } as EventRow);
                count++;
              }
              await Promise.resolve();
              return { count };
            }
          ),
        },
      };
      try {
        const result = await callback(tx);
        db.events.push(...pending);
        return result;
      } finally {
        pending.forEach((row) => db.held.delete(row.id));
        end();
      }
    }),
  };
});

import {
  arriveSession,
  arriveSessionQuietly,
  readSessions,
  SESSION_EVENT_TYPE,
} from '@/lib/app/sessions/store';
import { claimTurn } from '@/lib/app/agent/turn-record';
import { prisma } from '@/lib/db/client';

const ANA = 'user-ana';
const BEN = 'user-ben';
const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-10-01T09:00:00.000Z');
const at = (hours: number, ms = 0): Date => new Date(T0.getTime() + hours * HOUR + ms);

const started = (userId?: string) =>
  db.events.filter(
    (e) => e.type === SESSION_EVENT_TYPE.started && (userId === undefined || e.userId === userId)
  );
const closed = (userId?: string) =>
  db.events.filter(
    (e) => e.type === SESSION_EVENT_TYPE.closed && (userId === undefined || e.userId === userId)
  );

/** How many reads of the latest started session have been made. */
const startedReads = () =>
  vi
    .mocked(prisma.journeyEvent.findFirst)
    .mock.calls.filter(([args]) => args?.where?.type === SESSION_EVENT_TYPE.started).length;

/** A finished turn, as the turn seam would leave it. */
function turnDone(userId: string, startedAt: Date, completedAt: Date, sessionId: string | null) {
  db.turns.push({
    id: `turn-${++db.seq}`,
    userId,
    turnId: `t-${db.seq}`,
    requestHash: 'h',
    seat: 'facilitator',
    status: 'completed',
    attempts: 1,
    sessionId,
    startedAt,
    completedAt,
  });
}

/** Claim a turn through the real claim, arriving first as the turn seam does. */
async function takeTurn(userId: string, now: Date, seat = 'facilitator') {
  const arrival = await arriveSession(userId, now);
  const claim = await claimTurn(
    {
      userId,
      turnId: `turn-${userId}-${now.getTime()}`,
      clientSupplied: true,
      seat,
      agentSlug: 'her',
      requestHash: `hash-${now.getTime()}`,
    },
    { fingerprintVersion: null, register: null, leanings: null, sessionId: arrival.session.id },
    60_000,
    now
  );
  // Settled a minute later, as a short turn would be.
  const row = db.turns.find((t) => t.id === claim.turn.id)!;
  row.status = 'completed';
  row.completedAt = new Date(now.getTime() + 60_000);
  return { arrival, turn: row };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.events = [];
  db.turns = [];
  db.held.clear();
  db.seq = 0;
  db.readGate = null;
});

describe('arriveSession', () => {
  it('opens the first-ever session without closing a phantom one', async () => {
    // Turns from before sessions existed: history, not a sitting to close.
    turnDone(ANA, at(-100), at(-100, 60_000), null);

    const arrival = await arriveSession(ANA, at(0));

    expect(arrival.opened).toBe(true);
    expect(arrival.session).toMatchObject({ ordinal: 1, startedAt: at(0), closedAt: null });
    expect(started(ANA)).toHaveLength(1);
    expect(started(ANA)[0]).toMatchObject({
      id: arrival.session.id,
      journeyId: null,
      occurredAt: at(0),
      payload: { ordinal: 1 },
    });
    expect(closed(ANA)).toHaveLength(0);
  });

  it('writes nothing on a reload inside the sitting', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(1, 60_000), first.session.id);
    const before = db.events.length;
    expect(before).toBe(1);

    const reload = await arriveSession(ANA, at(5));
    const lateReload = await arriveSession(ANA, at(13, -1));

    expect(db.events).toHaveLength(before);
    expect(reload).toEqual({ session: first.session, opened: false });
    expect(lateReload.session.id).toBe(first.session.id);
  });

  it('closes a stale session at its last turn’s completion, then opens the next', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(1, 90_000), first.session.id);

    const next = await arriveSession(ANA, at(24 * 7));

    expect(next.opened).toBe(true);
    expect(next.session).toMatchObject({ ordinal: 2, startedAt: at(24 * 7) });
    expect(next.session.id).not.toBe(first.session.id);
    expect(closed(ANA)).toHaveLength(1);
    expect(closed(ANA)[0]).toMatchObject({
      occurredAt: at(1, 90_000),
      journeyId: null,
      payload: { sessionId: first.session.id, ordinal: 1 },
    });
  });

  it('rolls at exactly twelve hours after the last turn, and not a millisecond before', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(2), first.session.id);

    expect((await arriveSession(ANA, at(14, -1))).opened).toBe(false);
    expect(started(ANA)).toHaveLength(1);

    const rolled = await arriveSession(ANA, at(14));
    expect(rolled.opened).toBe(true);
    expect(started(ANA)).toHaveLength(2);
    expect(closed(ANA)[0].occurredAt).toEqual(at(2));
  });

  it('closes a sitting with no turns at its own start', async () => {
    await arriveSession(ANA, at(0));
    await arriveSession(ANA, at(12));
    expect(closed(ANA)).toHaveLength(1);
    expect(closed(ANA)[0].occurredAt).toEqual(at(0));
  });

  it('keeps arriving when the latest session was removed, its predecessor already closed', async () => {
    // Sessions 1 and 2, then session 2's row removed, as forgetting a session
    // would. Session 1 is the latest left, and it is already closed.
    const one = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(2), one.session.id);
    const two = await arriveSession(ANA, at(30));
    db.events = db.events.filter((e) => e.id !== two.session.id);
    expect(closed(ANA)).toHaveLength(1);

    const next = await arriveSession(ANA, at(60));

    expect(next.opened).toBe(true);
    expect(next.session.ordinal).toBe(2);
    // The existing close is kept as written, not duplicated or moved.
    expect(closed(ANA)).toHaveLength(1);
    expect(closed(ANA)[0].occurredAt).toEqual(at(2));
    expect((await arriveSession(ANA, at(61))).session.id).toBe(next.session.id);
  });

  it('never resumes a session already closed, even inside the twelve hours', async () => {
    // Session 1 closed by session 2's opening; session 2 then removed, while
    // a turn from it (now unstamped) is recent.
    const one = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(2), one.session.id);
    const two = await arriveSession(ANA, at(30));
    turnDone(ANA, at(31), at(32), null);
    db.events = db.events.filter((e) => e.id !== two.session.id);

    const next = await arriveSession(ANA, at(33));

    expect(next.opened).toBe(true);
    expect(next.session.id).not.toBe(one.session.id);
    expect(closed(ANA)).toHaveLength(1);
  });

  it('numbers past a removed session whose close is still there', async () => {
    // Sessions 1, 2 and 3; then 2 and 3's started rows removed, 2's close kept.
    await arriveSession(ANA, at(0));
    const two = await arriveSession(ANA, at(30));
    const three = await arriveSession(ANA, at(60));
    db.events = db.events.filter((e) => e.id !== two.session.id && e.id !== three.session.id);
    expect(closed(ANA).map((e) => (e.payload as { ordinal: number }).ordinal)).toEqual([1, 2]);

    const next = await arriveSession(ANA, at(90));

    // Not 2 again, whose close would make it read as closed before it began.
    expect(next.session.ordinal).toBe(3);
    expect((await readSessions(ANA)).current).toMatchObject({
      id: next.session.id,
      closedAt: null,
    });
  });

  it('treats the two seats as one sitting', async () => {
    const first = await takeTurn(ANA, at(0), 'onboarding');
    const second = await takeTurn(ANA, at(6), 'facilitator');
    expect(second.arrival.opened).toBe(false);
    expect(second.turn.sessionId).toBe(first.turn.sessionId);
  });

  it('opens one session when two tabs arrive together for the first time', async () => {
    let release!: () => void;
    db.readGate = new Promise((resolve) => (release = resolve));
    const both = Promise.all([arriveSession(ANA, at(0)), arriveSession(ANA, at(0))]);
    // Both have asked for the latest session before either writes.
    await vi.waitFor(() => expect(startedReads()).toBe(2));
    release();
    const [a, b] = await both;

    expect(started(ANA)).toHaveLength(1);
    expect(a.session.id).toBe(b.session.id);
    expect([a.opened, b.opened].sort()).toEqual([false, true]);
  });

  it('opens one session, and closes the last one once, when two tabs arrive after the gap', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(1, 60_000), first.session.id);

    let release!: () => void;
    db.readGate = new Promise((resolve) => (release = resolve));
    const both = Promise.all([
      arriveSession(ANA, at(48)),
      arriveSession(ANA, at(48, 5)),
      arriveSession(ANA, at(48, 9)),
    ]);
    await vi.waitFor(() => expect(startedReads()).toBe(4));
    release();
    const arrivals = await both;

    expect(started(ANA)).toHaveLength(2);
    expect(closed(ANA)).toHaveLength(1);
    expect(new Set(arrivals.map((a) => a.session.id)).size).toBe(1);
    expect(arrivals.filter((a) => a.opened)).toHaveLength(1);
  });

  it('keeps each person’s sessions apart', async () => {
    const ana = await arriveSession(ANA, at(0));
    const ben = await arriveSession(BEN, at(0));
    // Same ordinal, same instant: still two sessions, one each.
    expect(ana.session.ordinal).toBe(1);
    expect(ben.session.ordinal).toBe(1);
    expect(ana.session.id).not.toBe(ben.session.id);
    expect(started(ANA)).toHaveLength(1);
    expect(started(BEN)).toHaveLength(1);
  });

  it('queues the closed session’s synopsis once it has closed, and only then', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(1, 90_000), first.session.id);
    await arriveSession(ANA, at(5));
    // Opening the first session and resuming it close nothing, so queue nothing.
    expect(queueSynopsisDraft).not.toHaveBeenCalled();

    const keepAlive = vi.fn();
    await arriveSession(ANA, at(24), { keepAlive });

    // Loaded when the close happens, so the queue lands a tick later.
    await vi.waitFor(() => expect(queueSynopsisDraft).toHaveBeenCalledTimes(1));
    expect(queueSynopsisDraft).toHaveBeenCalledWith(ANA, {
      ...first.session,
      closedAt: at(1, 90_000),
    });
    // The work is handed to the host, so a serverless function outlives it.
    expect(keepAlive).toHaveBeenCalledTimes(1);
    expect(keepAlive.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it('still queues the draft when the host refuses to keep it alive', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(2), first.session.id);
    const keepAlive = vi.fn(() => {
      throw new Error('after() was called outside a request scope');
    });

    const next = await arriveSession(ANA, at(30), { keepAlive });

    expect(next.opened).toBe(true);
    await vi.waitFor(() => expect(queueSynopsisDraft).toHaveBeenCalledTimes(1));
  });

  it('queues one synopsis when two tabs close the same session together', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(1, 60_000), first.session.id);

    let release!: () => void;
    db.readGate = new Promise((resolve) => (release = resolve));
    const both = Promise.all([arriveSession(ANA, at(48)), arriveSession(ANA, at(48, 5))]);
    await vi.waitFor(() => expect(startedReads()).toBe(3));
    release();
    await both;

    expect(closed(ANA)).toHaveLength(1);
    await vi.waitFor(() => expect(queueSynopsisDraft).toHaveBeenCalled());
    // Settle anything a second arrival might have queued before counting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queueSynopsisDraft).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueSynopsisDraft).mock.calls[0][1].id).toBe(first.session.id);
  });

  it('queues nothing when the close and the open fail to write', async () => {
    const first = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(2), first.session.id);
    const { executeTransaction } = await import('@/lib/db/utils');
    vi.mocked(executeTransaction).mockRejectedValueOnce(new Error('connection lost'));

    await expect(arriveSession(ANA, at(30))).rejects.toThrow('connection lost');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queueSynopsisDraft).not.toHaveBeenCalled();
  });

  it('lets an error that is not the race through, and the quiet form logs it and answers null', async () => {
    vi.mocked(prisma.journeyEvent.findFirst).mockRejectedValueOnce(new Error('connection lost'));
    await expect(arriveSession(ANA, at(0))).rejects.toThrow('connection lost');

    vi.mocked(prisma.journeyEvent.findFirst).mockRejectedValueOnce(new Error('connection lost'));
    expect(await arriveSessionQuietly(ANA, at(0))).toBeNull();
    expect(error).toHaveBeenCalledWith('Session arrival failed', expect.any(Error), {
      userId: ANA,
    });
  });
});

describe('readSessions', () => {
  it('is empty for someone who has never arrived', async () => {
    expect(await readSessions(ANA)).toEqual({ current: null, previous: null });
  });

  it('answers the current session and the one before, with their windows', async () => {
    const one = await arriveSession(ANA, at(0));
    turnDone(ANA, at(1), at(2), one.session.id);
    const two = await arriveSession(ANA, at(30));
    turnDone(ANA, at(31), at(32), two.session.id);
    const three = await arriveSession(ANA, at(60));
    // Someone else's sessions are never in the answer.
    await arriveSession(BEN, at(61));

    const sessions = await readSessions(ANA);

    expect(sessions.current).toEqual({ ...three.session, closedAt: null });
    expect(sessions.previous).toEqual({
      id: two.session.id,
      ordinal: 2,
      startedAt: at(30),
      closedAt: at(32),
    });
  });
});

describe('a turn is stamped with the session it fell in', () => {
  it('across two people and two sessions each', async () => {
    const taken = [
      await takeTurn(ANA, at(0)),
      await takeTurn(BEN, at(0, 30_000)),
      await takeTurn(ANA, at(3)),
      await takeTurn(BEN, at(4)),
      // A week later, both come back.
      await takeTurn(ANA, at(24 * 7)),
      await takeTurn(BEN, at(24 * 7 + 1)),
      await takeTurn(ANA, at(24 * 7 + 2)),
    ];
    // The population is what it claims to be: four sessions, seven stamped turns.
    expect(started()).toHaveLength(4);
    expect(db.turns).toHaveLength(7);
    expect(db.turns.every((t) => t.sessionId !== null)).toBe(true);

    for (const { turn } of taken) {
      const session = db.events.find((e) => e.id === turn.sessionId)!;
      // Their own session, never the other person's…
      expect(session.userId).toBe(turn.userId);
      // …and the one whose window the turn began in.
      const next = started(turn.userId).find(
        (e) => e.occurredAt.getTime() > session.occurredAt.getTime()
      );
      expect(turn.startedAt.getTime()).toBeGreaterThanOrEqual(session.occurredAt.getTime());
      if (next) expect(turn.startedAt.getTime()).toBeLessThan(next.occurredAt.getTime());
    }

    const [firstWeek, secondWeek] = [
      new Set(taken.slice(0, 4).map(({ turn }) => turn.sessionId)),
      new Set(taken.slice(4).map(({ turn }) => turn.sessionId)),
    ];
    expect(firstWeek.size).toBe(2);
    expect(secondWeek.size).toBe(2);
    expect([...firstWeek].some((id) => secondWeek.has(id))).toBe(false);
  });
});
