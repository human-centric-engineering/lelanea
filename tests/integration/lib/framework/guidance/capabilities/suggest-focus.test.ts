/**
 * `suggest_focus` (f-guidance t-2). Mocks the guidance service; asserts the no-user guard,
 * the not-started (linger) result, and the recommendation mapping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/framework/guidance/guidance', () => ({ loadFocusSuggestion: vi.fn() }));

import { SuggestFocusCapability } from '@/lib/framework/guidance/capabilities/suggest-focus';
import { loadFocusSuggestion } from '@/lib/framework/guidance/guidance';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new SuggestFocusCapability();
const ctx = (userId: string | null): CapabilityContext => ({ userId, agentId: 'agent-1' });
const args = { graphSlug: 'onboarding' };

beforeEach(() => vi.clearAllMocks());

describe('execute', () => {
  it('refuses with no_user_context for a system run', async () => {
    const result = await cap.execute(args, ctx(null));
    expect(result).toMatchObject({ success: false, error: { code: 'no_user_context' } });
    expect(loadFocusSuggestion).not.toHaveBeenCalled();
  });

  it('refuses an anonymous embed visitor with anonymous_visitor, touching nothing', async () => {
    const result = await cap.execute(args, ctx('embed_visitor1'));
    expect(result).toMatchObject({ success: false, error: { code: 'anonymous_visitor' } });
    expect(loadFocusSuggestion).not.toHaveBeenCalled();
  });

  it('lingers (journeyStarted:false) when nothing to guide', async () => {
    vi.mocked(loadFocusSuggestion).mockResolvedValue(null);
    const result = await cap.execute(args, ctx('user-1'));
    expect(result).toMatchObject({
      success: true,
      data: { journeyStarted: false, recommendation: 'linger', topMove: null },
    });
  });

  it('maps a move recommendation and flattens topMove to its node key', async () => {
    vi.mocked(loadFocusSuggestion).mockResolvedValue({
      recommendation: 'move',
      reason: 'A next step is worth surfacing.',
      topMove: { nodeKey: 'next', score: 5, reasons: [], related: [] },
    });
    expect(await cap.execute(args, ctx('user-1'))).toEqual({
      success: true,
      data: {
        journeyStarted: true,
        recommendation: 'move',
        reason: 'A next step is worth surfacing.',
        topMove: 'next',
      },
    });
  });
});
