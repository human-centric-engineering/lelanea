/**
 * Framework-rubric scoring (f-governance-plus t-3, spec §5.5 F14) — the per-turn face of the
 * `eval-judge-framework-rubric` judge (a platform agent: `rubric-judge.ts`). f-eval shipped the three named metrics
 * (faithfulness/groundedness/relevance) + the whole-conversation supervisor; this complements them
 * with a single framework-specific rubric score per turn (did the assistant serve the
 * facilitation/module purpose?), persisted to `FrameworkConversationEval.rubricScore`.
 *
 * Parallels `score-conversation.ts`: same framework-surface gate + turn reader, idempotent upsert per
 * `messageId`, a failed judge (`score: null`) skips the turn rather than aborting. The rubric score +
 * reasoning live in their OWN columns (`rubricScore` / `rubricReasoning`) — NOT merged into the
 * metric scorer's `judgeReasoning` — so the two writers never clobber each other and there's no
 * read-modify-write race on a shared JSON blob. The judge's cost is added to `costUsd`.
 */

import type { FrameworkConversationEval, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { logger } from '@/lib/logging';
import { driveJudgeAgent } from '@/lib/orchestration/evaluations/judge-driver';
import { loadFrameworkConversation } from '@/lib/framework/facilitation/evaluation/conversation';
import { listScorableTurns } from '@/lib/framework/facilitation/evaluation/turns';
import { FRAMEWORK_RUBRIC_JUDGE_SLUG } from '@/lib/framework/facilitation/evaluation/rubric-judge';

/** Re-exported from its new home (`rubric-judge.ts`, Hub t-142) so a deep import keeps compiling. */
export { FRAMEWORK_RUBRIC_JUDGE_SLUG };

const ENTITY_TYPE = 'framework_conversation_eval';

export interface RubricScoreConversationArgs {
  conversationId: string;
  /** The actor the judge call attributes to (ownership-scoped reads + cost); also the audit actor. */
  actorUserId: string;
  clientIp?: string | null;
}

export interface RubricScoreConversationResult {
  conversationId: string;
  scoredTurns: number;
  skippedTurns: number;
  totalCostUsd: number;
  totalTokensUsed: number;
  results: FrameworkConversationEval[];
}

/** Map the judge's citation shape from the turn's citations (marker/documentName/excerpt). */
function judgeCitations(
  citations: { marker?: number; documentName?: string | null; excerpt?: string }[]
): { marker: number; documentName: string | null; excerpt: string }[] {
  return citations.map((c, i) => ({
    marker: c.marker ?? i + 1,
    documentName: c.documentName ?? null,
    excerpt: c.excerpt ?? '',
  }));
}

/**
 * Score every turn of a framework conversation with the framework-rubric judge and persist each
 * result to `rubricScore` (upsert per turn). Throws `NotFoundError` (unknown conversation) or
 * `ValidationError` (not a framework surface).
 */
export async function rubricScoreConversation(
  args: RubricScoreConversationArgs
): Promise<RubricScoreConversationResult> {
  const { conversationId, actorUserId, clientIp } = args;

  const conversation = await loadFrameworkConversation(conversationId);
  const turns = await listScorableTurns(conversationId);

  const results: FrameworkConversationEval[] = [];
  let skippedTurns = 0;
  let totalCostUsd = 0;
  let totalTokensUsed = 0;

  for (const turn of turns) {
    const judged = await driveJudgeAgent({
      agentSlug: FRAMEWORK_RUBRIC_JUDGE_SLUG,
      userId: actorUserId,
      question: turn.userQuestion,
      answer: turn.aiResponse,
      citations: judgeCitations(turn.citations),
    });
    totalCostUsd += judged.costUsd;
    totalTokensUsed += judged.tokenUsage.input + judged.tokenUsage.output;

    if (judged.score === null) {
      // The judge failed (provider down / malformed response) — skip this turn, don't abort.
      logger.warn('Skipping a turn whose rubric scoring failed', {
        conversationId,
        messageId: turn.messageId,
        errorCode: judged.errorCode,
      });
      skippedTurns += 1;
      continue;
    }

    // Rubric score + reasoning live in their OWN columns — no read of the shared judgeReasoning, so no
    // clobber of / race with the metric scorer (see the module header).
    const rubricReasoning: Prisma.InputJsonValue = {
      reasoning: judged.reasoning,
      steps: judged.evaluationSteps ?? null,
    };

    const row = await prisma.frameworkConversationEval.upsert({
      where: { messageId: turn.messageId },
      create: {
        messageId: turn.messageId,
        conversationId,
        contextType: conversation.contextType,
        contextId: conversation.contextId,
        rubricScore: judged.score,
        rubricReasoning,
        costUsd: judged.costUsd,
        scoredAt: new Date(),
      },
      update: {
        rubricScore: judged.score,
        rubricReasoning,
        costUsd: { increment: judged.costUsd },
      },
    });
    results.push(row);
  }

  logAdminAction({
    userId: actorUserId,
    action: 'framework_conversation_eval.rubric',
    entityType: ENTITY_TYPE,
    entityId: conversationId,
    entityName: conversation.contextId ?? conversation.contextType,
    metadata: {
      conversationId,
      contextType: conversation.contextType,
      scoredTurns: results.length,
      skippedTurns,
      totalCostUsd,
    },
    clientIp: clientIp ?? null,
  });

  return {
    conversationId,
    scoredTurns: results.length,
    skippedTurns,
    totalCostUsd,
    totalTokensUsed,
    results,
  };
}
