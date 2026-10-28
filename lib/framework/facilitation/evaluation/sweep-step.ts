/**
 * Scheduled eval sweep workflow step (f-governance-plus t-3, spec §5.5 F14) — the scheduling seam
 * for framework conversation evaluation. f-eval shipped the scorers on-demand + per-conversation;
 * there is no framework periodic-task hook (the maintenance tick is Sunrise-owned + hard-coded), so
 * the fork-lawful way to run them on a schedule is a custom workflow STEP TYPE (the same
 * `registerStepType` seam f-overlays' proactive sweep uses): an operator authors a one-step workflow
 * of type `framework_eval_sweep` and points an `AiWorkflowSchedule` cron at it.
 *
 * The step selects recent framework conversations never scored yet (`recent-conversations.ts`) and
 * runs the enabled passes over each — supervisor + rubric by default, metric scoring (3 judge
 * calls/turn) opt-in. It attributes the eval calls to the service account (never the person who ran
 * it — see `resolveActorUserId`), and
 * self-enforces the execution's `budgetLimitUsd` inside the loop as a hard cost fence (the engine
 * only checks the budget BETWEEN steps, and this is one long step). The fence is checked at
 * CONVERSATION granularity — a single conversation runs all its passes to completion before the fence
 * can trip, so a very long conversation can overshoot the cap by one conversation's worth of judge
 * calls; keep `maxConversations` and per-conversation turn counts in mind when setting the budget. A
 * conversation that fails a pass (e.g. no scorable turns) is skipped, not fatal — except a monthly
 * spend cap's refusal (Sunrise 0.15.0), which every later conversation would meet too: the step
 * stops there and fails under the cap's code. Daybreak ships the
 * step type but seeds NO workflow/schedule row — a fresh fork boots clean; the operator wires it when
 * they want it. (`tokensUsed` reports the supervisor + rubric judge tokens; the opt-in metric scorer
 * surfaces cost only, so its tokens are logged via the underlying judge calls, not re-summed here.)
 *
 * Registered from `initFramework()` (server boot), not the core executor barrel, so it never affects
 * the core BE↔FE step-registry parity.
 */

import { z } from 'zod';
import type { StepResult, WorkflowStep } from '@/types/orchestration';
import type { ExecutionContext } from '@/lib/orchestration/engine/context';
import { registerStepType } from '@/lib/orchestration/engine/executor-registry';
import { ExecutorError } from '@/lib/orchestration/engine/errors';
import { prisma } from '@/lib/db/client';
import { runAcrossOwners } from '@/lib/auth/subject-context';
import { asSpendCapRefusal } from '@/lib/framework/shared/spend-caps';
import { serviceAccountWhere } from '@/lib/auth/account';
import { scoreConversation } from '@/lib/framework/facilitation/evaluation/score-conversation';
import { superviseConversation } from '@/lib/framework/facilitation/evaluation/supervise';
import { rubricScoreConversation } from '@/lib/framework/facilitation/evaluation/rubric';
import { listRecentUnscoredFrameworkConversations } from '@/lib/framework/facilitation/evaluation/recent-conversations';

/** The workflow step type an operator schedules to run the eval sweep. */
export const EVAL_SWEEP_STEP_TYPE = 'framework_eval_sweep';

/** Default number of conversations swept per run. */
const DEFAULT_MAX_CONVERSATIONS = 25;

/**
 * Per-step config. Supervisor + rubric run by default (per-conversation, bounded); metric scoring is
 * opt-in (3 judge calls per turn). At least one pass must be enabled.
 */
const configSchema = z
  .object({
    score: z.boolean().optional(),
    supervise: z.boolean().optional(),
    rubric: z.boolean().optional(),
    maxConversations: z.number().int().min(1).max(500).optional(),
  })
  .optional();

/**
 * Who the eval calls attribute to: always the service account, as for a scheduled run, never the
 * person who started the execution. Each judge turn is saved as a conversation owned by this actor,
 * and it quotes the member's turn it judges: attributed to an org admin, every member's framework
 * turns would sit in that admin's own conversation history. The sweep acts for the org; the
 * execution row still records who started it.
 */
async function resolveActorUserId(step: WorkflowStep): Promise<string> {
  const account = await prisma.user.findFirst({ where: serviceAccountWhere, select: { id: true } });
  if (!account) {
    throw new ExecutorError(
      step.id,
      'NO_ACTOR',
      'framework_eval_sweep has no service account to attribute its judge calls to'
    );
  }
  return account.id;
}

/** The step executor. Exported for direct unit testing; registered via `registerEvalSweepStep`. */
export async function executeEvalSweep(
  step: WorkflowStep,
  ctx: Readonly<ExecutionContext>
): Promise<StepResult> {
  const parsed = configSchema.safeParse(step.config);
  if (!parsed.success) {
    throw new ExecutorError(
      step.id,
      'INVALID_CONFIG',
      `Invalid framework_eval_sweep config: ${parsed.error.issues.map((i) => i.message).join('; ')}`
    );
  }
  const cfg = parsed.data ?? {};
  const doScore = cfg.score ?? false;
  const doSupervise = cfg.supervise ?? true;
  const doRubric = cfg.rubric ?? true;
  if (!doScore && !doSupervise && !doRubric) {
    throw new ExecutorError(
      step.id,
      'INVALID_CONFIG',
      'framework_eval_sweep must enable at least one pass (score, supervise, or rubric)'
    );
  }
  const maxConversations = cfg.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;

  const actorUserId = await resolveActorUserId(step);
  // The sweep evaluates the org's framework conversations, every member's, not the caller's own.
  // Run by an org admin through the org-tier execute route, the engine runs under that admin's
  // narrowed subject, and the owner layer (Sunrise §115) refuses the unconfined conversation and
  // message reads the sweep and its passes make. A scheduled run has no subject; a platform admin
  // is not narrowed — for both this changes nothing. The org wall stays where it is. The whole
  // sweep crosses, not just those reads: its judge turns run as the service account, whose own
  // conversations are another owner's to a narrowed caller. The judges are platform agents with no
  // capabilities and no knowledge, so nothing else inside reads on the crossing.
  return runAcrossOwners(
    "an eval sweep scores the org's framework conversations, not the caller's own",
    () => sweep(step, ctx, { doScore, doSupervise, doRubric, maxConversations, actorUserId })
  );
}

interface SweepPlan {
  doScore: boolean;
  doSupervise: boolean;
  doRubric: boolean;
  maxConversations: number;
  actorUserId: string;
}

async function sweep(
  step: WorkflowStep,
  ctx: Readonly<ExecutionContext>,
  { doScore, doSupervise, doRubric, maxConversations, actorUserId }: SweepPlan
): Promise<StepResult> {
  const conversations = await listRecentUnscoredFrameworkConversations(maxConversations);

  let sweptConversations = 0;
  let failedConversations = 0;
  let totalCostUsd = 0;
  let totalTokensUsed = 0;
  let budgetStopped = false;

  for (const conversation of conversations) {
    try {
      if (doScore) {
        const r = await scoreConversation({ conversationId: conversation.id, actorUserId });
        totalCostUsd += r.totalCostUsd;
      }
      if (doSupervise) {
        const r = await superviseConversation({ conversationId: conversation.id, actorUserId });
        totalCostUsd += r.costUsd;
        totalTokensUsed += r.tokensUsed;
      }
      if (doRubric) {
        const r = await rubricScoreConversation({ conversationId: conversation.id, actorUserId });
        totalCostUsd += r.totalCostUsd;
        totalTokensUsed += r.totalTokensUsed;
      }
      sweptConversations += 1;
    } catch (err) {
      // A monthly spend cap refuses every conversation after this one too: stop, and fail the step
      // with the cap's code (core's `ExecutorError` reads it off the cause), not retried, keeping
      // what the sweep spent before the refusal.
      const capRefusal = asSpendCapRefusal(err);
      if (capRefusal) {
        // The refused conversation may already carry a row from an earlier pass, and the sweep
        // only selects never-scored conversations, so a rerun will not pick it up: name it, for
        // the on-demand scorers.
        throw new ExecutorError(
          step.id,
          capRefusal.code,
          `framework_eval_sweep stopped after ${sweptConversations} of ${conversations.length} conversations; ` +
            `conversation ${conversation.id} may be part-evaluated (re-run its passes on demand once the cap is raised): ` +
            capRefusal.message,
          capRefusal,
          false,
          totalTokensUsed + capRefusal.tokensUsed,
          totalCostUsd + capRefusal.costUsd
        );
      }
      // A single conversation failing a pass (e.g. no scorable turns) must not abort the whole sweep.
      failedConversations += 1;
      ctx.logger.warn('framework_eval_sweep: skipped a conversation whose pass failed', {
        conversationId: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Hard cost fence: the engine only checks budget between steps, so a long single step must stop
    // itself. `ctx.totalCostUsd` is the cost spent by earlier steps; add this step's running total.
    if (ctx.budgetLimitUsd !== undefined && ctx.totalCostUsd + totalCostUsd >= ctx.budgetLimitUsd) {
      budgetStopped = true;
      break;
    }
  }

  return {
    output: {
      candidateConversations: conversations.length,
      sweptConversations,
      failedConversations,
      passes: { score: doScore, supervise: doSupervise, rubric: doRubric },
      budgetStopped,
      totalCostUsd,
    },
    tokensUsed: totalTokensUsed,
    costUsd: totalCostUsd,
  };
}

/** Register the step executor. Called from `initFramework()`. */
export function registerEvalSweepStep(): void {
  registerStepType(EVAL_SWEEP_STEP_TYPE, executeEvalSweep);
}
