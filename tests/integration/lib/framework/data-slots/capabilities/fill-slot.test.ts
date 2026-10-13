/**
 * `fill_slot` capability (f-slot-capture t-2). Mocks the slot engine (`appendSlotValue`)
 * and the definition read (`getSlotDefinition`) so no live DB is loaded. Proves the
 * targeted/retired/open-mint slug decision, the P2002 retry, provenance assembly, the
 * no-user-context guard, and PII redaction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/framework/data-slots/values', () => ({ appendSlotValue: vi.fn() }));
vi.mock('@/lib/framework/data-slots/queries', () => ({ getSlotDefinition: vi.fn() }));
vi.mock('@/lib/framework/data-slots/capabilities/extract', () => ({ extractTypedValue: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FillSlotCapability } from '@/lib/framework/data-slots/capabilities/fill-slot';
import { appendSlotValue } from '@/lib/framework/data-slots/values';
import { getSlotDefinition } from '@/lib/framework/data-slots/queries';
import { extractTypedValue } from '@/lib/framework/data-slots/capabilities/extract';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new FillSlotCapability();
// The exposure allowlist is read straight off the context the dispatcher builds (t-1.1), so
// these tests set `customConfig` rather than mocking a loader — the real Zod parse and the
// real `facetAllows` enforcement run. `null` is the dispatcher's "binding carries no config";
// omitting it entirely models an execution that never went through the dispatcher.
const ctx = (over: Partial<CapabilityContext> = {}): CapabilityContext => ({
  userId: 'user-1',
  agentId: 'agent-1',
  customConfig: null,
  isEnabled: true,
  ...over,
});
const args = (over: Record<string, unknown> = {}) => ({
  slotSlug: 'primary_goal',
  value: 'run a marathon',
  confidence: 8,
  reasoningNote: 'the user said so directly',
  sourceType: 'direct' as const,
  ...over,
});
const definition = (over: Record<string, unknown> = {}) =>
  ({ slug: 'primary_goal', isActive: true, ...over }) as never;
const written = (over: Record<string, unknown> = {}) =>
  ({ slotSlug: 'primary_goal', version: 3, ...over }) as never;

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 't' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSlotDefinition).mockResolvedValue(definition());
  vi.mocked(appendSlotValue).mockResolvedValue(written());
  // Extraction defaults to "found nothing" — the tests that exercise it override.
  vi.mocked(extractTypedValue).mockResolvedValue(null);
});

describe('execute', () => {
  it('refuses with no_user_context for a system-initiated run', async () => {
    const result = await cap.execute(args(), ctx({ userId: null }));
    expect(result).toMatchObject({ success: false, error: { code: 'no_user_context' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('refuses an anonymous embed visitor with anonymous_visitor, touching nothing', async () => {
    const result = await cap.execute(args(), ctx({ userId: 'embed_visitor1' }));
    expect(result).toMatchObject({ success: false, error: { code: 'anonymous_visitor' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
    expect(getSlotDefinition).not.toHaveBeenCalled();
    expect(extractTypedValue).not.toHaveBeenCalled();
  });

  it('appends to an active targeted slot and returns the new version, silently', async () => {
    const result = await cap.execute(args(), ctx({ conversationId: 'conv-9' }));

    expect(appendSlotValue).toHaveBeenCalledWith({
      userId: 'user-1',
      slotSlug: 'primary_goal',
      value: 'run a marathon',
      valueJson: 'run a marathon', // a text slot's typed form IS the value (so gates compare it)
      confidence: 8,
      sourceType: 'direct',
      reasoningNote: 'the user said so directly',
      provenance: { conversationId: 'conv-9' },
    });
    expect(result).toEqual({
      success: true,
      data: { slotSlug: 'primary_goal', version: 3, minted: false },
      skipFollowup: true,
    });
  });

  it('carries module/node scope into provenance', async () => {
    await cap.execute(args(), ctx({ scope: { moduleSlug: 'onboarding', nodeKey: 'intro' } }));
    expect(vi.mocked(appendSlotValue).mock.calls[0][0].provenance).toEqual({
      moduleSlug: 'onboarding',
      nodeKey: 'intro',
    });
  });

  it('refuses a retired (inactive) slot with no write', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(definition({ isActive: false }));
    const result = await cap.execute(args(), ctx());
    expect(result).toMatchObject({ success: false, error: { code: 'slot_inactive' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('open-mints an undefined slug and flags minted', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(null);
    vi.mocked(appendSlotValue).mockResolvedValue(
      written({ slotSlug: 'favourite_colour', version: 1 })
    );
    const result = await cap.execute(args({ slotSlug: 'favourite_colour' }), ctx());
    expect(result).toMatchObject({ success: true, data: { minted: true } });
    expect(appendSlotValue).toHaveBeenCalled();
  });

  it('retries once on a concurrent-append P2002 and succeeds', async () => {
    vi.mocked(appendSlotValue).mockRejectedValueOnce(p2002()).mockResolvedValueOnce(written());
    const result = await cap.execute(args(), ctx());
    expect(result.success).toBe(true);
    expect(appendSlotValue).toHaveBeenCalledTimes(2);
  });

  it('propagates a non-P2002 error (no swallow)', async () => {
    vi.mocked(appendSlotValue).mockRejectedValue(new Error('db down'));
    await expect(cap.execute(args(), ctx())).rejects.toThrow('db down');
    expect(appendSlotValue).toHaveBeenCalledTimes(1);
  });
});

describe('typed value + sensitivity masking (t-3)', () => {
  const appendArg = () => vi.mocked(appendSlotValue).mock.calls[0][0];

  it('stores an agent-supplied typed value that matches the slot dataType', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(definition({ dataType: 'number' }));
    await cap.execute(args({ value: 'eight out of ten', valueJson: 8 }), ctx());
    expect(appendArg().valueJson).toBe(8);
  });

  it('drops a typed value that does not match, and stores nothing when extraction also fails', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(definition({ dataType: 'number' }));
    // extractTypedValue defaults to null (mocked) — the best-effort fallback found nothing.
    await cap.execute(args({ valueJson: 'not a number' }), ctx());
    expect(appendArg()).not.toHaveProperty('valueJson');
  });

  it('falls back to prose→typed extraction when a typed slot gets no valid valueJson', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(definition({ dataType: 'number' }));
    vi.mocked(extractTypedValue).mockResolvedValue(7);
    await cap.execute(args({ value: 'about seven', valueJson: undefined }), ctx());
    expect(extractTypedValue).toHaveBeenCalledWith('number', 'about seven', 'agent-1');
    expect(appendArg().valueJson).toBe(7);
  });

  it('does NOT run extraction when the agent already supplied a valid typed value', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(definition({ dataType: 'number' }));
    await cap.execute(args({ valueJson: 8 }), ctx());
    expect(extractTypedValue).not.toHaveBeenCalled();
    expect(appendArg().valueJson).toBe(8);
  });

  it('does NOT run extraction for a text slot (its typed form is the prose)', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(definition({ dataType: 'text' }));
    await cap.execute(args(), ctx());
    expect(extractTypedValue).not.toHaveBeenCalled();
  });

  it('special_category text: masks the value and stores no typed prose (data-minimisation)', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(
      definition({ dataType: 'text', sensitivity: 'special_category' })
    );
    await cap.execute(args({ value: 'discloses a health condition' }), ctx());
    expect(appendArg().value).not.toContain('health');
    expect(appendArg()).not.toHaveProperty('valueJson');
  });

  it('special_category typed: masks the prose but keeps the typed gate value', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(
      definition({ dataType: 'number', sensitivity: 'special_category' })
    );
    await cap.execute(args({ value: 'a sensitive score of 3', valueJson: 3 }), ctx());
    expect(appendArg().value).not.toContain('sensitive');
    expect(appendArg().valueJson).toBe(3);
  });
});

describe('per-agent write exposure (t-4)', () => {
  it('appends when the target slot is inside the agent’s write allowlist', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(definition({ group: 'goals', scope: 'global' }));
    const result = await cap.execute(
      args(),
      ctx({ customConfig: { write: { groups: ['goals'], scopes: ['global'] } } })
    );
    expect(result.success).toBe(true);
    expect(appendSlotValue).toHaveBeenCalled();
  });

  it('refuses (slot_not_permitted) and never writes when the slot is outside the allowlist', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(
      definition({ group: 'wellbeing', scope: 'global' })
    );
    const result = await cap.execute(
      args(),
      ctx({ customConfig: { write: { groups: ['goals'] } } })
    );
    expect(result).toMatchObject({ success: false, error: { code: 'slot_not_permitted' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('refuses an open-mint (no group/scope) under an active write restriction', async () => {
    vi.mocked(getSlotDefinition).mockResolvedValue(null); // undefined slug ⇒ would mint
    const result = await cap.execute(
      args({ slotSlug: 'invented' }),
      ctx({ customConfig: { write: { groups: ['goals'] } } })
    );
    expect(result).toMatchObject({ success: false, error: { code: 'slot_not_permitted' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('fails closed with invalid_exposure when the config is malformed', async () => {
    const result = await cap.execute(args(), ctx({ customConfig: { write: 'anything' } }));
    expect(result).toMatchObject({ success: false, error: { code: 'invalid_exposure' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('fails closed and never writes when the context carries no resolved binding', async () => {
    // Off the dispatch path there is no binding to read, so an allowlist would silently
    // vanish. `customConfig: undefined` must refuse the write, not default to permissive.
    const result = await cap.execute(args(), ctx({ customConfig: undefined }));
    expect(result).toMatchObject({ success: false, error: { code: 'invalid_exposure' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });
});

describe('validation + PII', () => {
  it('rejects an unknown sourceType', () => {
    expect(() => cap.validate(args({ sourceType: 'made_up' }))).toThrow();
  });

  it('declares processesPii and masks value + reasoningNote, keeping a targeted (vetted) slug', () => {
    expect(cap.processesPii).toBe(true);
    const redacted = cap.redactProvenance(args(), {
      success: true,
      data: { slotSlug: 'primary_goal', version: 3, minted: false },
    });
    const safe = redacted.args as { value: string; reasoningNote: string; slotSlug: string };
    expect(safe.slotSlug).toBe('primary_goal'); // targeted slug is a safe identifier
    expect(safe.value).not.toContain('marathon');
    expect(safe.reasoningNote).not.toContain('directly');
  });

  it('also masks a MINTED slug (model-authored free text) in both args and preview', () => {
    const minted = args({ slotSlug: 'recently_divorced' });
    const redacted = cap.redactProvenance(minted, {
      success: true,
      data: { slotSlug: 'recently_divorced', version: 1, minted: true },
    });
    const safe = redacted.args as { slotSlug: string };
    expect(safe.slotSlug).not.toContain('divorced');
    expect(redacted.resultPreview).not.toContain('divorced');
  });

  it('masks the slug on a FAILED result (a thrown write cannot confirm the slug was vetted)', () => {
    // The streaming handler reports a thrown execute() as a generic execution_error, with
    // NO minted flag — a minted slug decided before the DB error would otherwise leak.
    const redacted = cap.redactProvenance(args({ slotSlug: 'recently_divorced' }), {
      success: false,
      error: { code: 'execution_error', message: 'db down' },
    });
    const safe = redacted.args as { slotSlug: string };
    expect(safe.slotSlug).not.toContain('divorced');
  });
});
