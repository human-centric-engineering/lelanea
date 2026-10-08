/**
 * The current session, as the conversation pane's offer reads it
 * (f-forget-session t-158).
 *
 * The turn read runs against a small fake of `appTurn.findFirst` that applies
 * the `where` the code passes, rather than a canned answer: what is proven is
 * which turns count as the person's, so a query that dropped the agent-opened
 * exclusion would offer to delete a sitting holding only the AI's recap.
 *
 * @see lib/app/sessions/current.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface TurnRow {
  id: string;
  userId: string;
  sessionId: string | null;
  turnId: string;
}

interface StartsWith {
  turnId: { startsWith: string };
}

interface TurnWhere {
  userId: string;
  sessionId: string;
  NOT: StartsWith[];
}

const { db, arrive } = vi.hoisted(() => ({
  db: { turns: [] as TurnRow[] },
  arrive: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appTurn: {
      findFirst: vi.fn(async ({ where }: { where: TurnWhere }) => {
        const found = db.turns.find(
          (row) =>
            row.userId === where.userId &&
            row.sessionId === where.sessionId &&
            !where.NOT.some((not) => row.turnId.startsWith(not.turnId.startsWith))
        );
        return found ? { id: found.id } : null;
      }),
    },
  },
}));
vi.mock('@/lib/app/sessions/store', () => ({ arriveSessionQuietly: arrive }));

import { readCurrentSession } from '@/lib/app/sessions/current';
import { recapTurnId, OPENING_TURN_ID } from '@/lib/app/conversation/opening-id';

const ME = 'user-me';
const THEM = 'user-them';
const NOW = `ses_${'a'.repeat(32)}`;
const BEFORE = `ses_${'b'.repeat(32)}`;

function arriveAt(sessionId: string) {
  arrive.mockResolvedValue({
    session: { id: sessionId, ordinal: 2, startedAt: new Date(), closedAt: null },
    opened: false,
  });
}

let seq = 0;
function turn(userId: string, sessionId: string | null, turnId = `t-${++seq}`): void {
  db.turns.push({ id: `row-${++seq}`, userId, sessionId, turnId });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.turns = [];
  arriveAt(NOW);
});

describe('readCurrentSession', () => {
  it('names the session the arrival found, with turns when the person spoke in it', async () => {
    turn(ME, NOW);

    await expect(readCurrentSession(ME)).resolves.toEqual({ id: NOW, hasTurns: true });
    expect(arrive).toHaveBeenCalledWith(ME, undefined, {});
  });

  it('passes the host’s keepAlive to the arrival, so a close it writes can draft', async () => {
    const keepAlive = vi.fn();
    await readCurrentSession(ME, { keepAlive });

    expect(arrive).toHaveBeenCalledWith(ME, undefined, { keepAlive });
  });

  it('has no turns when only the AI has spoken in it: its recap and the welcome', async () => {
    turn(ME, NOW, recapTurnId(NOW));
    turn(ME, NOW, OPENING_TURN_ID);

    await expect(readCurrentSession(ME)).resolves.toEqual({ id: NOW, hasTurns: false });
  });

  it('counts only this session’s turns, and only the caller’s', async () => {
    turn(ME, BEFORE);
    turn(ME, null);
    turn(THEM, NOW);

    await expect(readCurrentSession(ME)).resolves.toEqual({ id: NOW, hasTurns: false });
  });

  it('is null when the session could not be arrived at, and reads no turns', async () => {
    arrive.mockResolvedValue(null);
    turn(ME, NOW);

    await expect(readCurrentSession(ME)).resolves.toBeNull();
    const { prisma } = await import('@/lib/db/client');
    expect(prisma.appTurn.findFirst).not.toHaveBeenCalled();
  });
});
