/**
 * The Core Set switch as Onboarding stores it (f-onboarding t-101).
 *
 * Every failure falls back to asking every question, and each one is logged:
 * a null config column, a stored value the schema refuses, and a read that
 * throws (an Error or anything else). A fallback that returned the wrong
 * default would ask a person only the core questions without anyone choosing
 * that.
 *
 * @see lib/app/onboarding/discovery-config-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getConfigForm = vi.hoisted(() => vi.fn());
vi.mock('@/lib/framework/modules/config', () => ({ getModuleConfigForm: getConfigForm }));

const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: loggerMock }));

import { readDiscoveryConfig } from '@/lib/app/onboarding/discovery-config-store';

function form(values: unknown) {
  return { registered: true, descriptors: [], values };
}

describe('readDiscoveryConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the stored switch, read from the named module', async () => {
    getConfigForm.mockResolvedValue(form({ coreSetOnly: true }));

    await expect(readDiscoveryConfig('onboarding')).resolves.toEqual({ coreSetOnly: true });
    expect(getConfigForm).toHaveBeenCalledWith('onboarding');
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('reads a module that has never saved its config as off, without logging', async () => {
    getConfigForm.mockResolvedValue(form(null));

    await expect(readDiscoveryConfig('onboarding')).resolves.toEqual({ coreSetOnly: false });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('asks every question when the stored config is refused by the schema, and logs it', async () => {
    getConfigForm.mockResolvedValue(form({ coreSetOnly: true, stray: 1 }));

    await expect(readDiscoveryConfig('onboarding')).resolves.toEqual({ coreSetOnly: false });
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('stored module config is invalid'),
      expect.objectContaining({ moduleSlug: 'onboarding' })
    );
  });

  it('asks every question when the read throws an Error, and logs its message', async () => {
    getConfigForm.mockRejectedValue(new Error('Module "onboarding" not found'));

    await expect(readDiscoveryConfig('onboarding')).resolves.toEqual({ coreSetOnly: false });
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('could not be read'), {
      moduleSlug: 'onboarding',
      error: 'Module "onboarding" not found',
    });
  });

  it('logs a thrown non-Error as a string', async () => {
    getConfigForm.mockRejectedValue('connection reset');

    await expect(readDiscoveryConfig('onboarding')).resolves.toEqual({ coreSetOnly: false });
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('could not be read'), {
      moduleSlug: 'onboarding',
      error: 'connection reset',
    });
  });
});
