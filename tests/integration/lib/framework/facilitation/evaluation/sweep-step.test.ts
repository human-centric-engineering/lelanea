/**
 * Scheduled eval sweep step (f-governance-plus t-3). Mocks the conversation selector, the three eval
 * passes, and the DB (service-account fallback). Proves the default passes (supervise+rubric, not
 * score), the opt-in metric pass, per-conversation failure isolation, the in-loop budget fence, the
 * actor fallback to the service account, and config validation — plus, since Sunrise 0.15.0, that
 * the sweep reads across owners for a narrowed caller (§115) and stops at a spend cap's refusal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: { user: { findFirst: vi.fn() } } }));
vi.mock('@/lib/framework/facilitation/evaluation/recent-conversations', () => ({
  listRecentUnscoredFrameworkConversations: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/evaluation/score-conversation', () => ({
  scoreConversation: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/evaluation/supervise', () => ({
  superviseConversation: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/evaluation/rubric', () => ({
  rubricScoreConversation: vi.fn(),
}));

import { executeEvalSweep } from '@/lib/framework/facilitation/evaluation/sweep-step';
import { prisma } from '@/lib/db/client';
import { listRecentUnscoredFrameworkConversations } from '@/lib/framework/facilitation/evaluation/recent-conversations';
import { scoreConversation } from '@/lib/framework/facilitation/evaluation/score-conversation';
import { superviseConversation } from '@/lib/framework/facilitation/evaluation/supervise';
import { rubricScoreConversation } from '@/lib/framework/facilitation/evaluation/rubric';
import { ExecutorError } from '@/lib/orchestration/engine/errors';
import { getSubjectReadScope, runAsSubject } from '@/lib/auth/subject-context';
import { SpendCapExceededError } from '@/lib/orchestration/llm/spend-caps';
import { SpendCapRefusedError } from '@/lib/framework/shared/spend-caps';

const step = (config: unknown = {}) => ({ id: 'step-1', config }) as never;
const ctx = (over: Record<string, unknown> = {}) =>
  ({
    userId: 'admin-1',
    totalCostUsd: 0,
    logger: { warn: vi.fn() },
    ...over,
  }) as never;

const convo = (id: string) => ({ id, contextType: 'facilitation', contextId: 'onboarding' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'svc-1' } as never);
  vi.mocked(listRecentUnscoredFrameworkConversations).mockResolvedValue([
    convo('c1'),
    convo('c2'),
  ] as never);
  vi.mocked(scoreConversation).mockResolvedValue({ totalCostUsd: 0.03 } as never);
  vi.mocked(superviseConversation).mockResolvedValue({ costUsd: 0.02, tokensUsed: 100 } as never);
  vi.mocked(rubricScoreConversation).mockResolvedValue({
    totalCostUsd: 0.01,
    totalTokensUsed: 20,
  } as never);
});

describe('executeEvalSweep', () => {
  it('runs supervise + rubric by default (metric scoring off) over each conversation', async () => {
    const result = await executeEvalSweep(step(), ctx());
    expect(superviseConversation).toHaveBeenCalledTimes(2);
    expect(rubricScoreConversation).toHaveBeenCalledTimes(2);
    expect(scoreConversation).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({
      candidateConversations: 2,
      sweptConversations: 2,
      failedConversations: 0,
      passes: { score: false, supervise: true, rubric: true },
    });
    // cost = 2 * (0.02 supervise + 0.01 rubric); tokens = 2 * (100 supervise + 20 rubric).
    expect(result.costUsd).toBeCloseTo(0.06, 6);
    expect(result.tokensUsed).toBe(240);
  });

  it('runs the metric scorer when score:true', async () => {
    await executeEvalSweep(step({ score: true, supervise: false, rubric: false }), ctx());
    expect(scoreConversation).toHaveBeenCalledTimes(2);
    expect(superviseConversation).not.toHaveBeenCalled();
    expect(rubricScoreConversation).not.toHaveBeenCalled();
  });

  it('attributes every pass to the service account, never the user who ran it', async () => {
    // Each judge turn is saved as a conversation owned by the actor and quotes the member's turn;
    // attributed to the admin who ran the sweep, every member's turns would land in their history.
    await executeEvalSweep(step(), ctx({ userId: 'admin-9' }));
    expect(superviseConversation).toHaveBeenCalledWith({
      conversationId: 'c1',
      actorUserId: 'svc-1',
    });
    expect(rubricScoreConversation).toHaveBeenCalledWith({
      conversationId: 'c1',
      actorUserId: 'svc-1',
    });
  });

  it('isolates a per-conversation failure — counts it, does not abort the sweep', async () => {
    vi.mocked(superviseConversation).mockRejectedValueOnce(new Error('no scorable turns'));
    const result = await executeEvalSweep(step(), ctx());
    expect(result.output).toMatchObject({ sweptConversations: 1, failedConversations: 1 });
    // The second conversation still ran.
    expect(rubricScoreConversation).toHaveBeenCalledTimes(1); // c1 threw before rubric; c2 succeeded
  });

  it('stops early when the running cost reaches budgetLimitUsd', async () => {
    // First conversation costs 0.03; budget 0.02 → stop after the first.
    const result = await executeEvalSweep(step(), ctx({ budgetLimitUsd: 0.02 }));
    expect(result.output).toMatchObject({ sweptConversations: 1, budgetStopped: true });
    expect(superviseConversation).toHaveBeenCalledTimes(1);
  });

  it('attributes a scheduled run (no user) to the service account too', async () => {
    await executeEvalSweep(step(), ctx({ userId: null }));
    expect(superviseConversation).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'svc-1' })
    );
  });

  it('throws ExecutorError when no service account exists, whoever ran it', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    await expect(executeEvalSweep(step(), ctx({ userId: 'admin-9' }))).rejects.toBeInstanceOf(
      ExecutorError
    );
  });

  it('rejects a config that enables no pass', async () => {
    await expect(
      executeEvalSweep(step({ supervise: false, rubric: false }), ctx())
    ).rejects.toBeInstanceOf(ExecutorError);
  });

  it('rejects a malformed config', async () => {
    await expect(executeEvalSweep(step({ maxConversations: -5 }), ctx())).rejects.toBeInstanceOf(
      ExecutorError
    );
  });
});

describe('owner layer (Sunrise §115)', () => {
  const narrowedOrgAdmin = {
    principal: { userId: 'org-admin-1', credential: 'session' as const },
    filter: { userId: 'org-admin-1' },
    resolveFilter: () => Promise.resolve({ userId: 'org-admin-1' }),
    unattributedReads: {
      conversation: false,
      dataset: false,
      execution: false,
      experiment: false,
      webhookDelivery: false,
      webhookSubscription: false,
    },
  };

  it('reads and scores every member’s conversations across owners for a narrowed caller', async () => {
    const scopes: Record<string, string[]> = { select: [], supervise: [], rubric: [] };
    vi.mocked(listRecentUnscoredFrameworkConversations).mockImplementationOnce(async () => {
      scopes.select.push((await getSubjectReadScope()).kind);
      return [convo('c1')] as never;
    });
    vi.mocked(superviseConversation).mockImplementationOnce(async () => {
      scopes.supervise.push((await getSubjectReadScope()).kind);
      return { costUsd: 0, tokensUsed: 0 } as never;
    });
    vi.mocked(rubricScoreConversation).mockImplementationOnce(async () => {
      scopes.rubric.push((await getSubjectReadScope()).kind);
      return { totalCostUsd: 0, totalTokensUsed: 0 } as never;
    });

    await runAsSubject(narrowedOrgAdmin, async () => {
      // Prove the population: outside the sweep, this caller IS narrowed.
      expect((await getSubjectReadScope()).kind).toBe('subject');
      await executeEvalSweep(step(), ctx({ userId: 'org-admin-1' }));
    });

    // Narrowed ('subject'), the owner layer refuses the sweep's unconfined conversation and message
    // reads; 'admitted' is the declared crossing, covering the passes' reads as well as the selection.
    expect(scopes).toEqual({ select: ['admitted'], supervise: ['admitted'], rubric: ['admitted'] });
  });
});

describe('spend caps (Sunrise 0.15.0)', () => {
  it('stops at the first cap refusal and fails the step under the cap’s code, keeping what it spent', async () => {
    vi.mocked(listRecentUnscoredFrameworkConversations).mockResolvedValue([
      convo('c1'),
      convo('c2'),
      convo('c3'),
    ] as never);
    vi.mocked(superviseConversation)
      .mockResolvedValueOnce({ costUsd: 0.02, tokensUsed: 100 } as never)
      .mockRejectedValueOnce(new SpendCapExceededError('org', 'openai'));

    const err = await executeEvalSweep(step(), ctx()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ExecutorError);
    const failure = err as ExecutorError;
    expect(failure.code).toBe('org_budget_exceeded');
    expect(failure.retriable).toBe(false);
    expect(failure.message).toContain('stopped after 1 of 3 conversations');
    expect(failure.message).toContain('conversation c2 may be part-evaluated');
    expect(failure.message).toContain('reached its monthly AI budget');
    // c1's supervise + rubric spend survives the stop.
    expect(failure.costUsd).toBeCloseTo(0.03, 6);
    expect(failure.tokensUsed).toBe(120);
    // Nothing after the refusal: c2's rubric pass and all of c3 never ran.
    expect(superviseConversation).toHaveBeenCalledTimes(2);
    expect(rubricScoreConversation).toHaveBeenCalledTimes(1);
  });

  it('still skips a conversation whose pass failed for any other reason', async () => {
    vi.mocked(superviseConversation).mockRejectedValueOnce(new Error('no scorable turns'));
    const result = await executeEvalSweep(step(), ctx());
    expect(result.output).toMatchObject({ sweptConversations: 1, failedConversations: 1 });
  });

  it('counts what a refused pass spent before the refusal', async () => {
    // The rubric pass on c1 judged some turns, then met the cap: it carries their cost.
    vi.mocked(rubricScoreConversation).mockRejectedValueOnce(
      new SpendCapRefusedError('global_budget_exceeded', undefined, {
        costUsd: 0.04,
        tokensUsed: 80,
      })
    );
    const failure = (await executeEvalSweep(step(), ctx()).catch(
      (e: unknown) => e
    )) as ExecutorError;
    expect(failure.code).toBe('global_budget_exceeded');
    // c1's supervise (0.02 / 100) plus the refused rubric pass's own spend (0.04 / 80).
    expect(failure.costUsd).toBeCloseTo(0.06, 6);
    expect(failure.tokensUsed).toBe(180);
  });
});
