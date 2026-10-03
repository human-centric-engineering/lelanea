/**
 * The leaf's recurring jobs (`lib/app/jobs.ts`). Which jobs are registered is
 * pinned in `defaults.test.ts`; this proves what the one job does when the
 * maintenance tick runs it (f-memory t-129).
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
