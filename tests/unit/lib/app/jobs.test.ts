/**
 * The leaf's recurring jobs (`lib/app/jobs.ts`). Which jobs are registered is
 * pinned in `defaults.test.ts`; this proves what the one job does when the
 * maintenance tick runs it (f-memory t-129).
 *
 * FORK NOTE — this reads the real `lib/app/jobs.ts`, not a mock. It has to: the
 * job's `run` is the thing under test, so a mock would assert the mock. It is
 * Lelañea's seam and Lelañea's test. A fork of Lelañea that changes
 * `initAppJobs()` updates the job this finds first (`registerAppJob`'s first
 * call) and what its `run` is expected to call.
 */

import { describe, it, expect, vi } from 'vitest';

const { registerAppJob, backfillMemoryIndex } = vi.hoisted(() => ({
  registerAppJob: vi.fn(),
  backfillMemoryIndex: vi.fn(async () => ({ indexed: 3, failed: 0 })),
}));
vi.mock('@/lib/orchestration/maintenance/app-jobs', () => ({ registerAppJob }));
vi.mock('@/lib/app/memory/memory-index', () => ({ backfillMemoryIndex }));

const { initAppJobs } = await import('@/lib/app/jobs');

describe('the memory index backfill job', () => {
  it('runs the backfill and hands its outcome to the tick’s log line', async () => {
    initAppJobs();
    const job = registerAppJob.mock.calls[0]?.[0] as { run: () => Promise<unknown> } | undefined;
    expect(backfillMemoryIndex).not.toHaveBeenCalled();
    await expect(job?.run()).resolves.toEqual({ indexed: 3, failed: 0 });
    expect(backfillMemoryIndex).toHaveBeenCalledTimes(1);
  });
});
