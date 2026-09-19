/**
 * The crisis content cache (f-safety t-63): a database answer is reused for the
 * TTL, an admin write drops it, and a failure is never cached — so the turn
 * after a blip reads the tables again rather than serving the file for a minute.
 *
 * Which source answers, and every fallback, is `resource.test.ts`.
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
    expect((await loadCrisisContent()).source).toBe('database');
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

  it('never caches a failure: the next call reads the tables again', async () => {
    db.findCopy.mockRejectedValueOnce(new Error('pool exhausted'));
    expect((await loadCrisisContent()).source).toBe('bundled');
    expect(logger.error).toHaveBeenCalledWith(
      'Crisis resource read failed — serving the bundled file',
      expect.objectContaining({ reason: 'error' })
    );

    expect((await loadCrisisContent()).source).toBe('database');
    expect(db.findCopy).toHaveBeenCalledTimes(2);
  });

  it('says so when it serves the file because the tables are unseeded', async () => {
    db.findCopy.mockResolvedValue(null);
    expect((await loadCrisisContent()).source).toBe('bundled');
    expect(logger.warn).toHaveBeenCalledWith(
      'Crisis resource tables are unseeded — serving the bundled file'
    );
  });
});
