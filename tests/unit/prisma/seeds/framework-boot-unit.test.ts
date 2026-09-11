/**
 * The framework boot seed's WIRING (#158).
 *
 * Its sibling `tests/unit/prisma/framework-boot-seed.test.ts` pins where this unit
 * runs; this pins what it does when it runs. The unit body is two lines, so the
 * temptation is to call it too thin to test — but one of those lines carries an
 * invariant nothing else catches:
 *
 * **it must pass `registerLeaf`.** Drop that argument and nothing fails. The seed
 * still runs, still reports success, still writes its `SeedHistory` row — and
 * `syncFramework()` reconciles a registry the leaf never registered into, which
 * does not merely miss the leaf's modules but treats them as **removed**. A silent
 * wrong answer, in the one place a leaf cannot see it happening.
 *
 * So this asserts the seam is called with the leaf hook, and that a failure
 * propagates rather than being swallowed into a unit the runner marks applied.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const syncFrameworkForSeed = vi.fn(async () => {});
const initLeafApp = vi.fn(async () => {});

vi.mock('@/lib/framework/seed', () => ({ syncFrameworkForSeed }));
vi.mock('@/lib/app/leaf-bootstrap', () => ({ initLeafApp }));

const unit = (await import('@/prisma/seeds/_framework/000-framework-boot')).default;

const ctx = () => ({
  prisma: {} as never,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
});

beforeEach(() => {
  vi.clearAllMocks();
  syncFrameworkForSeed.mockImplementation(async () => {});
});

describe('framework boot seed unit', () => {
  it('is a well-formed SeedUnit the runner will accept', () => {
    // `applySeed` throws "must default-export a SeedUnit { name, run }" otherwise,
    // and it does so at seed time, not build time.
    expect(unit.name).toBe('framework-boot');
    expect(typeof unit.run).toBe('function');
  });

  it('passes the leaf hook to the seam — the invariant nothing else catches', async () => {
    await unit.run(ctx());

    expect(syncFrameworkForSeed).toHaveBeenCalledOnce();
    expect(syncFrameworkForSeed).toHaveBeenCalledWith({ registerLeaf: initLeafApp });
  });

  it('propagates a sync failure instead of reporting a successful seed', async () => {
    const boom = new Error('db unreachable');
    syncFrameworkForSeed.mockImplementation(() => Promise.reject(boom));

    // The runner only writes a `SeedHistory` row after `run()` resolves, so
    // throwing is what stops a failed boot being recorded as applied — and every
    // later seed failing behind a missing `Module` row instead.
    await expect(unit.run(ctx())).rejects.toBe(boom);
  });
});
