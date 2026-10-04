/**
 * The leaf's recurring jobs (`lib/app/jobs.ts`). Which jobs are registered is
 * pinned in `defaults.test.ts`; this proves what each job does when the
 * maintenance tick runs it (f-memory t-129, t-128).
 *
 * FORK NOTE — this reads the real `lib/app/jobs.ts`, not a mock. It has to: the
 * job's `run` is the thing under test, so a mock would assert the mock. It is
 * Lelañea's seam and Lelañea's test. A fork of Lelañea that changes
 * `initAppJobs()` updates the jobs this finds by name and what each `run` is
 * expected to call.
 */

import { describe, it, expect, vi } from 'vitest';

const { registerAppJob, backfillMemoryIndex, sweepDeletedConversations } = vi.hoisted(() => ({
  registerAppJob: vi.fn(),
  backfillMemoryIndex: vi.fn(async () => ({ indexed: 3, failed: 0 })),
  sweepDeletedConversations: vi.fn(async () => ({ turns: 2, versions: 1, deferred: 0 })),
}));
vi.mock('@/lib/orchestration/maintenance/app-jobs', () => ({ registerAppJob }));
vi.mock('@/lib/app/memory/memory-index', () => ({ backfillMemoryIndex }));
vi.mock('@/lib/app/memory/delete-conversation', () => ({ sweepDeletedConversations }));

const { initAppJobs } = await import('@/lib/app/jobs');

function job(name: string): { run: () => Promise<unknown>; intervalMs: number } | undefined {
  registerAppJob.mockClear();
  initAppJobs();
  return registerAppJob.mock.calls.map((call) => call[0]).find((entry) => entry.name === name);
}

describe('the memory index backfill job', () => {
  it('runs the backfill and hands its outcome to the tick’s log line', async () => {
    const backfill = job('app:memory-index-backfill');
    expect(backfillMemoryIndex).not.toHaveBeenCalled();
    await expect(backfill?.run()).resolves.toEqual({ indexed: 3, failed: 0 });
    expect(backfillMemoryIndex).toHaveBeenCalledTimes(1);
  });
});

describe('the deleted-conversation sweep job', () => {
  it('runs the sweep every minute and hands its outcome to the tick’s log line', async () => {
    const sweep = job('app:deleted-conversation-sweep');
    expect(sweep?.intervalMs).toBe(60_000);
    expect(sweepDeletedConversations).not.toHaveBeenCalled();
    await expect(sweep?.run()).resolves.toEqual({ turns: 2, versions: 1, deferred: 0 });
    expect(sweepDeletedConversations).toHaveBeenCalledTimes(1);
  });
});
