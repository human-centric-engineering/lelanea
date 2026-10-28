/**
 * Framework conversation scoring (f-eval t-1, spec §5.5 F14) — governance's post-hoc face. Runs the
 * existing named-metric scorer (`scoreResponse`, which reuses the core eval judges) over each turn
 * of a framework (`facilitation`/`module`) conversation and persists the scores per turn to
 * `framework_conversation_eval`. The scoring/judge machinery is entirely Sunrise-core; this is the
 * conversation-native adapter.
 *
 * Only framework-surface conversations may be scored (a non-framework conversation is a
 * `ValidationError`). Scoring is idempotent per turn — re-scoring a conversation upserts by
 * `messageId`. A turn whose judges all fail (e.g. no active LLM provider) is skipped, not fatal, so a
 * partial result is still returned. Every run is audited.
 */

import type { FrameworkConversationEval, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { logger } from '@/lib/logging';
import { scoreResponse, type MetricScores } from '@/lib/orchestration/evaluations/score-response';
import { loadFrameworkConversation } from '@/lib/framework/facilitation/evaluation/conversation';
import { listScorableTurns } from '@/lib/framework/facilitation/evaluation/turns';
import {
  spendCapCodeInJudgeText,
  SpendCapRefusedError,
  type SpendCapCode,
} from '@/lib/framework/shared/spend-caps';

const ENTITY_TYPE = 'framework_conversation_eval';

export interface ScoreConversationArgs {
  conversationId: string;
  /** The admin triggering the eval — judge-call cost attributes here, and the audit actor. */
  actorUserId: string;
  clientIp?: string | null;
}

export interface ScoreConversationResult {
  conversationId: string;
  scoredTurns: number;
  skippedTurns: number;
  totalCostUsd: number;
  results: FrameworkConversationEval[];
}

/** The per-metric reasoning blob stored on the eval row. */
function reasoningJson(scores: MetricScores): Prisma.InputJsonValue {
  return {
    faithfulness: {
      reasoning: scores.faithfulness.reasoning,
      steps: scores.faithfulness.evaluationSteps ?? null,
    },
    groundedness: {
      reasoning: scores.groundedness.reasoning,
      steps: scores.groundedness.evaluationSteps ?? null,
    },
    relevance: {
      reasoning: scores.relevance.reasoning,
      steps: scores.relevance.evaluationSteps ?? null,
    },
  };
}

/**
 * Score every turn of a framework conversation and persist the results (upsert per turn). Throws
 * `NotFoundError` (unknown conversation), `ValidationError` (not a framework surface), or
 * `SpendCapRefusedError` once a monthly spend cap refuses a turn — after auditing the turns it
 * scored, and carrying what they cost.
 */
export async function scoreConversation(
  args: ScoreConversationArgs
): Promise<ScoreConversationResult> {
  const { conversationId, actorUserId, clientIp } = args;

  const conversation = await loadFrameworkConversation(conversationId);

  const turns = await listScorableTurns(conversationId);
  const results: FrameworkConversationEval[] = [];
  let skippedTurns = 0;
  let totalCostUsd = 0;
  let capRefusal: { code: SpendCapCode; cause: unknown } | null = null;

  for (const turn of turns) {
    let scored;
    try {
      scored = await scoreResponse({
        userQuestion: turn.userQuestion,
        aiResponse: turn.aiResponse,
        citations: turn.citations,
        userId: actorUserId,
      });
    } catch (err) {
      // A monthly spend cap is reached for every turn after this one too, so stop rather than skip
      // — after auditing what was written. `scoreResponse` keeps only its judges' messages, so the
      // cap is recognised by its words.
      const capCode = err instanceof Error ? spendCapCodeInJudgeText(err.message) : null;
      if (capCode !== null) {
        capRefusal = { code: capCode, cause: err };
        break;
      }
      // All three judges failed for this turn (e.g. no active provider) — skip it, don't abort.
      logger.warn('Skipping a turn whose scoring failed', {
        conversationId,
        messageId: turn.messageId,
        error: err instanceof Error ? err.message : String(err),
      });
      skippedTurns += 1;
      continue;
    }

    totalCostUsd += scored.costUsd;
    // One judge's own agent budget can refuse it while the other two score: the turn is kept with
    // that metric null, which an operator needs to hear about rather than find later.
    const cappedJudges = (Object.keys(scored.scores) as (keyof MetricScores)[]).filter(
      (metric) =>
        scored.scores[metric].score === null &&
        spendCapCodeInJudgeText(scored.scores[metric].reasoning) !== null
    );
    if (cappedJudges.length > 0) {
      logger.warn('A monthly spend cap refused a metric judge; its score is stored as null', {
        conversationId,
        messageId: turn.messageId,
        metrics: cappedJudges,
      });
    }
    const data = {
      conversationId,
      contextType: conversation.contextType,
      contextId: conversation.contextId,
      faithfulness: scored.scores.faithfulness.score,
      groundedness: scored.scores.groundedness.score,
      relevance: scored.scores.relevance.score,
      judgeReasoning: reasoningJson(scored.scores),
      costUsd: scored.costUsd,
      scoredAt: new Date(),
    };
    const row = await prisma.frameworkConversationEval.upsert({
      where: { messageId: turn.messageId },
      create: { messageId: turn.messageId, ...data },
      update: data,
    });
    results.push(row);
  }

  logAdminAction({
    userId: actorUserId,
    action: 'framework_conversation_eval.score',
    entityType: ENTITY_TYPE,
    entityId: conversationId,
    entityName: conversation.contextId ?? conversation.contextType,
    metadata: {
      conversationId,
      contextType: conversation.contextType,
      scoredTurns: results.length,
      skippedTurns,
      totalCostUsd,
      ...(capRefusal ? { stoppedBy: capRefusal.code } : {}),
    },
    clientIp: clientIp ?? null,
  });

  if (capRefusal) {
    throw new SpendCapRefusedError(capRefusal.code, undefined, {
      cause: capRefusal.cause,
      costUsd: totalCostUsd,
    });
  }

  return { conversationId, scoredTurns: results.length, skippedTurns, totalCostUsd, results };
}
