/**
 * The leaf's module read wrapper — the only path from the framework's module
 * registry and rows to the app shell.
 *
 * The registry half is exercised for real (it is in-memory); the row half
 * mocks the Prisma client and asserts the projection, so a framework column
 * added or renamed upstream surfaces here rather than in a page.
 *
 * @see lib/app/journey/modules.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  prisma: { module: { findMany: findManyMock } },
}));

import {
  listRegisteredModules,
  getRegisteredModuleBySlug,
  listModuleRows,
} from '@/lib/app/journey/modules';
import { registerModule, __resetModuleRegistryForTests } from '@/lib/framework/modules/registry';

beforeEach(() => {
  vi.clearAllMocks();
  __resetModuleRegistryForTests();
});

describe('listRegisteredModules / getRegisteredModuleBySlug', () => {
  it('projects the registry to slug, name and description only', () => {
    registerModule({
      slug: 'values',
      name: 'Values',
      description: 'The inner compass.',
      configSchema: z.object({}),
      agentRoles: ['companion'],
    });

    expect(listRegisteredModules()).toEqual([
      { slug: 'values', name: 'Values', description: 'The inner compass.' },
    ]);
    expect(getRegisteredModuleBySlug('values')).toEqual({
      slug: 'values',
      name: 'Values',
      description: 'The inner compass.',
    });
  });

  it('keeps registration order', () => {
    registerModule({ slug: 'b', name: 'B', description: '', configSchema: z.object({}) });
    registerModule({ slug: 'a', name: 'A', description: '', configSchema: z.object({}) });

    expect(listRegisteredModules().map((m) => m.slug)).toEqual(['b', 'a']);
  });

  it('returns null for a slug the code does not register', () => {
    expect(getRegisteredModuleBySlug('ghost')).toBeNull();
  });
});

describe('listModuleRows', () => {
  it('projects every row, retired ones included, to the leaf shape', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'm-1',
        slug: 'onboarding',
        name: 'Onboarding',
        status: 'draft',
        audience: 'all',
        config: {},
        isRegistered: true,
        featureFlagName: null,
        availableFrom: null,
        availableUntil: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      {
        id: 'm-2',
        slug: 'retired-thing',
        name: 'Retired',
        status: 'retired',
        audience: 'all',
        config: {},
        isRegistered: false,
        featureFlagName: null,
        availableFrom: null,
        availableUntil: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);

    await expect(listModuleRows()).resolves.toEqual([
      { slug: 'onboarding', name: 'Onboarding', status: 'draft', isRegistered: true },
      { slug: 'retired-thing', name: 'Retired', status: 'retired', isRegistered: false },
    ]);
    expect(findManyMock).toHaveBeenCalledWith({ orderBy: { slug: 'asc' } });
  });

  it('propagates a database failure rather than returning an empty list', async () => {
    findManyMock.mockRejectedValue(new Error('connection refused'));
    await expect(listModuleRows()).rejects.toThrow('connection refused');
  });
});
