/**
 * Startup names each module from its row (f-content-seeds t-87).
 *
 * `initLeafApp()` registers the seventeen modules twice: from the code roster,
 * synchronously, so the registry is complete whatever happens next; then again
 * from the `app_journey_module` rows, which own each title. These cases pin
 * that order and its one failure mode — the rows cannot be read — which must
 * leave a complete registry and a log line, never a throw (a throw here skips
 * the framework sync; see `lib/app/bootstrap.ts`).
 *
 * Everything else `initLeafApp()` registers is pinned in its row in
 * `tests/unit/lib/app/defaults.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this runs the real `leaf-bootstrap` seam
 * ---------------------------------------------------------------------------
 * The seventeen modules and their titles are Lelañea's. A fork that registers
 * its modules from a different source keeps the three properties — every slug
 * before any read, names from the rows, a complete registry when the read
 * fails — and pins its own names.
 *
 * @see lib/app/leaf-bootstrap.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);

import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { LELANEA_MODULE_COUNT } from '@/lib/app/modules/definitions';
import {
  __resetModuleRegistryForTests,
  getRegisteredModule,
  getRegisteredModules,
} from '@/lib/framework/modules/registry';
import { __resetErasureCleanupHooksForTests } from '@/lib/privacy/erasure-hooks';
import { fakeJourneyStore } from '@/tests/helpers/app/content-stores';

const store = fakeJourneyStore();

beforeEach(() => {
  vi.clearAllMocks();
  store.reset();
  __resetModuleRegistryForTests();
  __resetErasureCleanupHooksForTests();
});

describe('initLeafApp — the modules', () => {
  it('names every module from its row', async () => {
    store.editModule('module_11_curiosity_of_self', { title: 'Curiosity, as she renamed it' });

    await initLeafApp();

    expect(getRegisteredModules()).toHaveLength(LELANEA_MODULE_COUNT);
    expect(getRegisteredModule('values')?.name).toBe('Values');
    expect(getRegisteredModule('curiosity-of-self')?.name).toBe('Curiosity, as she renamed it');
    expect(warn).not.toHaveBeenCalled();
  });

  it('registers every slug before it reads anything', async () => {
    let registeredAtRead = -1;
    store.getJourneyStructure.mockImplementationOnce(async () => {
      registeredAtRead = getRegisteredModules().length;
      throw new Error('unreachable');
    });

    await initLeafApp();

    expect(registeredAtRead).toBe(LELANEA_MODULE_COUNT);
  });

  it('keeps the roster’s registration, and says so, when the rows cannot be read', async () => {
    store.empty();

    await expect(initLeafApp()).resolves.toBeUndefined();

    expect(getRegisteredModules()).toHaveLength(LELANEA_MODULE_COUNT);
    expect(getRegisteredModule('curiosity-of-self')?.name).toBe('Curiosity of self');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('module names could not be read'),
      expect.objectContaining({ error: expect.stringContaining('No journey in the database') })
    );
  });
});
