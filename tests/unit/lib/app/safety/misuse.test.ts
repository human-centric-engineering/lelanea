/**
 * Attempts on her seats are seen (f-safety t-60).
 *
 * Two observers of one guard event, tested together:
 *
 * - **The audit entry.** Daybreak's REAL escalation contributor, reading the
 *   policies her seed writes (`ESCALATION_POLICIES`), with only its outputs
 *   mocked. A flagged input on her seat, at the `log_only` mode her agent is
 *   pinned to, must reach `logAdminAction` and the notifier. If the seeded
 *   payload were one the contributor skipped (wrong scope, wrong guard, a
 *   severity above `flagged`), this fails.
 * - **The safety record.** `recordGuardDetection` writes a `misuse` row with
 *   the guard and its mode, and no text, for the input guard only. It ignores
 *   the reply-side guards, other surfaces, other seats and a switched-off guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  listPolicies: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: mocks.error, info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: { appSafetyEvent: { create: mocks.create } } }));
vi.mock('@/lib/framework/facilitation/policies/policy-queries', () => ({
  listEnabledFacilitationPolicies: mocks.listPolicies,
}));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction: mocks.audit }));
vi.mock('@/lib/orchestration/capabilities/built-in/escalation-notifier', () => ({
  notifyEscalation: mocks.notify,
}));

import { handleFacilitationGuardEvent } from '@/lib/framework/facilitation/policies/escalation';
import { recordGuardDetection } from '@/lib/app/safety/misuse';
import { ESCALATION_POLICIES, GUARD_MODES } from '@/lib/app/agent/pins';
import { SEAT_SURFACE } from '@/lib/app/safety/escalation';

const ON_HER_SEAT = {
  contextType: SEAT_SURFACE,
  contextId: 'onboarding',
  agentId: 'agent-her',
  userId: 'user-1',
  conversationId: 'conv-1',
};
const FLAGGED_INPUT = { guard: 'input' as const, outcome: GUARD_MODES.inputGuardMode };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({});
  mocks.notify.mockResolvedValue(undefined);
  mocks.listPolicies.mockResolvedValue(
    ESCALATION_POLICIES.map((payload, index) => ({
      id: `policy-${index}`,
      kind: 'escalation',
      enabled: true,
      payload,
    }))
  );
});

describe('the escalation her seed configures', () => {
  it('turns a flagged input on her seat into an audit entry and a notification', async () => {
    await handleFacilitationGuardEvent(ON_HER_SEAT, FLAGGED_INPUT);

    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'facilitation_escalation.triggered',
        entityId: 'conv-1',
        metadata: expect.objectContaining({
          guard: 'input',
          outcome: 'log_only',
          role: 'onboarding',
          affectedUserId: 'user-1',
        }),
      })
    );
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ priority: 'medium' }));
  });

  it('fires on her other seat too', async () => {
    await handleFacilitationGuardEvent({ ...ON_HER_SEAT, contextId: 'facilitator' }, FLAGGED_INPUT);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('does not escalate an output-guard hit — the policy is about attempts, which arrive as input', async () => {
    await handleFacilitationGuardEvent(ON_HER_SEAT, { guard: 'output', outcome: 'log_only' });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('recordGuardDetection', () => {
  it('writes a misuse event naming the guard and its mode, and nothing of what was said', async () => {
    await recordGuardDetection(ON_HER_SEAT, FLAGGED_INPUT);

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        kind: 'misuse',
        userId: 'user-1',
        seat: 'onboarding',
        categories: [],
        guard: 'input',
        guardOutcome: 'log_only',
      },
    });
  });

  it.each(['output', 'citation'] as const)(
    'does not record the %s guard — it reads her reply, not what the person wrote',
    async (guard) => {
      await recordGuardDetection(ON_HER_SEAT, { guard, outcome: 'log_only' });
      expect(mocks.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['a turn off the facilitation surface', { ...ON_HER_SEAT, contextType: 'voice' }],
    ['a seat she does not hold', { ...ON_HER_SEAT, contextId: 'synopsis' }],
    ['a turn with no seat', { ...ON_HER_SEAT, contextId: undefined }],
  ])('ignores %s', async (_label, ctx) => {
    await recordGuardDetection(ctx, FLAGGED_INPUT);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('ignores a guard an operator switched off, which flagged nothing', async () => {
    await recordGuardDetection(ON_HER_SEAT, { guard: 'input', outcome: 'none' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('logs a failed write without the person, and does not throw into the turn', async () => {
    mocks.create.mockRejectedValue(new Error('db down'));

    await expect(recordGuardDetection(ON_HER_SEAT, FLAGGED_INPUT)).resolves.toBeUndefined();

    expect(mocks.error).toHaveBeenCalledWith('misuse record: could not write the safety event', {
      seat: 'onboarding',
      guard: 'input',
      guardOutcome: 'log_only',
      error: 'db down',
    });
  });
});
