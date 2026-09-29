/**
 * Unit tests: framework module read queries — the `moduleExists` existence probe
 * (f-engagement t-2). Prisma is mocked; asserts the id-only lookup and the boolean result.
 *
 * @see lib/framework/modules/queries.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  prisma: { module: { findFirst: findFirstMock } },
}));

import { moduleExists } from '@/lib/framework/modules/queries';

beforeEach(() => vi.clearAllMocks());

describe('moduleExists', () => {
  it('returns true and probes id-only when a row exists', async () => {
    findFirstMock.mockResolvedValue({ id: 'm-1' });
    expect(await moduleExists('onboarding')).toBe(true);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { slug: 'onboarding' },
      select: { id: true },
    });
  });

  it('returns false when no row exists', async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await moduleExists('ghost')).toBe(false);
  });
});
