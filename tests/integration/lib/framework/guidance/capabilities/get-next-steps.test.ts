/**
 * `get_next_steps` (f-guidance t-2). Mocks the guidance service; asserts the no-user guard,
 * the not-started result, and that the ranked moves pass through.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/framework/guidance/guidance', () => ({ loadGuidance: vi.fn() }));

import { GetNextStepsCapability } from '@/lib/framework/guidance/capabilities/get-next-steps';
import { loadGuidance } from '@/lib/framework/guidance/guidance';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new GetNextStepsCapability();
const ctx = (userId: string | null): CapabilityContext => ({ userId, agentId: 'agent-1' });
const args = { graphSlug: 'onboarding' };

beforeEach(() => vi.clearAllMocks());

describe('execute', () => {
  it('refuses with no_user_context for a system run', async () => {
    const result = await cap.execute(args, ctx(null));
    expect(result).toMatchObject({ success: false, error: { code: 'no_user_context' } });
    expect(loadGuidance).not.toHaveBeenCalled();
  });

  it('refuses an anonymous embed visitor with anonymous_visitor, touching nothing', async () => {
    const result = await cap.execute(args, ctx('embed_visitor1'));
    expect(result).toMatchObject({ success: false, error: { code: 'anonymous_visitor' } });
    expect(loadGuidance).not.toHaveBeenCalled();
  });

  it('reports journeyStarted:false with no moves when nothing to guide', async () => {
    vi.mocked(loadGuidance).mockResolvedValue(null);
    expect(await cap.execute(args, ctx('user-1'))).toEqual({
      success: true,
      data: { journeyStarted: false, moves: [] },
    });
  });

  it('passes the ranked moves (with reasons) through', async () => {
    const moves = [
      { nodeKey: 'next', score: 3, reasons: [{ code: 'first_arrival', detail: 'x' }], related: [] },
    ];
    vi.mocked(loadGuidance).mockResolvedValue({ context: {}, availability: {}, moves } as never);
    const result = await cap.execute(args, ctx('user-1'));
    expect(result).toEqual({ success: true, data: { journeyStarted: true, moves } });
  });

  it('reads the caller as subject on the requested graph', async () => {
    vi.mocked(loadGuidance).mockResolvedValue(null);
    await cap.execute({ graphSlug: 'g2' }, ctx('user-9'));
    expect(loadGuidance).toHaveBeenCalledWith(
      { userId: 'user-9' },
      { userId: 'user-9', graphSlug: 'g2' }
    );
  });
});
