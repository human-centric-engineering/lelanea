/**
 * Seed 020, the knowledge mirror's seed unit (f-content-seeds t-90).
 *
 * The unit only decides when the reconcile runs and what a failure means to
 * the runner. It must throw on any failed document, because the runner records
 * no `SeedHistory` row for a unit that throws, and that is what makes the next
 * `db:seed` try again.
 *
 * @see prisma/seeds/app-lelanea/020-knowledge-mirror.ts
 */

import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileKnowledgeMirror } = vi.hoisted(() => ({ reconcileKnowledgeMirror: vi.fn() }));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({ reconcileKnowledgeMirror }));

import unit from '@/prisma/seeds/app-lelanea/020-knowledge-mirror';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const result = (overrides: Record<string, unknown> = {}) => ({
  status: 'reconciled',
  created: ['foundational:the_mission'],
  reingested: [],
  designated: [],
  removed: [],
  unchanged: [],
  failed: [],
  ...overrides,
});

async function runSeed() {
  await unit.run({ prisma: {}, logger } as unknown as Parameters<typeof unit.run>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('020-knowledge-mirror', () => {
  it('runs the reconcile and reports what it did', async () => {
    reconcileKnowledgeMirror.mockResolvedValue(result());

    await runSeed();

    expect(reconcileKnowledgeMirror).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/1 created/));
  });

  it('throws when a document failed, naming it, so the next seed retries', async () => {
    reconcileKnowledgeMirror.mockResolvedValue(
      result({
        failed: [
          { sourceKey: 'foundational:the_mission', error: 'Embedding provider unavailable' },
        ],
      })
    );

    await expect(runSeed()).rejects.toThrow(/foundational:the_mission.*db:seed/);
  });

  it('throws when there is nothing to mirror, rather than recording a mirror as done', async () => {
    reconcileKnowledgeMirror.mockResolvedValue(result({ status: 'not_seeded', created: [] }));

    await expect(runSeed()).rejects.toThrow(/Seed 015/);
  });

  it('re-runs when the mirror module changes', () => {
    const seedDir = resolve(__dirname, '../../../../../prisma/seeds/app-lelanea');
    expect(unit.hashInputs).toEqual(['../../../lib/app/content/knowledge-mirror.ts']);
    expect(existsSync(resolve(seedDir, unit.hashInputs![0]))).toBe(true);
    expect(dirname(resolve(seedDir, unit.hashInputs![0]))).toMatch(/lib\/app\/content$/);
  });
});
