/**
 * The crisis content cache (f-safety t-63): a database answer is reused for the
 * TTL, an admin write drops it, and a failure is never cached — so the turn
 * after a blip reads the tables again rather than reusing a stale rejection.
 *
 * Since t-88 there is one source and no floor beneath it: a read that cannot
 * answer — an unseeded database or a failed read — makes `loadCrisisContent()`
 * reject, not fall back to a bundled file. `resource.test.ts` covers how that
 * propagates through `resolveCrisisResource`.
 *
 * @see lib/app/safety/resources-store.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ findCopy: vi.fn(), findRegions: vi.fn() }));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    appCrisisCopy: { findUnique: db.findCopy },
    appCrisisRegion: { findMany: db.findRegions },
  },
}));

import { logger } from '@/lib/logging';
import {
  CRISIS_CACHE_TTL_MS,
  invalidateCrisisContentCache,
  loadCrisisContent,
} from '@/lib/app/safety/resources-store';

const COPY = {
  slug: 'global',
  hardIntro: 'Hard.',
  softIntro: 'Soft.',
  emergency: 'Call your local emergency number now.',
  keptMessage: 'Kept.',
  internationalName: 'Directory',
  internationalContact: 'directory.example',
  internationalUrl: 'https://directory.example',
  internationalHours: 'Everywhere',
  status: 'draft',
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  invalidateCrisisContentCache();
  db.findCopy.mockResolvedValue(COPY);
  db.findRegions.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe('loadCrisisContent', () => {
  it('reuses a database answer until the TTL passes, then reads again', async () => {
    expect((await loadCrisisContent()).copy.hardIntro).toBe('Hard.');
    await loadCrisisContent();
    expect(db.findCopy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(CRISIS_CACHE_TTL_MS + 1);
    await loadCrisisContent();
    expect(db.findCopy).toHaveBeenCalledTimes(2);
  });

  it('reads again at once after an admin write invalidates it', async () => {
    await loadCrisisContent();
    db.findCopy.mockResolvedValue({ ...COPY, hardIntro: 'Edited.', version: 2 });
    invalidateCrisisContentCache();

    expect((await loadCrisisContent()).copy.hardIntro).toBe('Edited.');
  });

  it('does not cache a read that an admin write overtook', async () => {
    let finish: (row: typeof COPY) => void = () => undefined;
    db.findCopy.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const stale = loadCrisisContent();

    invalidateCrisisContentCache(); // the admin's edit commits mid-read
    finish(COPY);
    expect((await stale).copy.hardIntro).toBe('Hard.');

    db.findCopy.mockResolvedValue({ ...COPY, hardIntro: 'Edited.', version: 2 });
    expect((await loadCrisisContent()).copy.hardIntro).toBe('Edited.');
  });

  // Inverted for t-88: a failed read used to fall back to the bundled file and
  // resolve. There is no bundled file any more, so the same failure must now
  // reject — and, because a failure is never cached, the very next call reads
  // the tables again rather than replaying that rejection.
  it('rejects on a failed read, logs it, and reads the tables again next time', async () => {
    db.findCopy.mockRejectedValueOnce(new Error('pool exhausted'));

    await expect(loadCrisisContent()).rejects.toThrow('pool exhausted');
    expect(logger.error).toHaveBeenCalledWith(
      'Crisis resource read failed',
      expect.objectContaining({ error: 'pool exhausted' })
    );

    const content = await loadCrisisContent();
    expect(content.copy.hardIntro).toBe('Hard.');
    expect(db.findCopy).toHaveBeenCalledTimes(2);
  });

  // Inverted for t-88: an unseeded database used to serve the bundled file.
  // Every environment now gets the copy row from a data migration, so this
  // state means something is actually wrong — and the honest answer is a
  // rejection, not a second copy of the helpline nobody is watching.
  it('rejects when the tables are unseeded, with no bundled copy served', async () => {
    db.findCopy.mockResolvedValue(null);

    await expect(loadCrisisContent()).rejects.toThrow(/unseeded/);
    expect(logger.error).toHaveBeenCalledWith(
      'Crisis resource tables are unseeded — no copy row to serve'
    );
  });

  it('rejects when a stored row fails validation, rather than serving it anyway', async () => {
    db.findRegions.mockResolvedValue([
      { region: 'gb', emergencyNumber: '999', services: [], status: 'draft', version: 1 },
    ]);

    await expect(loadCrisisContent()).rejects.toThrow(/invalid region code/);
  });
});
