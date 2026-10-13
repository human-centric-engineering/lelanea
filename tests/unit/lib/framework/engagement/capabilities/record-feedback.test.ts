/**
 * Unit tests: `record_feedback` capability (f-engagement t-2).
 *
 * Records a `module.feedback` event via the shared emit seam (mocked). Asserts module
 * attribution comes from the trusted `context.scope` (never an arg), the payload carries
 * rating (+ optional comment), a system run and an unscoped call are refused, and the
 * free-text comment is masked in the durable provenance while the rating is kept.
 *
 * @see lib/framework/engagement/capabilities/record-feedback.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }));
vi.mock('@/lib/framework/engagement/record-engagement', () => ({
  recordModuleEngagement: recordMock,
}));

import { RecordFeedbackCapability } from '@/lib/framework/engagement/capabilities/record-feedback';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new RecordFeedbackCapability();
const ctx = (over: Partial<CapabilityContext> = {}): CapabilityContext => ({
  userId: 'user-1',
  agentId: 'agent-1',
  scope: { moduleSlug: 'onboarding' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  recordMock.mockResolvedValue(undefined);
});

describe('RecordFeedbackCapability', () => {
  it('records a module.feedback event with rating + comment from the surface scope', async () => {
    const res = await cap.execute({ rating: 5, comment: 'loved it' }, ctx());
    expect(res).toEqual({ success: true, data: { recorded: true } });
    expect(recordMock).toHaveBeenCalledWith({
      userId: 'user-1',
      moduleSlug: 'onboarding',
      type: 'module.feedback',
      payload: { rating: 5, comment: 'loved it' },
    });
  });

  it('omits the comment from the payload when not provided', async () => {
    await cap.execute({ rating: 3 }, ctx());
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ payload: { rating: 3 } }));
  });

  it('refuses a system-initiated run with no user context', async () => {
    const res = await cap.execute({ rating: 5 }, ctx({ userId: null }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('no_user_context');
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('refuses an anonymous embed visitor with anonymous_visitor, touching nothing', async () => {
    const res = await cap.execute({ rating: 5 }, ctx({ userId: 'embed_visitor1' }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('anonymous_visitor');
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('refuses when there is no module scope — attribution is trusted, never an arg', async () => {
    const res = await cap.execute({ rating: 5 }, ctx({ scope: {} }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('no_module_scope');
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('masks the free-text comment in the durable provenance but keeps the rating', () => {
    const redaction = cap.redactProvenance(
      { rating: 5, comment: 'my therapist recommended it' },
      { success: true, data: { recorded: true } }
    );
    const args = redaction.args as { rating: number; comment: string };
    expect(args.rating).toBe(5);
    expect(args.comment).not.toContain('therapist');
  });

  it('validates the rating is a 1–5 integer', () => {
    expect(() => cap.validate({ rating: 6 })).toThrow();
    expect(() => cap.validate({ rating: 0 })).toThrow();
    expect(() => cap.validate({ rating: 2.5 })).toThrow();
    expect(cap.validate({ rating: 4, comment: 'ok' })).toEqual({ rating: 4, comment: 'ok' });
  });
});
