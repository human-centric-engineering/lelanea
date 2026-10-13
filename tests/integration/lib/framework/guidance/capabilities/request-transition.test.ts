/**
 * `request_transition` (f-guidance t-3) — the write cap. Mocks the guidance service; asserts
 * the no-user guard, the not-started result, an accepted move, and a refused move (the
 * rejection surfaces as a structured "not applied", not a tool error).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/framework/guidance/guidance', () => ({ applyJourneyTransition: vi.fn() }));

import { RequestTransitionCapability } from '@/lib/framework/guidance/capabilities/request-transition';
import { applyJourneyTransition } from '@/lib/framework/guidance/guidance';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new RequestTransitionCapability();
const ctx = (userId: string | null): CapabilityContext => ({ userId, agentId: 'agent-1' });
const args = { graphSlug: 'onboarding', nodeKey: 'intro', kind: 'enter' as const };

beforeEach(() => vi.clearAllMocks());

describe('execute', () => {
  it('refuses with no_user_context for a system run (no write attempted)', async () => {
    const result = await cap.execute(args, ctx(null));
    expect(result).toMatchObject({ success: false, error: { code: 'no_user_context' } });
    expect(applyJourneyTransition).not.toHaveBeenCalled();
  });

  it('refuses an anonymous embed visitor with anonymous_visitor, touching nothing', async () => {
    const result = await cap.execute(args, ctx('embed_visitor1'));
    expect(result).toMatchObject({ success: false, error: { code: 'anonymous_visitor' } });
    expect(applyJourneyTransition).not.toHaveBeenCalled();
  });

  it('reports journeyStarted:false when the journey has not started', async () => {
    vi.mocked(applyJourneyTransition).mockResolvedValue(null);
    expect(await cap.execute(args, ctx('user-1'))).toEqual({
      success: true,
      data: {
        journeyStarted: false,
        applied: false,
        nodeKey: 'intro',
        status: null,
        rejection: null,
      },
    });
  });

  it('returns the new node status on an accepted move', async () => {
    vi.mocked(applyJourneyTransition).mockResolvedValue({
      ok: true,
      nodeState: { nodeKey: 'intro', status: 'active' },
      event: {},
    } as never);
    expect(await cap.execute(args, ctx('user-1'))).toEqual({
      success: true,
      data: {
        journeyStarted: true,
        applied: true,
        nodeKey: 'intro',
        status: 'active',
        rejection: null,
      },
    });
  });

  it('surfaces a refusal as applied:false + the rejection (not a tool error)', async () => {
    const rejection = {
      code: 'not_available',
      message: 'Not available yet.',
      lockReasons: [{ kind: 'prerequisite', from: 'welcome' }],
    };
    vi.mocked(applyJourneyTransition).mockResolvedValue({ ok: false, rejection } as never);
    const result = await cap.execute(
      { graphSlug: 'g', nodeKey: 'locked', kind: 'enter' },
      ctx('user-1')
    );
    expect(result).toEqual({
      success: true,
      data: { journeyStarted: true, applied: false, nodeKey: 'locked', status: null, rejection },
    });
  });

  it('passes the caller as subject and the requested transition through', async () => {
    vi.mocked(applyJourneyTransition).mockResolvedValue(null);
    await cap.execute({ graphSlug: 'g', nodeKey: 'n', kind: 'complete' }, ctx('user-9'));
    expect(applyJourneyTransition).toHaveBeenCalledWith(
      { userId: 'user-9' },
      { userId: 'user-9', graphSlug: 'g' },
      { nodeKey: 'n', kind: 'complete' }
    );
  });

  it('rejects an unknown transition kind at validation', () => {
    expect(() => cap.validate({ graphSlug: 'g', nodeKey: 'n', kind: 'teleport' })).toThrow();
  });

  it('is not a PII-processing capability (writes a transition, not a slot value)', () => {
    expect(cap.processesPii).toBe(false);
  });
});
