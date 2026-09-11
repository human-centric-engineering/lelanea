/**
 * `syncFrameworkForSeed` unit tests (#158).
 *
 * The whole value of this seam is **ordering and failure behaviour**, so that is
 * what is asserted — not that it calls three functions, but that it calls them in
 * the one order that produces correct rows, and that it fails loudly where the
 * server-boot bridge deliberately does not.
 *
 * Why order is the contract: `syncFramework()` RECONCILES the module registry into
 * rows. Run it before the leaf has registered its modules and it does not merely
 * write an incomplete picture — it flags partially-registered modules as
 * **removed**. "Leaf registration happens between the two" is therefore a
 * correctness property, not a stylistic one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls: string[] = [];

const initFramework = vi.fn(() => {
  calls.push('initFramework');
});
const syncFramework = vi.fn(async () => {
  calls.push('syncFramework');
});

vi.mock('@/lib/framework', () => ({ initFramework, syncFramework }));

const { syncFrameworkForSeed } = await import('@/lib/framework/seed');

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  initFramework.mockImplementation(() => {
    calls.push('initFramework');
  });
  syncFramework.mockImplementation(async () => {
    calls.push('syncFramework');
  });
});

describe('syncFrameworkForSeed — ordering', () => {
  it('registers the leaf BETWEEN framework registration and the DB reconcile', async () => {
    await syncFrameworkForSeed({
      registerLeaf: async () => {
        calls.push('registerLeaf');
      },
    });

    expect(calls).toEqual(['initFramework', 'registerLeaf', 'syncFramework']);
  });

  it('awaits an async leaf hook before reconciling, not merely invokes it', async () => {
    // The failure this guards: a missing `await` would let `syncFramework()` run
    // against a registry the leaf had not finished populating — the exact state
    // that makes the reconcile treat modules as removed.
    await syncFrameworkForSeed({
      registerLeaf: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            calls.push('registerLeaf');
            resolve();
          }, 10);
        }),
    });

    expect(calls).toEqual(['initFramework', 'registerLeaf', 'syncFramework']);
  });

  it('still runs the sequence when no leaf hook is supplied', async () => {
    await syncFrameworkForSeed();
    expect(calls).toEqual(['initFramework', 'syncFramework']);
  });

  it('is callable twice — both steps are idempotent by design', async () => {
    await syncFrameworkForSeed();
    await syncFrameworkForSeed();

    expect(calls).toEqual(['initFramework', 'syncFramework', 'initFramework', 'syncFramework']);
  });
});

describe('syncFrameworkForSeed — failure is loud', () => {
  // The difference from `lib/app/bootstrap.ts`'s `initApp()`, which wraps both
  // halves in try/catch that logs and continues. Right for server boot; wrong for
  // a seed, where the runner would record the unit as applied and strand every
  // later seed behind a missing `Module` row.

  it('propagates a framework-registration failure', async () => {
    const boom = new Error('registration blew up');
    initFramework.mockImplementation(() => {
      throw boom;
    });

    await expect(syncFrameworkForSeed()).rejects.toBe(boom);
    expect(syncFramework).not.toHaveBeenCalled();
  });

  it('propagates a leaf-registration failure, and does NOT reconcile after it', async () => {
    const boom = new Error('leaf blew up');

    await expect(syncFrameworkForSeed({ registerLeaf: () => Promise.reject(boom) })).rejects.toBe(
      boom
    );
    // Load-bearing: reconciling a half-populated registry would flag the leaf's
    // partially-registered modules as removed. Failing is the safe outcome.
    expect(syncFramework).not.toHaveBeenCalled();
  });

  it('propagates a sync failure', async () => {
    const boom = new Error('db unreachable');
    syncFramework.mockImplementation(() => Promise.reject(boom));

    await expect(syncFrameworkForSeed()).rejects.toBe(boom);
  });
});
