/**
 * Whether she can be talked to right now: the operator's switch, then what the
 * most recent finished turn says (§08 t-55).
 *
 * The read is install-wide and learned from rows, never from the platform's
 * circuit breaker — per-process memory that says nothing to the next request on
 * a serverless host. So the fake here is the two things it reads: a flag, and
 * the latest finished turn inside the window.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface TurnRow {
  status: 'running' | 'completed' | 'failed';
  errorCode: string | null;
  completedAt: Date | null;
}

interface World {
  /** `null`: the flag row does not exist. */
  paused: boolean | null;
  flagReadFails: boolean;
  turns: TurnRow[];
}

const state: World = vi.hoisted(() => ({ paused: false, flagReadFails: false, turns: [] }));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    featureFlag: {
      findUnique: vi.fn(async () => {
        if (state.flagReadFails) throw new Error('connection refused');
        return state.paused === null ? null : { enabled: state.paused };
      }),
    },
    appTurn: {
      // Honours the query's own filter, so a wrong `where` fails a case here.
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            status: { in: string[] };
            completedAt: { gte: Date };
            OR: [{ errorCode: null }, { errorCode: { notIn: string[] } }];
          };
        }) => {
          const excluded = where.OR[1].errorCode.notIn;
          const rows = state.turns
            .filter(
              (turn) =>
                where.status.in.includes(turn.status) &&
                turn.completedAt !== null &&
                turn.completedAt >= where.completedAt.gte &&
                (turn.errorCode === null || !excluded.includes(turn.errorCode))
            )
            .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
          return rows[0] ?? null;
        }
      ),
    },
  },
}));

import {
  GENERATION_PAUSED_FLAG,
  RECENT_OUTCOME_MS,
  getGenerationStatus,
  isGenerationPaused,
} from '@/lib/app/agent/availability';
import { prisma } from '@/lib/db/client';

const NOW = new Date('2026-09-18T12:00:00Z');
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

beforeEach(() => {
  vi.clearAllMocks();
  state.paused = false;
  state.flagReadFails = false;
  state.turns = [];
});

describe('isGenerationPaused', () => {
  it('reads the flag by its stored name', async () => {
    state.paused = true;

    await expect(isGenerationPaused()).resolves.toBe(true);
    expect(prisma.featureFlag.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: GENERATION_PAUSED_FLAG } })
    );
  });

  it('is not paused when the flag was never seeded, or cannot be read', async () => {
    state.paused = null;
    await expect(isGenerationPaused()).resolves.toBe(false);

    state.flagReadFails = true;
    await expect(isGenerationPaused()).resolves.toBe(false);
  });
});

describe('getGenerationStatus', () => {
  it('is paused when the switch is on, whatever the turns say', async () => {
    state.turns = [{ status: 'completed', errorCode: null, completedAt: ago(1_000) }];
    state.paused = true;

    await expect(getGenerationStatus(NOW)).resolves.toBe('paused');
  });

  it('is available when the latest finished turn was answered', async () => {
    state.turns = [
      { status: 'failed', errorCode: 'http_429', completedAt: ago(60_000) },
      { status: 'completed', errorCode: null, completedAt: ago(1_000) },
    ];

    await expect(getGenerationStatus(NOW)).resolves.toBe('available');
  });

  it('is unavailable when the latest finished turn could not be answered', async () => {
    state.turns = [
      { status: 'completed', errorCode: null, completedAt: ago(60_000) },
      { status: 'failed', errorCode: 'http_429', completedAt: ago(1_000) },
    ];
    await expect(getGenerationStatus(NOW)).resolves.toBe('unavailable');

    state.turns.push({ status: 'failed', errorCode: 'timed_out', completedAt: ago(500) });
    await expect(getGenerationStatus(NOW)).resolves.toBe('unavailable');
  });

  it('forgets a failure older than the window', async () => {
    state.turns = [
      { status: 'failed', errorCode: 'http_503', completedAt: ago(RECENT_OUTCOME_MS + 1) },
    ];

    await expect(getGenerationStatus(NOW)).resolves.toBe('available');
  });

  it("does not read a person's own turn trouble as the model being down", async () => {
    state.turns = [
      { status: 'failed', errorCode: 'http_503', completedAt: ago(60_000) },
      { status: 'failed', errorCode: 'input_blocked', completedAt: ago(1_000) },
    ];

    // Behind the blocked message is a real outage — still reported.
    await expect(getGenerationStatus(NOW)).resolves.toBe('unavailable');

    state.turns = [
      { status: 'completed', errorCode: null, completedAt: ago(60_000) },
      { status: 'failed', errorCode: 'reply_not_linked', completedAt: ago(1_000) },
      { status: 'failed', errorCode: 'budget_exceeded_per_turn', completedAt: ago(500) },
    ];
    await expect(getGenerationStatus(NOW)).resolves.toBe('available');
  });

  it('asks for completed turns too — a null code is not excluded by the filter', async () => {
    state.turns = [{ status: 'completed', errorCode: null, completedAt: ago(1_000) }];
    await getGenerationStatus(NOW);

    const where = vi.mocked(prisma.appTurn.findFirst).mock.calls[0][0]?.where;
    expect(where?.OR).toContainEqual({ errorCode: null });
    expect(where?.status).toEqual({ in: ['completed', 'failed'] });
  });
});
