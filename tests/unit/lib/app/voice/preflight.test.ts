/**
 * What a voice test would run on, and roughly what it would cost.
 *
 * Everything worth pinning here is a failure mode, because the happy path is a
 * pass-through to the platform estimator. The three that matter:
 *
 *  - an unpriced model contributes $0 to the estimate, so reporting the number
 *    without reporting that it is unpriced tells an operator a button that
 *    spends money does not;
 *  - a comparison is two runs, and the surface shows one figure — halving or
 *    doubling either one misreports the spend;
 *  - none of this is a reason to fail the page it decorates.
 *
 * @see lib/app/voice/preflight.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolveVoiceArms, estimateEvaluationRunCost, datasetFindUnique } = vi.hoisted(() => ({
  resolveVoiceArms: vi.fn(),
  estimateEvaluationRunCost: vi.fn(),
  datasetFindUnique: vi.fn(),
}));

vi.mock('@/lib/app/content/golden-set-store', async () => {
  const { buildGoldenSetSeed } = await import('@/lib/app/content/golden-set-seed');
  const seed = buildGoldenSetSeed();
  return {
    VOICE_GOLDEN_SET_ID: seed.id,
    getGoldenSetPointer: vi.fn(() =>
      Promise.resolve({ ...seed, status: 'draft' as const, revision: 1 })
    ),
    seedGoldenSetPointer: vi.fn(),
    GOLDEN_SET_SNAPSHOT_FIELDS: [] as const,
  };
});

vi.mock('@/lib/db/client', () => ({
  prisma: { aiDataset: { findUnique: datasetFindUnique } },
}));
vi.mock('@/lib/app/voice/comparison', () => ({ resolveVoiceArms }));
vi.mock('@/lib/orchestration/cost-estimation/evaluation-cost', () => ({
  estimateEvaluationRunCost,
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getVoicePreflight } from '@/lib/app/voice/preflight';
import { PINNED_MODEL } from '@/lib/app/agent/pinned-model';
import {
  __resetForTests as resetModelRegistry,
  getModel,
} from '@/lib/orchestration/llm/model-registry';

const ADMIN = 'user-admin';

function arm(name: string, slug: string, model: string) {
  return {
    arm: name,
    agentId: `agent-${name}`,
    agentSlug: slug,
    systemPrompt: 'x',
    fingerprintVersion: name === 'fingerprint' ? '1.0' : null,
    brandVoiceInstructions: null,
    binding: { provider: '', model, temperature: 0.7 },
  };
}

function estimate(overrides: Record<string, unknown> = {}) {
  return {
    midUsd: 0.02,
    lowUsd: 0.01,
    highUsd: 0.04,
    basedOn: 'heuristic' as const,
    sampleSize: 0,
    caseCount: 5,
    modelMix: [
      {
        modelId: 'claude-sonnet-5',
        role: 'subject' as const,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.02,
        pricingKnown: true,
      },
    ],
    notes: 'FIXTURE NOTE',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveVoiceArms.mockResolvedValue([
    arm('fingerprint', 'lelanea-guide', ''),
    arm('bare', 'voice-control-bare', ''),
  ]);
  datasetFindUnique.mockResolvedValue({ caseCount: 5 });
  estimateEvaluationRunCost.mockResolvedValue(estimate());
});

describe('getVoicePreflight', () => {
  it('adds both arms up rather than reporting one run’s cost', async () => {
    const preflight = await getVoicePreflight(ADMIN);

    // Two runs of every case plus a judge call each. A single arm's figure would
    // understate the press by half.
    expect(estimateEvaluationRunCost).toHaveBeenCalledTimes(2);
    // Scoped to the caller, or the estimator's empirical mode can never engage
    // and the range stays heuristic-wide no matter how many runs accumulate.
    expect(estimateEvaluationRunCost).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ADMIN })
    );
    expect(preflight.cost?.midUsd).toBeCloseTo(0.04);
    expect(preflight.cost?.lowUsd).toBeCloseTo(0.02);
    expect(preflight.cost?.highUsd).toBeCloseTo(0.08);
  });

  it('teaches the registry her pinned model’s rate before asking for an estimate', async () => {
    // The estimator prices from the registry and never resolves a provider, so
    // the seam that registers the rate does not run on this path. Cold, the
    // dated id is unknown — and the estimate would read as unpriced whenever
    // OpenRouter did not answer, with the rate sitting in this repo.
    resetModelRegistry();
    expect(getModel(PINNED_MODEL)).toBeUndefined();
    let pricedWhenEstimated = false;
    estimateEvaluationRunCost.mockImplementation(async () => {
      pricedWhenEstimated = (getModel(PINNED_MODEL)?.inputCostPerMillion ?? 0) > 0;
      return estimate();
    });

    await getVoicePreflight(ADMIN);

    expect(estimateEvaluationRunCost).toHaveBeenCalled();
    expect(pricedWhenEstimated).toBe(true);
  });

  it('reports the model that would actually answer', async () => {
    const preflight = await getVoicePreflight(ADMIN);

    expect(preflight.modelId).toBe('claude-sonnet-5');
    // Arms the model pin has not reached are bound to nothing and resolve to the
    // install default.
    // Reporting the default as though it were the binding would hide the one
    // state `assertArmsComparable` checks for.
    expect(preflight.arms.map((entry) => entry.boundModel)).toEqual([null, null]);
  });

  it('flags an unpriced model instead of letting $0 read as cheap', async () => {
    estimateEvaluationRunCost.mockResolvedValue(
      estimate({
        midUsd: 0,
        lowUsd: 0,
        highUsd: 0,
        modelMix: [
          {
            modelId: 'some-uncurated-model',
            role: 'subject' as const,
            inputTokens: 100,
            outputTokens: 50,
            costUsd: 0,
            pricingKnown: false,
          },
        ],
      })
    );

    const preflight = await getVoicePreflight(ADMIN);

    expect(preflight.cost?.pricingKnown).toBe(false);
  });

  it('takes the weaker of the two bases rather than the first', async () => {
    // An estimate is only as trustworthy as the arm with less history behind it.
    estimateEvaluationRunCost
      .mockResolvedValueOnce(estimate({ basedOn: 'empirical' }))
      .mockResolvedValueOnce(estimate({ basedOn: 'heuristic' }));

    const preflight = await getVoicePreflight(ADMIN);

    expect(preflight.cost?.basedOn).toBe('heuristic');
  });

  it('reports no cost, and does not throw, when the set is not seeded', async () => {
    datasetFindUnique.mockResolvedValue(null);

    const preflight = await getVoicePreflight(ADMIN);

    expect(preflight.caseCount).toBeNull();
    expect(preflight.cost).toBeNull();
    expect(estimateEvaluationRunCost).not.toHaveBeenCalled();
  });

  it('survives an estimator that throws — the page is the comparisons, not this', async () => {
    estimateEvaluationRunCost.mockRejectedValue(new Error('registry unreachable'));

    const preflight = await getVoicePreflight(ADMIN);

    expect(preflight.cost).toBeNull();
    // The parts that did resolve are still reported: a missing estimate is not a
    // reason to withhold the case count.
    expect(preflight.caseCount).toBe(5);
  });

  it('survives arms that cannot be resolved at all', async () => {
    resolveVoiceArms.mockRejectedValue(new Error('no agents'));

    const preflight = await getVoicePreflight(ADMIN);

    expect(preflight.arms).toEqual([]);
    expect(preflight.cost).toBeNull();
  });
});
