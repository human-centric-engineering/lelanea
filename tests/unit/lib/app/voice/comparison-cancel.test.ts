/**
 * Stopping a voice test.
 *
 * The thing this exists to prevent is a half-stop. A comparison is two platform
 * runs, and cancelling one of them leaves a full column beside a truncated one —
 * which is the shape of a real result, not of an abandoned run, and it does not
 * stop the spend either. So the properties pinned here are that both arms are
 * caught in one call, that a terminal arm is reported rather than treated as a
 * failure, and that another admin's runs are not touched.
 *
 * @see lib/app/voice/comparison.ts — `cancelVoiceComparison`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeRun {
  id: string;
  userId: string;
  status: string;
}

const world = {
  arms: [] as { arm: string; evaluationRunId: string | null }[],
  runs: [] as FakeRun[],
};

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appVoiceComparisonArm: {
      findMany: vi.fn(async () => world.arms),
    },
    aiEvaluationRun: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; userId: string; status: { in: string[] } };
        }) =>
          world.runs.filter(
            (run) =>
              where.id.in.includes(run.id) &&
              run.userId === where.userId &&
              where.status.in.includes(run.status)
          )
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: { in: string[] } }; data: { status: string } }) => {
          for (const run of world.runs) {
            if (where.id.in.includes(run.id)) run.status = data.status;
          }
          return { count: where.id.in.length };
        }
      ),
    },
  },
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { cancelVoiceComparison } from '@/lib/app/voice/comparison';
import { prisma } from '@/lib/db/client';

const ADMIN = 'user-admin';

beforeEach(() => {
  vi.clearAllMocks();
  world.arms = [
    { arm: 'fingerprint', evaluationRunId: 'run-fingerprint' },
    { arm: 'bare', evaluationRunId: 'run-bare' },
  ];
  world.runs = [
    { id: 'run-fingerprint', userId: ADMIN, status: 'running' },
    { id: 'run-bare', userId: ADMIN, status: 'queued' },
  ];
});

describe('cancelVoiceComparison', () => {
  it('stops both arms in one call, queued and running alike', async () => {
    const result = await cancelVoiceComparison('cmp-1', ADMIN);

    expect(result.cancelled.sort()).toEqual(['bare', 'fingerprint']);
    expect(result.alreadyFinished).toEqual([]);
    // Both statuses, because a queued arm that is left alone is picked up by the
    // next maintenance tick and spends the money the stop was meant to save.
    expect(world.runs.every((run) => run.status === 'cancelled')).toBe(true);
  });

  it('reports an arm that already finished instead of failing the whole stop', async () => {
    // The honest race: the button is on a page that polls, so pressing it on the
    // tick the last case lands is ordinary. Refusing the call there would report
    // a failure for a comparison that is simply already over.
    world.runs[0].status = 'completed';

    const result = await cancelVoiceComparison('cmp-1', ADMIN);

    expect(result.cancelled).toEqual(['bare']);
    expect(result.alreadyFinished).toEqual(['fingerprint']);
  });

  it('does not touch another admin’s runs', async () => {
    // `AiEvaluationRun.userId` is the ownership column, and the platform's own
    // cancel route scopes to it. One admin stopping another's run through a leaf
    // route would be a way around that.
    world.runs = world.runs.map((run) => ({ ...run, userId: 'user-somebody-else' }));

    const result = await cancelVoiceComparison('cmp-1', ADMIN);

    expect(result.cancelled).toEqual([]);
    expect(result.alreadyFinished.sort()).toEqual(['bare', 'fingerprint']);
    expect(prisma.aiEvaluationRun.updateMany).not.toHaveBeenCalled();
  });

  it('counts an arm whose run was deleted as finished rather than dropping it', async () => {
    // Its row is kept so the prompt survives the run. Reporting neither
    // cancelled nor finished would lose an arm from the answer entirely.
    world.arms[1] = { arm: 'bare', evaluationRunId: null };
    world.runs = [{ id: 'run-fingerprint', userId: ADMIN, status: 'running' }];

    const result = await cancelVoiceComparison('cmp-1', ADMIN);

    expect(result.cancelled).toEqual(['fingerprint']);
    expect(result.alreadyFinished).toEqual(['bare']);
  });

  it('refuses an id that is not a comparison rather than reporting a no-op stop', async () => {
    // A stop that quietly succeeds on a comparison that does not exist tells the
    // operator the run was stopped. It was not — it is somewhere else.
    world.arms = [];

    await expect(cancelVoiceComparison('cmp-missing', ADMIN)).rejects.toThrow(
      /no voice comparison/i
    );
  });
});
