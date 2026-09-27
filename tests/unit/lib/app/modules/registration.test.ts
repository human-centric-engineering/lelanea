/**
 * The registry holds exactly the seventeen modules after the real leaf boot.
 *
 * This is the load-bearing wiring test for the feature: `initLeafApp()` is what
 * `lib/app/bootstrap.ts` and the seed runner's framework boot both call, and
 * `syncRegisteredModules()` reconciles whatever is in the registry into
 * `framework_module` rows. A definition that exists but is never registered
 * would pass `definitions.test.ts` and still leave the admin list empty.
 *
 * The registry is `globalThis`-backed and shared with every other test in the
 * worker, so it is reset before each case.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/leaf-bootstrap.ts`, not a mock
 * ---------------------------------------------------------------------------
 * `initLeafApp()` is Lelañea's filled boot hook, so what this file measures is
 * what that hook registers: seventeen modules, in the structure file's order.
 * A fork registering a different set pins its own count and slugs here; a fork
 * whose hook registers no modules should expect an empty registry and delete
 * this file rather than loosen it.
 *
 * @see lib/app/leaf-bootstrap.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// `leaf-bootstrap` also registers the waitlist erasure hook, whose module
// imports the Prisma client; stub it so the real seam is exercised without a
// database (the same stub `defaults.test.ts` uses).
// It also reads the discovery questions, which become Onboarding's slots
// (t-101); the set is absent unless a case supplies it.
const findQuestionSet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/client', () => ({
  prisma: {
    appWaitlistEntry: { findMany: vi.fn(async () => []) },
    appQuestionSet: { findUnique: findQuestionSet },
  },
}));

import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { getRegisteredModule } from '@/lib/framework/modules/registry';
import { getModuleDefinitions, LELANEA_MODULE_COUNT } from '@/lib/app/modules/definitions';
import {
  getRegisteredModules,
  __resetModuleRegistryForTests,
} from '@/lib/framework/modules/registry';
import { __resetErasureCleanupHooksForTests } from '@/lib/privacy/erasure-hooks';

beforeEach(() => {
  findQuestionSet.mockReset().mockResolvedValue(null);
  __resetModuleRegistryForTests();
  __resetErasureCleanupHooksForTests();
});

describe('initLeafApp registers the journey modules', () => {
  it('starts from an empty registry, so the count below is ours alone', () => {
    expect(getRegisteredModules()).toEqual([]);
  });

  it('registers exactly seventeen slugs, in the numbered order', async () => {
    await initLeafApp();

    const registered = getRegisteredModules();
    expect(registered).toHaveLength(LELANEA_MODULE_COUNT);
    expect(registered.map((m) => m.slug)).toEqual(getModuleDefinitions().map((d) => d.slug));
  });

  it('is idempotent: a second boot in the same process leaves seventeen, not thirty-four', async () => {
    await initLeafApp();
    __resetErasureCleanupHooksForTests();
    await initLeafApp();

    expect(getRegisteredModules()).toHaveLength(LELANEA_MODULE_COUNT);
  });

  it('gives the module the questions belong to their slots, through the real boot', async () => {
    findQuestionSet.mockResolvedValue({
      moduleId: 'module_00_onboarding',
      questions: [{ id: 'q01', text: 'First?' }],
    });

    await initLeafApp();

    expect(getRegisteredModule('onboarding')?.slotDefinitions).toEqual([
      expect.objectContaining({ slug: 'discovery_q01', description: 'First?' }),
    ]);
    const withSlots = getRegisteredModules().filter((m) => m.slotDefinitions !== undefined);
    expect(withSlots.map((m) => m.slug)).toEqual(['onboarding']);
  });
});
