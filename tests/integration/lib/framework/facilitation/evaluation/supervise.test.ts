/**
 * Framework conversation supervisor (f-eval t-2). Mocks the DB client, the surface gate, the turn
 * reader, the supervisor core, the model/provider resolution, cost tracking, and the audit logger.
 * Proves the conversation→stepOutputs projection, the stable first-turn anchor + upsert, the
 * framework rubric/red-team wiring, the no-turns guard, the unknown-model guard, and audit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: { frameworkConversationEval: { upsert: vi.fn() } },
}));
vi.mock('@/lib/framework/facilitation/evaluation/conversation', () => ({
  loadFrameworkConversation: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/evaluation/turns', () => ({ listScorableTurns: vi.fn() }));
vi.mock('@/lib/orchestration/supervisor', () => ({ runSupervisorAssessment: vi.fn() }));
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({ getProvider: vi.fn() }));
vi.mock('@/lib/orchestration/llm/model-registry', () => ({ getModel: vi.fn() }));
vi.mock('@/lib/orchestration/llm/settings-resolver', () => ({ getDefaultModelForTask: vi.fn() }));
const judgeModel = vi.hoisted((): { value: string | undefined } => ({ value: 'judge-x' }));
vi.mock('@/lib/orchestration/evaluations/judge-model', () => ({
  get JUDGE_MODEL() {
    return judgeModel.value;
  },
}));
vi.mock('@/lib/orchestration/llm/cost-tracker', () => ({
  calculateCost: vi.fn(() => ({ totalCostUsd: 0.03, isLocal: false })),
  logCost: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { superviseConversation } from '@/lib/framework/facilitation/evaluation/supervise';
import { prisma } from '@/lib/db/client';
import { loadFrameworkConversation } from '@/lib/framework/facilitation/evaluation/conversation';
import { listScorableTurns } from '@/lib/framework/facilitation/evaluation/turns';
import { runSupervisorAssessment } from '@/lib/orchestration/supervisor';
import { getProvider } from '@/lib/orchestration/llm/provider-manager';
import { getModel } from '@/lib/orchestration/llm/model-registry';
import { getDefaultModelForTask } from '@/lib/orchestration/llm/settings-resolver';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { calculateCost, logCost } from '@/lib/orchestration/llm/cost-tracker';
import { logger } from '@/lib/logging';
import { ValidationError } from '@/lib/api/errors';

const turn = (id: string) => ({
  messageId: id,
  userQuestion: `Q-${id}`,
  aiResponse: `A-${id}`,
  citations: [],
});

const report = {
  verdict: 'concerns' as const,
  score: 0.6,
  summary: 'some concerns',
  strengths: [],
  weaknesses: [],
  anomalies: [],
  unverifiedAreas: [],
  confidence: 'medium' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadFrameworkConversation).mockResolvedValue({
    id: 'c1',
    contextType: 'facilitation',
    contextId: 'onboarding',
  });
  vi.mocked(listScorableTurns).mockResolvedValue([turn('a1'), turn('a2')]);
  vi.mocked(getModel).mockReturnValue({ provider: 'openai' } as never);
  vi.mocked(getProvider).mockResolvedValue({
    chat: vi.fn().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  } as never);
  vi.mocked(runSupervisorAssessment).mockResolvedValue({
    report,
    tokensUsed: 15,
    costUsd: 0.03,
  });
  vi.mocked(prisma.frameworkConversationEval.upsert).mockImplementation((async ({
    where,
  }: never) => ({ id: 'e', messageId: (where as { messageId: string }).messageId })) as never);
});

describe('superviseConversation', () => {
  it('projects turns, anchors the verdict on the terminal turn, and audits', async () => {
    const result = await superviseConversation({ conversationId: 'c1', actorUserId: 'admin-1' });

    expect(result).toMatchObject({
      conversationId: 'c1',
      messageId: 'a1', // anchored on the FIRST (stable) turn
      verdict: 'concerns',
      score: 0.6,
      tokensUsed: 15,
      costUsd: 0.03,
    });

    // stepOutputs projection: one plain-string entry per turn, keyed turn-N, so the judge's prose
    // quotes validate against the unescaped text.
    const passed = vi.mocked(runSupervisorAssessment).mock.calls[0][0];
    expect(Object.keys(passed.stepOutputs)).toEqual(['turn-1', 'turn-2']);
    expect(typeof passed.stepOutputs['turn-1']).toBe('string');
    expect(passed.stepOutputs['turn-1']).toContain('Q-a1');
    expect(passed.stepOutputs['turn-1']).toContain('A-a1');
    expect(passed.outputData).toEqual({ finalResponse: 'A-a2' }); // final turn's response
    expect(passed.triggeredBy).toBe('retroactive');
    expect(passed.includeStepOutputs).toBe('auto');
    expect(passed.requireEvidenceCitations).toBe(true);
    // Framework-specific rubric + red-team, not the core workflow defaults.
    expect(passed.assessmentCriteria).toMatch(/facilitation\/module/);
    expect(passed.redTeamPrompts?.length).toBeGreaterThan(0);

    // Verdict upserted onto the first turn's row.
    expect(vi.mocked(prisma.frameworkConversationEval.upsert).mock.calls[0][0]).toMatchObject({
      where: { messageId: 'a1' },
      create: { messageId: 'a1', conversationId: 'c1', contextType: 'facilitation' },
      update: { supervisorReport: expect.objectContaining({ verdict: 'concerns' }) },
    });

    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'framework_conversation_eval.supervise',
        entityId: 'c1',
      })
    );
  });

  it('includes a citations block in a turn projection when the turn carried citations', async () => {
    vi.mocked(listScorableTurns).mockResolvedValue([
      {
        messageId: 'a1',
        userQuestion: 'Q',
        aiResponse: 'A',
        citations: [{ id: 'doc-7' }] as never,
      },
    ]);
    await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
    const projected = vi.mocked(runSupervisorAssessment).mock.calls[0][0].stepOutputs['turn-1'];
    expect(projected).toContain('Citations:');
    expect(projected).toContain('doc-7');
  });

  it('anchors on the same first turn after the conversation grows (idempotent, no orphans)', async () => {
    await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
    // Conversation gains turns; re-supervise. The anchor must still be the first turn (a1).
    vi.mocked(listScorableTurns).mockResolvedValue([
      turn('a1'),
      turn('a2'),
      turn('a3'),
      turn('a4'),
    ]);
    const second = await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
    expect(second.messageId).toBe('a1');
    for (const call of vi.mocked(prisma.frameworkConversationEval.upsert).mock.calls) {
      expect((call[0] as { where: { messageId: string } }).where.messageId).toBe('a1');
    }
  });

  it('rejects a conversation with no scorable turns (ValidationError, no LLM call)', async () => {
    vi.mocked(listScorableTurns).mockResolvedValue([]);
    await expect(
      superviseConversation({ conversationId: 'c1', actorUserId: 'a' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runSupervisorAssessment).not.toHaveBeenCalled();
    expect(prisma.frameworkConversationEval.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown model (ValidationError, no LLM call)', async () => {
    vi.mocked(getModel).mockReturnValue(undefined);
    await expect(
      superviseConversation({ conversationId: 'c1', actorUserId: 'a', modelOverride: 'bogus' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runSupervisorAssessment).not.toHaveBeenCalled();
  });

  it('resolves the configured judge model, with an explicit override taking precedence', async () => {
    await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
    expect(getModel).toHaveBeenCalledWith('judge-x'); // JUDGE_MODEL, no default lookup needed
    expect(getDefaultModelForTask).not.toHaveBeenCalled();

    vi.mocked(getModel).mockClear();
    await superviseConversation({
      conversationId: 'c1',
      actorUserId: 'a',
      modelOverride: 'model-z',
    });
    expect(getModel).toHaveBeenCalledWith('model-z');
  });

  it("tells the call-time provider gate an operator's choice is 'explicit'", async () => {
    await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
    expect(getProvider).toHaveBeenCalledWith('openai', {
      task: 'chat',
      source: 'explicit',
      primarySlug: null,
    });
  });

  it("tells the call-time provider gate the task default is 'primary'", async () => {
    judgeModel.value = undefined;
    vi.mocked(getDefaultModelForTask).mockResolvedValue('default-chat');
    try {
      await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
    } finally {
      judgeModel.value = 'judge-x';
    }
    expect(getModel).toHaveBeenCalledWith('default-chat');
    expect(getProvider).toHaveBeenCalledWith('openai', {
      task: 'chat',
      source: 'primary',
      primarySlug: null,
    });
  });

  it('propagates the surface gate (non-framework conversation rejected upstream)', async () => {
    vi.mocked(loadFrameworkConversation).mockRejectedValue(new ValidationError('not a framework'));
    await expect(
      superviseConversation({ conversationId: 'c1', actorUserId: 'a' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  describe('the llmCall shim passed to the supervisor', () => {
    it('calls the provider, bills cost against the conversation, and returns the shaped result', async () => {
      const chat = vi.fn().mockResolvedValue({
        content: 'the verdict',
        usage: { inputTokens: 100, outputTokens: 40 },
      });
      vi.mocked(getProvider).mockResolvedValue({ chat } as never);

      await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
      const shim = vi.mocked(runSupervisorAssessment).mock.calls[0][0].llmCall;

      const out = await shim('a prompt', { temperature: 0.2 });

      expect(chat).toHaveBeenCalledWith([{ role: 'user', content: 'a prompt' }], {
        model: 'judge-x',
        temperature: 0.2,
      });
      expect(calculateCost).toHaveBeenCalledWith('judge-x', 100, 40);
      expect(logCost).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'c1', operation: 'evaluation' })
      );
      expect(out).toEqual({ content: 'the verdict', tokensUsed: 140, costUsd: 0.03 });
    });

    it('warns (but does not throw) when cost logging fails — Error and non-Error rejections', async () => {
      vi.mocked(logCost)
        .mockRejectedValueOnce(new Error('db down'))
        .mockRejectedValueOnce('a plain string, not an Error');
      await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
      const shim = vi.mocked(runSupervisorAssessment).mock.calls[0][0].llmCall;

      // Both invocations resolve despite the cost-log rejection (fire-and-forget .catch()).
      await expect(shim('p', { temperature: 0 })).resolves.toBeDefined();
      await expect(shim('p', { temperature: 0 })).resolves.toBeDefined();
      await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(2));
      expect(logger.warn).toHaveBeenCalledWith(
        'framework conversation supervisor: cost log failed',
        expect.objectContaining({ conversationId: 'c1' })
      );
    });
  });

  it('audits under the contextType when the conversation has no contextId', async () => {
    vi.mocked(loadFrameworkConversation).mockResolvedValue({
      id: 'c1',
      contextType: 'module',
      contextId: null,
    });
    await superviseConversation({ conversationId: 'c1', actorUserId: 'a' });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ entityName: 'module' }));
  });
});
