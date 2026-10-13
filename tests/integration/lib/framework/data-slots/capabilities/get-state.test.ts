/**
 * `get_state` capability (f-slot-capture t-1). Mocks the slot engine (`getSlotHeads`)
 * and the access seam (`canRead`) so no live DB is loaded — house style. Proves the X2
 * guard (canRead before the read; denied → empty), the no-user-context guard, the
 * head→view mapping, slug narrowing, and PII redaction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/framework/data-slots/values', () => ({ getSlotHeads: vi.fn() }));
vi.mock('@/lib/framework/shared/access', () => ({ canRead: vi.fn() }));
vi.mock('@/lib/framework/data-slots/queries', () => ({ getSlotGroupsScopes: vi.fn() }));

import { GetStateCapability } from '@/lib/framework/data-slots/capabilities/get-state';
import { getSlotHeads } from '@/lib/framework/data-slots/values';
import { canRead } from '@/lib/framework/shared/access';
import { getSlotGroupsScopes } from '@/lib/framework/data-slots/queries';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new GetStateCapability();
// The exposure allowlist is read straight off the context the dispatcher builds (t-1.1), so
// these tests set `customConfig` rather than mocking a loader — the real Zod parse and the
// real `facetAllows` filter run. `null` is the dispatcher's "binding carries no config".
const ctx = (
  userId: string | null,
  customConfig: CapabilityContext['customConfig'] = null
): CapabilityContext => ({ userId, agentId: 'agent-1', customConfig, isEnabled: true });
const head = (over: Record<string, unknown> = {}) => ({
  slotSlug: 'primary_goal',
  value: 'run a marathon',
  confidence: 8,
  capturedAt: new Date('2026-07-05T12:00:00Z'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canRead).mockResolvedValue(true);
});

describe('execute', () => {
  it('refuses with no_user_context for a system-initiated run', async () => {
    const result = await cap.execute({}, ctx(null));
    expect(result).toEqual({
      success: false,
      error: { code: 'no_user_context', message: expect.any(String) },
    });
    expect(canRead).not.toHaveBeenCalled();
    expect(getSlotHeads).not.toHaveBeenCalled();
  });

  it('refuses an anonymous embed visitor with anonymous_visitor, touching nothing', async () => {
    const result = await cap.execute({}, ctx('embed_visitor1'));
    expect(result).toEqual({
      success: false,
      error: { code: 'anonymous_visitor', message: expect.any(String) },
    });
    expect(canRead).not.toHaveBeenCalled();
    expect(getSlotHeads).not.toHaveBeenCalled();
  });

  it('reads the caller’s slot heads behind canRead and maps them to views', async () => {
    vi.mocked(getSlotHeads).mockResolvedValue([head()] as never);

    const result = await cap.execute({}, ctx('user-1'));

    expect(canRead).toHaveBeenCalledWith({ userId: 'user-1' }, 'user-1');
    expect(getSlotHeads).toHaveBeenCalledWith('user-1', undefined);
    expect(result).toEqual({
      success: true,
      data: {
        slots: [
          {
            slug: 'primary_goal',
            value: 'run a marathon',
            confidence: 8,
            capturedAt: '2026-07-05T12:00:00.000Z',
          },
        ],
      },
    });
  });

  it('narrows to the requested slugs', async () => {
    vi.mocked(getSlotHeads).mockResolvedValue([] as never);
    await cap.execute({ slotSlugs: ['primary_goal', 'readiness'] }, ctx('user-1'));
    expect(getSlotHeads).toHaveBeenCalledWith('user-1', {
      slotSlugs: ['primary_goal', 'readiness'],
    });
  });

  it('returns empty and never reads when canRead denies (X2)', async () => {
    vi.mocked(canRead).mockResolvedValue(false);
    const result = await cap.execute({}, ctx('viewer-2'));
    expect(result).toEqual({ success: true, data: { slots: [] } });
    expect(getSlotHeads).not.toHaveBeenCalled();
  });
});

describe('per-agent read exposure (t-4)', () => {
  const slugs = () => vi.mocked(getSlotGroupsScopes).mock.calls;

  it('permissive default returns all heads without a definition join', async () => {
    vi.mocked(getSlotHeads).mockResolvedValue([head(), head({ slotSlug: 'mood' })] as never);
    const result = await cap.execute({}, ctx('user-1'));
    expect((result as { data: { slots: unknown[] } }).data.slots).toHaveLength(2);
    expect(getSlotGroupsScopes).not.toHaveBeenCalled(); // no allowlist ⇒ no extra query
  });

  it('filters heads to the allowed groups when a read allowlist is set', async () => {
    vi.mocked(getSlotHeads).mockResolvedValue([
      head({ slotSlug: 'primary_goal' }),
      head({ slotSlug: 'mood' }),
    ] as never);
    vi.mocked(getSlotGroupsScopes).mockResolvedValue([
      { slug: 'primary_goal', group: 'goals', scope: 'global' },
      { slug: 'mood', group: 'wellbeing', scope: 'global' },
    ]);
    const result = await cap.execute({}, ctx('user-1', { read: { groups: ['goals'] } }));
    const out = (result as { data: { slots: { slug: string }[] } }).data.slots;
    expect(out.map((s) => s.slug)).toEqual(['primary_goal']);
    expect(slugs()[0][0]).toEqual(['primary_goal', 'mood']);
  });

  it('drops a mint head (no definition ⇒ no group) under a restrictive allowlist', async () => {
    vi.mocked(getSlotHeads).mockResolvedValue([head({ slotSlug: 'minted_thing' })] as never);
    vi.mocked(getSlotGroupsScopes).mockResolvedValue([]); // minted slug has no definition row
    const result = await cap.execute({}, ctx('user-1', { read: { groups: ['goals'] } }));
    expect((result as { data: { slots: unknown[] } }).data.slots).toHaveLength(0);
  });

  it('fails closed with invalid_exposure when the allowlist config is malformed', async () => {
    const result = await cap.execute({}, ctx('user-1', { read: 'everything' }));
    expect(result).toMatchObject({ success: false, error: { code: 'invalid_exposure' } });
    expect(getSlotHeads).not.toHaveBeenCalled();
  });
});

describe('PII handling', () => {
  it('declares processesPii', () => {
    expect(cap.processesPii).toBe(true);
  });

  it('masks each slot value in the audit provenance, keeping slug + confidence', () => {
    const result = {
      success: true as const,
      data: {
        slots: [{ slug: 'primary_goal', value: 'run a marathon', confidence: 8, capturedAt: 'x' }],
      },
    };
    const redacted = cap.redactProvenance({}, result);
    const preview = JSON.parse(redacted.resultPreview);
    expect(preview.data.slots[0].slug).toBe('primary_goal');
    expect(preview.data.slots[0].confidence).toBe(8);
    expect(preview.data.slots[0].value).not.toContain('marathon');
  });
});
