/**
 * The "module" prompt-context contributor (f-guidance t-4 / t-4b). Proves the loader composes
 * the registered module's name + description (user-agnostic), and — when a `userId` is supplied
 * (t-4b) — appends the user's current values for the module's *open* declared slots.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/framework/data-slots/values', () => ({ getSlotHeads: vi.fn() }));

import { loadModuleContext, MODULE_CONTEXT_UNAVAILABLE } from '@/lib/framework/modules/context';
import { registerModule, __resetModuleRegistryForTests } from '@/lib/framework/modules/registry';
import { getSlotHeads } from '@/lib/framework/data-slots/values';

const definition = (over: Record<string, unknown> = {}) => ({
  slug: 'onboarding',
  name: 'Onboarding',
  description: 'Gets a new user started.',
  configSchema: z.object({}),
  ...over,
});

beforeEach(() => {
  __resetModuleRegistryForTests();
  vi.clearAllMocks();
  vi.mocked(getSlotHeads).mockResolvedValue([] as never);
});

describe('loadModuleContext — module context (t-4, user-agnostic)', () => {
  it('composes the module name + description for a registered slug', async () => {
    registerModule(definition());
    await expect(loadModuleContext('onboarding')).resolves.toBe(
      'Module: Onboarding\nGets a new user started.'
    );
  });

  it('returns the unavailable body for an unregistered slug', async () => {
    registerModule(definition());
    await expect(loadModuleContext('not-a-module')).resolves.toBe(MODULE_CONTEXT_UNAVAILABLE);
  });

  it('reads no slots when there is no userId (the shared cache entry)', async () => {
    registerModule(
      definition({ slotDefinitions: [{ slug: 'goal', group: 'g', description: 'd' }] })
    );
    await loadModuleContext('onboarding');
    expect(getSlotHeads).not.toHaveBeenCalled();
  });
});

describe('loadModuleContext — per-user fresh slots (t-4b)', () => {
  it("appends the user's values for the module's OPEN declared slots", async () => {
    registerModule(
      definition({
        slotDefinitions: [
          { slug: 'primary_goal', group: 'goals', description: 'the goal' },
          { slug: 'system_note', group: 'sys', description: 'internal', visibility: 'hidden' },
        ],
      })
    );
    vi.mocked(getSlotHeads).mockResolvedValue([
      { slotSlug: 'primary_goal', value: 'run a marathon' },
    ] as never);

    const body = await loadModuleContext('onboarding', { userId: 'user-1' });
    // Only OPEN slugs are queried (the hidden one is excluded).
    expect(getSlotHeads).toHaveBeenCalledWith('user-1', { slotSlugs: ['primary_goal'] });
    expect(body).toContain('Module: Onboarding');
    expect(body).toContain('- primary_goal: run a marathon');
    expect(body).not.toContain('system_note');
  });

  it('reads no slots for an anonymous embed widget visitor (they hold none)', async () => {
    registerModule(
      definition({
        slotDefinitions: [{ slug: 'primary_goal', group: 'goals', description: 'the goal' }],
      })
    );
    const body = await loadModuleContext('onboarding', { userId: 'embed_0123456789abcdef' });
    expect(getSlotHeads).not.toHaveBeenCalled();
    expect(body).toContain('Module: Onboarding');
  });

  it('omits the slots section when the user has no captured values yet', async () => {
    registerModule(
      definition({ slotDefinitions: [{ slug: 'goal', group: 'g', description: 'd' }] })
    );
    vi.mocked(getSlotHeads).mockResolvedValue([] as never);
    const body = await loadModuleContext('onboarding', { userId: 'user-1' });
    expect(body).toBe('Module: Onboarding\nGets a new user started.');
  });

  it('does not query slots for a module that declares none', async () => {
    registerModule(definition()); // no slotDefinitions
    await loadModuleContext('onboarding', { userId: 'user-1' });
    expect(getSlotHeads).not.toHaveBeenCalled();
  });

  it('excludes special_category slots from auto-injection (left to on-demand get_state)', async () => {
    registerModule(
      definition({
        slotDefinitions: [
          { slug: 'primary_goal', group: 'goals', description: 'd' },
          {
            slug: 'health_note',
            group: 'health',
            description: 'd',
            sensitivity: 'special_category',
          },
        ],
      })
    );
    await loadModuleContext('onboarding', { userId: 'user-1' });
    expect(getSlotHeads).toHaveBeenCalledWith('user-1', { slotSlugs: ['primary_goal'] });
  });

  it('degrades to the module context (name + description) when the slot read throws', async () => {
    registerModule(
      definition({ slotDefinitions: [{ slug: 'goal', group: 'g', description: 'd' }] })
    );
    vi.mocked(getSlotHeads).mockRejectedValue(new Error('db down'));
    const body = await loadModuleContext('onboarding', { userId: 'user-1' });
    expect(body).toBe('Module: Onboarding\nGets a new user started.'); // reliable half preserved
  });
});
