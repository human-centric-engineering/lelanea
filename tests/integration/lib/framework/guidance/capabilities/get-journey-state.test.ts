/**
 * `get_journey_state` (f-guidance t-2). Mocks the guidance service; asserts the no-user
 * guard, the not-started result, and the status+verdict join.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/framework/guidance/guidance', () => ({ loadGuidance: vi.fn() }));

import { GetJourneyStateCapability } from '@/lib/framework/guidance/capabilities/get-journey-state';
import { loadGuidance } from '@/lib/framework/guidance/guidance';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new GetJourneyStateCapability();
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

  it('reports journeyStarted:false with empty picture when nothing to guide', async () => {
    vi.mocked(loadGuidance).mockResolvedValue(null);
    const result = await cap.execute(args, ctx('user-1'));
    expect(result).toEqual({
      success: true,
      data: { journeyStarted: false, nodes: [], validMoves: [], firsts: [] },
    });
  });

  it('joins each node status to its availability verdict', async () => {
    vi.mocked(loadGuidance).mockResolvedValue({
      context: { nodeStates: [{ nodeKey: 'intro', status: 'completed' }] },
      availability: {
        perNode: new Map([
          ['intro', { available: false, lockReasons: [{ kind: 'completed' }] }],
          ['next', { available: true, lockReasons: [] }],
        ]),
        validMoves: ['next'],
        firsts: ['next'],
      },
      moves: [],
    } as never);

    const result = await cap.execute(args, ctx('user-1'));
    const data = (result as { data: { nodes: readonly unknown[]; validMoves: readonly string[] } })
      .data;
    expect(data.nodes).toEqual([
      {
        nodeKey: 'intro',
        status: 'completed',
        available: false,
        lockReasons: [{ kind: 'completed' }],
      },
      { nodeKey: 'next', status: 'unvisited', available: true, lockReasons: [] }, // no state row → unvisited
    ]);
    expect(data.validMoves).toEqual(['next']);
  });

  it('is not a PII-processing capability (surfaces no captured slot value)', () => {
    expect(cap.processesPii).toBe(false);
  });
});
