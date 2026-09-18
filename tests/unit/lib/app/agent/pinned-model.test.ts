/**
 * Her pinned model is priced — in a registry that has never heard of it.
 *
 * ## What this is guarding
 *
 * §8.2 makes us pin a dated model id. Sunrise's cost tracker prices from an
 * in-memory registry whose static map knows the alias and not the snapshot, and
 * nothing on the chat path or in the evaluation worker warms that registry. So
 * in a cold process a turn on her model was costed at **$0**, with a warning in
 * a log nobody reads — which zeroes the golden-set costs today and the meter §08
 * exists to start.
 *
 * The leaf closes that by registering the model's rate from
 * `lib/app/llm-providers.ts`, the one leaf hook Sunrise runs lazily in whichever
 * module graph is about to resolve a provider. These tests start from the static
 * map only — the cold state — because a test that warmed the registry first would
 * pass with the fix deleted.
 *
 * ## Two properties of the platform this depends on, pinned here on purpose
 *
 * `registerModels()` lets a POSITIVE incoming rate override one already present,
 * and lets a ZERO one fall through. That is why the seeded matrix row carries a
 * null cost: the column is one number for both directions, and a blended figure
 * there would replace the exact split the moment anything hydrated from the
 * matrix. If Sunrise changes that merge rule, the row's null stops being the
 * right call and these cases say so.
 *
 * `tests/setup.ts` pins this seam to "registers nothing" for every file, so the
 * real one is read with `vi.importActual` — as `defaults.test.ts` does.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/llm-providers` seam, on purpose
 * ---------------------------------------------------------------------------
 * It asserts what LELAÑEA's fill of that seam does: register one pinned model's
 * rate and no eligibility rule. A fork that fills the seam differently — or
 * registers an eligibility rule there — will see "still registers no eligibility
 * rule" fail, correctly. A fork without her pinned model should delete this file
 * together with `lib/app/agent/pinned-model.ts` and the registration in the seam.
 *
 * @see lib/app/agent/pinned-model.ts
 * @see lib/app/llm-providers.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  PINNED_MODEL,
  PINNED_MODEL_INFO,
  PINNED_PROVIDER,
  ensurePinnedModelPriced,
} from '@/lib/app/agent/pinned-model';
import { PINNED_MODEL_MATRIX_ROW } from '@/lib/app/agent/pins';
import { calculateCost } from '@/lib/orchestration/llm/cost-tracker';
import { dbModelToModelInfo } from '@/lib/orchestration/llm/db-model-adapter';
import {
  __resetForTests as resetRegistry,
  getModel,
  registerModels,
} from '@/lib/orchestration/llm/model-registry';
import {
  hasProviderEligibilityResolver,
  resetProviderEligibility,
} from '@/lib/orchestration/llm/provider-eligibility';
import type { AiProviderModel } from '@/types/prisma';

/** The genuine scaffold, not the global pin. */
async function wireTheRealSeam(): Promise<void> {
  const seam =
    await vi.importActual<typeof import('@/lib/app/llm-providers')>('@/lib/app/llm-providers');
  await seam.registerAppProviderEligibility();
}

/** A turn shaped like hers: a long system prompt in, a short reply out. */
const TOKENS_IN = 3000;
const TOKENS_OUT = 300;
const TRUE_COST = (TOKENS_IN / 1_000_000) * 0.15 + (TOKENS_OUT / 1_000_000) * 0.6;

function costOfATurn(modelId: string = PINNED_MODEL): number {
  return calculateCost(modelId, TOKENS_IN, TOKENS_OUT).totalCostUsd;
}

/** The seeded matrix row as the hydrate path would hand it to the registry. */
function matrixRowAsModelInfo(costPerMillionTokens: number | null) {
  return dbModelToModelInfo({
    ...PINNED_MODEL_MATRIX_ROW,
    capabilities: [...PINNED_MODEL_MATRIX_ROW.capabilities],
    costPerMillionTokens,
    deploymentProfiles: ['hosted'],
    paramProfile: null,
  } as unknown as AiProviderModel);
}

beforeEach(() => {
  resetRegistry();
  resetProviderEligibility();
});

describe('a cold registry', () => {
  it('does not know the dated id, and costs a turn on it at nothing — the hazard', () => {
    // The premise. If Sunrise ever ships this id in its static map, this fails
    // and the seam fill (and its divergence from the seam's purpose) can go.
    expect(getModel(PINNED_MODEL)).toBeUndefined();
    expect(costOfATurn()).toBe(0);
  });

  it('knows the alias, so the cold state is a real registry and not an empty one', () => {
    // Population: "undefined" above is evidence about THIS id only if the
    // registry is answering for others.
    expect(getModel('gpt-4o-mini')).toBeDefined();
    expect(costOfATurn('gpt-4o-mini')).toBeCloseTo(TRUE_COST, 10);
  });
});

describe('once the leaf seam has run', () => {
  it('prices a turn on her model at its true split rate', async () => {
    await wireTheRealSeam();

    expect(costOfATurn()).toBeCloseTo(TRUE_COST, 10);
    // The same as the alias, to the cent: it is the same model.
    expect(costOfATurn()).toBeCloseTo(costOfATurn('gpt-4o-mini'), 10);
  });

  it('resolves to her provider by bare id', async () => {
    await wireTheRealSeam();

    expect(getModel(PINNED_MODEL)?.provider).toBe(PINNED_PROVIDER);
  });

  it('still registers no eligibility rule — the seam is used for its timing only', async () => {
    await wireTheRealSeam();

    // Population: the seam DID run and did something.
    expect(getModel(PINNED_MODEL)).toBeDefined();
    expect(hasProviderEligibilityResolver()).toBe(false);
  });

  it('can run twice without changing the answer', async () => {
    await wireTheRealSeam();
    await wireTheRealSeam();

    expect(costOfATurn()).toBeCloseTo(TRUE_COST, 10);
  });
});

describe('ensurePinnedModelPriced, called directly', () => {
  it('prices the model from cold, with no seam involved', () => {
    // The voice preflight calls this itself: the estimator never resolves a
    // provider, so the seam does not run on that path.
    expect(costOfATurn()).toBe(0);

    ensurePinnedModelPriced();

    expect(costOfATurn()).toBeCloseTo(TRUE_COST, 10);
  });

  it('leaves a rate that is already there alone', () => {
    // What a successful OpenRouter refresh leaves behind: the same id, priced by
    // somebody else. Theirs is the more current number; ours is the fallback.
    registerModels([{ ...PINNED_MODEL_INFO, name: 'From OpenRouter', inputCostPerMillion: 0.2 }]);

    ensurePinnedModelPriced();

    expect(getModel(PINNED_MODEL)?.name).toBe('From OpenRouter');
    expect(getModel(PINNED_MODEL)?.inputCostPerMillion).toBe(0.2);
  });

  it('replaces an entry that is known but unpriced', () => {
    registerModels([{ ...PINNED_MODEL_INFO, inputCostPerMillion: 0, outputCostPerMillion: 0 }]);
    expect(costOfATurn()).toBe(0);

    ensurePinnedModelPriced();

    expect(costOfATurn()).toBeCloseTo(TRUE_COST, 10);
  });
});

describe('the matrix row and the exact rate', () => {
  it('a null-cost row hydrating AFTER the seam leaves the exact rate alone', async () => {
    await wireTheRealSeam();

    registerModels([matrixRowAsModelInfo(PINNED_MODEL_MATRIX_ROW.costPerMillionTokens)]);

    expect(costOfATurn()).toBeCloseTo(TRUE_COST, 10);
  });

  it('a null-cost row hydrating BEFORE the seam is corrected by it', async () => {
    registerModels([matrixRowAsModelInfo(PINNED_MODEL_MATRIX_ROW.costPerMillionTokens)]);
    // Known to the registry, at a rate of zero, with no warning — the quietest
    // version of the hazard.
    expect(getModel(PINNED_MODEL)).toBeDefined();
    expect(costOfATurn()).toBe(0);

    await wireTheRealSeam();

    expect(costOfATurn()).toBeCloseTo(TRUE_COST, 10);
  });

  it('a blended cost on that row WOULD override the exact rate — which is why it is null', async () => {
    await wireTheRealSeam();

    // The platform's own figure for the alias's row: ($0.15 + $0.60) / 2.
    registerModels([matrixRowAsModelInfo(0.375)]);

    // An input-heavy turn, priced at nearly twice what it cost.
    expect(costOfATurn()).toBeGreaterThan(TRUE_COST * 1.9);
    // And so the seeded row must never carry one.
    expect(PINNED_MODEL_MATRIX_ROW.costPerMillionTokens).toBeNull();
  });
});

describe('the matrix row and the context window', () => {
  // The chat handler trims history to `maxContext`. A positive count on the
  // matrix row overrides the registry's on hydrate: `high` budgets 200k against a
  // 128k model, and `medium` — tried first — made her budget depend on whether a
  // hydrate or the leaf's registration wrote last. `n_a` is 0 and falls through.
  it('is 128,000 when the matrix hydrates after the seam', async () => {
    await wireTheRealSeam();

    registerModels([matrixRowAsModelInfo(null)]);

    expect(getModel(PINNED_MODEL)?.maxContext).toBe(128_000);
  });

  it('is 128,000 when the matrix hydrates before the seam', async () => {
    registerModels([matrixRowAsModelInfo(null)]);

    await wireTheRealSeam();

    expect(getModel(PINNED_MODEL)?.maxContext).toBe(128_000);
  });

  it('keeps what the agent form needs when the leaf replaces a hydrated entry', async () => {
    registerModels([matrixRowAsModelInfo(null)]);

    await wireTheRealSeam();

    // An entry with no capabilities has the form greying out toggles until the
    // next hydrate puts them back.
    expect(getModel(PINNED_MODEL)?.capabilities).toEqual([...PINNED_MODEL_MATRIX_ROW.capabilities]);
    expect(getModel(PINNED_MODEL)?.available).toBe(true);
  });
});

describe('the rates are part of the pin', () => {
  it('holds the id and its published rates together', () => {
    // Deliberately a literal. Change `PINNED_MODEL` and this fails until the
    // rates beside it have been looked up again and this line updated with them
    // — the one moment a stale price could otherwise slip through unnoticed.
    expect({
      id: PINNED_MODEL_INFO.id,
      inputCostPerMillion: PINNED_MODEL_INFO.inputCostPerMillion,
      outputCostPerMillion: PINNED_MODEL_INFO.outputCostPerMillion,
    }).toEqual({
      id: 'gpt-4o-mini-2024-07-18',
      inputCostPerMillion: 0.15,
      outputCostPerMillion: 0.6,
    });
  });

  it('is never a free model by accident', () => {
    expect(PINNED_MODEL_INFO.inputCostPerMillion).toBeGreaterThan(0);
    expect(PINNED_MODEL_INFO.outputCostPerMillion).toBeGreaterThan(0);
  });
});
