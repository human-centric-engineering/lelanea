/**
 * Module config read side (f-module-config t-2).
 *
 * `getModuleConfigForm` composes a DB read (`Module.config`) with the registry
 * (`configSchema` → descriptors). Prisma + registry are mocked; the walker runs for real
 * so the descriptor shape is proven end-to-end. Covers: registered (descriptors + values),
 * unregistered (no descriptors, values still returned), and unknown-slug 404.
 *
 * @see lib/framework/modules/config/queries.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';

const prismaFake = vi.hoisted(() => ({
  module: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/framework/modules/registry', () => ({ getRegisteredModule: vi.fn() }));

import { getModuleConfigForm } from '@/lib/framework/modules/config/queries';
import { getRegisteredModule } from '@/lib/framework/modules/registry';
import { NotFoundError } from '@/lib/api/errors';

beforeEach(() => vi.clearAllMocks());

describe('getModuleConfigForm', () => {
  it('404s for an unknown slug', async () => {
    prismaFake.module.findFirst.mockResolvedValue(null);
    await expect(getModuleConfigForm('ghost')).rejects.toThrow(NotFoundError);
  });

  it('returns descriptors + values for a registered module', async () => {
    prismaFake.module.findFirst.mockResolvedValue({ config: { tone: 'direct' } });
    vi.mocked(getRegisteredModule).mockReturnValue({
      slug: 'reading',
      name: 'Reading',
      description: 'test',
      configSchema: z.object({ tone: z.enum(['gentle', 'direct']).default('gentle') }),
    });

    const form = await getModuleConfigForm('reading');
    expect(form.registered).toBe(true);
    expect(form.values).toEqual({ tone: 'direct' });
    expect(form.descriptors).toHaveLength(1);
    expect(form.descriptors[0]).toMatchObject({ key: 'tone', type: 'enum' });
  });

  it('returns no descriptors but keeps values for an unregistered module', async () => {
    prismaFake.module.findFirst.mockResolvedValue({ config: { legacy: true } });
    vi.mocked(getRegisteredModule).mockReturnValue(undefined);

    const form = await getModuleConfigForm('retired');
    expect(form.registered).toBe(false);
    expect(form.descriptors).toEqual([]);
    expect(form.values).toEqual({ legacy: true });
  });
});
