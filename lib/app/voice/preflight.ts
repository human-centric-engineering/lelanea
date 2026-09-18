/**
 * What a voice test would run on, and roughly what it would cost — before it runs.
 *
 * The button used to be the only thing on the page that said anything about the
 * run, and it said "Run the voice test". An operator pressing it could not see
 * which model was about to answer, or that pressing it spends real money twice
 * over — both arms answer every question, and a judge scores every answer. The
 * platform can already work both facts out; nothing was asking it.
 *
 * ## It is an estimate, and it says so
 *
 * `estimateEvaluationRunCost` is planning-grade by construction: with fewer than
 * three comparable past runs it prices a per-case token shape and hands back a
 * ±50%/×2 range. Rendering a bare midpoint would turn that into a quote. The
 * range and the basis travel with the number so the surface can show both.
 *
 * ## Why it estimates each arm separately and adds them
 *
 * A comparison is two platform runs, and the estimator's unit is one run. Both
 * arms answer the same cases with the same judge, so the two estimates are
 * usually equal — but they are only *guaranteed* equal while the arms stay
 * comparable, which is exactly what `assertArmsComparable` refuses to assume.
 * Doubling one arm would report a wrong total for the misconfigured install the
 * guard exists to catch, and that install is the one whose cost an operator most
 * wants to see before pressing anything.
 *
 * ## It never throws
 *
 * This is decoration on a page whose job is the comparison itself. A missing
 * dataset, an unseeded judge, a model with no pricing — every one of those is a
 * real state, and none is a reason to fail the page. The unavailable parts come
 * back `null` and the surface omits them.
 *
 * @see lib/orchestration/cost-estimation/evaluation-cost.ts — the platform estimator
 * @see lib/app/voice/comparison.ts — what actually gets queued
 * @see .context/app/voice.md
 */

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { ensurePinnedModelPriced } from '@/lib/app/agent/pinned-model';
import { getVoiceGoldenSet } from '@/lib/app/content';
import { resolveVoiceArms } from '@/lib/app/voice/comparison';
import { BRAND_VOICE_JUDGE_SLUG, goldenSetDatasetId } from '@/lib/app/voice/golden-set';
import { estimateEvaluationRunCost } from '@/lib/orchestration/cost-estimation/evaluation-cost';

/** What one arm would run on, for the operator rather than for the queue. */
export interface VoicePreflightArm {
  arm: string;
  agentSlug: string;
  /**
   * The model the arm is BOUND to, or `null` when it is bound to none.
   *
   * Both voice agents are created with an empty `model` and pinned afterwards
   * by `005-agent-models.ts`, so `null` means an arm that pin has not reached —
   * it would resolve to the install default. That is reported rather than
   * papered over with the default's name, because one arm bound and one not is
   * exactly the state `assertArmsComparable` checks for. `modelId` on the
   * estimate carries what would actually answer.
   */
  boundModel: string | null;
}

export interface VoicePreflight {
  /** Questions in the seeded set, or `null` when it is not seeded. */
  caseCount: number | null;
  arms: VoicePreflightArm[];
  /** What would actually answer, resolved through the agent → install-default chain. */
  modelId: string | null;
  /** Null when the estimate could not be made — an unseeded set, a missing judge. */
  cost: {
    midUsd: number;
    lowUsd: number;
    highUsd: number;
    basedOn: 'empirical' | 'heuristic';
    /** True when every model in the mix had a published rate. */
    pricingKnown: boolean;
    notes: string;
  } | null;
}

/**
 * @param userId The admin asking. The platform's estimator scopes its empirical
 *   calibration to one user's own past runs — `AiEvaluationRun.userId` is the
 *   ownership column, and another admin's aggregate spend is not this one's to
 *   read. An id with no history behind it simply falls through to the heuristic,
 *   which is the honest basis for "we have not run this yet".
 */
export async function getVoicePreflight(userId: string): Promise<VoicePreflight> {
  const goldenSet = getVoiceGoldenSet();
  const datasetId = goldenSetDatasetId(goldenSet.collection.version);

  const [arms, dataset] = await Promise.all([
    resolveVoiceArms().catch(() => []),
    prisma.aiDataset
      .findUnique({ where: { id: datasetId }, select: { caseCount: true } })
      .catch(() => null),
  ]);

  const preflight: VoicePreflight = {
    caseCount: dataset?.caseCount ?? null,
    arms: arms.map((arm) => ({
      arm: arm.arm,
      agentSlug: arm.agentSlug,
      boundModel: arm.binding.model === '' ? null : arm.binding.model,
    })),
    modelId: null,
    cost: null,
  };

  if (arms.length === 0 || !dataset || dataset.caseCount === 0) return preflight;

  // The estimator prices from the in-memory registry and never resolves a
  // provider, so the seam that teaches the registry her pinned model's rate does
  // not run on this path. Without this the estimate for the dated id depends on
  // OpenRouter answering, and reads as unpriced whenever it does not — while the
  // rate sits in this repo. See `lib/app/agent/pinned-model.ts`.
  ensurePinnedModelPriced();

  try {
    const estimates = await Promise.all(
      arms.map((arm) =>
        estimateEvaluationRunCost({
          subjectKind: 'agent',
          agentId: arm.agentId,
          judgeAgentSlugs: [BRAND_VOICE_JUDGE_SLUG],
          datasetId,
          userId,
        })
      )
    );

    const mix = estimates.flatMap((estimate) => estimate.modelMix);
    preflight.modelId = mix.find((entry) => entry.role === 'subject')?.modelId ?? null;
    preflight.cost = {
      midUsd: sum(estimates.map((estimate) => estimate.midUsd)),
      lowUsd: sum(estimates.map((estimate) => estimate.lowUsd)),
      highUsd: sum(estimates.map((estimate) => estimate.highUsd)),
      // The weaker of the two bases, not the first: an estimate is only as
      // trustworthy as the arm with less history behind it.
      basedOn: estimates.every((estimate) => estimate.basedOn === 'empirical')
        ? 'empirical'
        : 'heuristic',
      // A model with no published rate contributes $0, which would otherwise
      // read as a cheap run rather than an unpriced one.
      pricingKnown: mix.every((entry) => entry.pricingKnown),
      notes: estimates[0]?.notes ?? '',
    };
  } catch (error) {
    // Logged, not surfaced: the page's job is the comparison, and an operator
    // who cannot see an estimate is better off than one who cannot see the page.
    logger.warn('Voice preflight cost estimate failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return preflight;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
