/**
 * `registerModels(infos, { source: 'code' })` — exact figures a fork registers
 * from code, which a matrix hydrate must not overwrite (Lelañea divergence
 * row 30).
 *
 * Since Sunrise 0.14.0 every entry `registerModels` creates is matrix-owned, so
 * the next hydrate replaces its price and context with the row's, zero
 * included. That is right for an operator's row and wrong for a fork's exact
 * rate: Lelañea's pinned model was repriced at $0 within a minute of boot. The
 * option gives a code registration the standing the static map and OpenRouter
 * already have. Without it, nothing changes — the first case proves it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelInfo } from '@/lib/orchestration/llm/types';

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const registry = await import('@/lib/orchestration/llm/model-registry');

const originalFetch = globalThis.fetch;

const ID = 'example-model-2026-01-01';

/** What a fork knows exactly: a split rate and the real window. */
const EXACT: ModelInfo = {
  id: ID,
  name: 'Example (exact)',
  provider: 'openai',
  tier: 'budget',
  inputCostPerMillion: 0.15,
  outputCostPerMillion: 0.6,
  maxContext: 128_000,
  supportsTools: true,
};

/** What a hydrate makes of a null-cost matrix row with an `n_a` context. */
const UNPRICED_ROW: ModelInfo = {
  ...EXACT,
  name: 'Example (matrix row)',
  inputCostPerMillion: 0,
  outputCostPerMillion: 0,
  maxContext: 0,
  pricingUnknown: true,
};

/** An OpenRouter catalogue, optionally carrying the id at its own price. */
function catalogue(withId: boolean) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      data: withId
        ? [
            {
              id: `openai/${ID}`,
              name: 'Example (OpenRouter)',
              context_length: 64_000,
              pricing: { prompt: '0.0000002', completion: '0.0000008' },
            },
          ]
        : [],
    }),
  });
}

beforeEach(() => {
  registry.__resetForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("registerModels' code source", () => {
  it('changes nothing when it is not asked for: a default registration is still matrix-owned', () => {
    registry.registerModels([EXACT]);
    registry.registerModels([UNPRICED_ROW]);

    expect(registry.getModel(ID)?.inputCostPerMillion).toBe(0);
    expect(registry.isMatrixOwnedFigure(ID, 'input')).toBe(true);
  });

  it('keeps the exact rate and window when an unpriced row hydrates after it', () => {
    registry.registerModels([EXACT], { source: 'code' });
    registry.registerModels([UNPRICED_ROW]);

    const model = registry.getModel(ID);
    expect(model?.inputCostPerMillion).toBe(0.15);
    expect(model?.outputCostPerMillion).toBe(0.6);
    expect(model?.maxContext).toBe(128_000);
    expect(model?.pricingUnknown).toBeUndefined();
    expect(registry.isMatrixOwnedFigure(ID, 'input')).toBe(false);
  });

  it('corrects an unpriced row that hydrated first, and holds against the next hydrate', () => {
    registry.registerModels([UNPRICED_ROW]);
    registry.registerModels([EXACT], { source: 'code' });
    registry.registerModels([UNPRICED_ROW]);

    expect(registry.getModel(ID)?.inputCostPerMillion).toBe(0.15);
    expect(registry.getModel(ID)?.pricingUnknown).toBeUndefined();
  });

  it("is not the matrix's last batch, so a refresh still restores the matrix's rows", async () => {
    registry.registerModels([{ ...UNPRICED_ROW, id: 'matrix-only' }]);
    registry.registerModels([EXACT], { source: 'code' });
    catalogue(false);

    await registry.refreshFromOpenRouter({ force: true });

    expect(registry.getModel('matrix-only')).toBeDefined();
  });

  it('survives a catalogue refresh that does not know the id', async () => {
    registry.registerModels([EXACT], { source: 'code' });
    registry.registerModels([UNPRICED_ROW]);
    catalogue(false);

    await registry.refreshFromOpenRouter({ force: true });

    expect(registry.getModel(ID)?.inputCostPerMillion).toBe(0.15);
    expect(registry.getModel(ID)?.maxContext).toBe(128_000);
  });

  it("gives way to the catalogue's own price on a refresh that does know the id", async () => {
    registry.registerModels([EXACT], { source: 'code' });
    catalogue(true);

    await registry.refreshFromOpenRouter({ force: true });

    expect(registry.getModel(ID)?.inputCostPerMillion).toBeCloseTo(0.2, 10);
  });
});
