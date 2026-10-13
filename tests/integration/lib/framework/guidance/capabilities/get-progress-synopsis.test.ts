/**
 * `get_progress_synopsis` (f-guidance t-2). Mocks the guidance service; asserts the no-user
 * guard, the not-started result, and the digest pass-through.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/framework/guidance/guidance', () => ({ loadProgressSynopsis: vi.fn() }));

import { GetProgressSynopsisCapability } from '@/lib/framework/guidance/capabilities/get-progress-synopsis';
import { loadProgressSynopsis } from '@/lib/framework/guidance/guidance';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new GetProgressSynopsisCapability();
const ctx = (userId: string | null): CapabilityContext => ({ userId, agentId: 'agent-1' });
const args = { graphSlug: 'onboarding' };

beforeEach(() => vi.clearAllMocks());

describe('execute', () => {
  it('refuses with no_user_context for a system run', async () => {
    const result = await cap.execute(args, ctx(null));
    expect(result).toMatchObject({ success: false, error: { code: 'no_user_context' } });
    expect(loadProgressSynopsis).not.toHaveBeenCalled();
  });

  it('refuses an anonymous embed visitor with anonymous_visitor, touching nothing', async () => {
    const result = await cap.execute(args, ctx('embed_visitor1'));
    expect(result).toMatchObject({ success: false, error: { code: 'anonymous_visitor' } });
    expect(loadProgressSynopsis).not.toHaveBeenCalled();
  });

  it('reports journeyStarted:false with a null synopsis when not started', async () => {
    vi.mocked(loadProgressSynopsis).mockResolvedValue(null);
    expect(await cap.execute(args, ctx('user-1'))).toEqual({
      success: true,
      data: { journeyStarted: false, synopsis: null },
    });
  });

  it('passes the deterministic digest through', async () => {
    const synopsis = {
      totalTracked: 2,
      completed: 1,
      active: 1,
      visited: 0,
      available: 0,
      milestones: ['a'],
      recent: [],
    };
    vi.mocked(loadProgressSynopsis).mockResolvedValue(synopsis);
    expect(await cap.execute(args, ctx('user-1'))).toEqual({
      success: true,
      data: { journeyStarted: true, synopsis },
    });
  });
});
