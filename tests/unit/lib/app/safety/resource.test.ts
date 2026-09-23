/**
 * Which services a person in danger is shown, and the frame that carries them
 * (f-safety t-58), and where their words come from (t-63; the bundled fallback
 * removed in t-88).
 *
 * The mocked database is seeded, by default, with the same content as the
 * bundled `seed-data/drafted/lelanea_crisis_resources.json` file — exactly
 * what `010-crisis-resources` writes into a fresh database. So the blocks
 * that compare served text against `getCrisisResources()` are comparing
 * DATABASE-served content that happens to match the seed, not a file
 * fallback: there is none any more. "Where the words come from" then puts
 * different rows in the tables, and breaks the read three ways — every one
 * of which must now reject rather than quietly serving the bundled file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({
  findCopy: vi.fn(),
  findRegions: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    appCrisisCopy: { findUnique: db.findCopy },
    appCrisisRegion: { findMany: db.findRegions },
  },
}));

import { getCrisisResources } from '@/lib/app/content/crisis-resources';
import { invalidateCrisisContentCache } from '@/lib/app/safety/resources-store';
import {
  crisisFrame,
  crisisResourceText,
  regionOfLocale,
  resolveCrisisResource,
} from '@/lib/app/safety/resource';

const INTERNATIONAL = 'Find A Helpline';

const FILE = getCrisisResources();

/** What `010-crisis-resources` writes for the copy row, from the bundled file. */
const SEEDED_COPY = {
  slug: 'global',
  hardIntro: FILE.copy.hardIntro,
  softIntro: FILE.copy.softIntro,
  emergency: FILE.copy.emergency,
  keptMessage: FILE.copy.keptMessage,
  internationalName: FILE.international.name,
  internationalContact: FILE.international.contact,
  internationalUrl: FILE.international.url,
  internationalHours: FILE.international.hours,
  status: FILE.resources.provenance.status,
  version: 1,
};

/** What `010-crisis-resources` writes for the region rows, from the bundled file. */
const SEEDED_REGIONS = FILE.regions.map((r) => ({
  region: r.region,
  emergencyNumber: r.emergencyNumber,
  services: r.services.map((s) => ({ ...s })),
  status: FILE.resources.provenance.status,
  version: 1,
}));

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCrisisContentCache();
  // Seeded to match the bundled file, as a freshly migrated database is.
  db.findCopy.mockResolvedValue(SEEDED_COPY);
  db.findRegions.mockResolvedValue(SEEDED_REGIONS);
});

describe('regionOfLocale', () => {
  it.each([
    ['en-GB', 'GB'],
    ['en_us', 'US'],
    ['zh-Hant-TW', 'TW'],
    ['pt-br', 'BR'],
  ])('reads %s as %s', (locale, region) => {
    expect(regionOfLocale(locale)).toBe(region);
  });

  it.each([['en'], ['es-419'], ['zh-Hant'], [null]])('names no country for %s', (locale) => {
    expect(regionOfLocale(locale)).toBeNull();
  });
});

describe('resolveCrisisResource', () => {
  it('names the region’s own services first, then the international directory', async () => {
    const uk = await resolveCrisisResource('en-GB', 'hard');
    expect(uk.region).toBe('GB');
    expect(uk.services.map((s) => s.name)).toEqual(['Samaritans', 'Shout', INTERNATIONAL]);
    expect(uk.emergency).toContain('999');
  });

  it('chooses by region, not by language: en-US and en-GB get different services', async () => {
    const us = await resolveCrisisResource('en-US', 'hard');
    expect(us.region).toBe('US');
    expect(us.services[0]?.contact).toContain('988');
    expect(us.emergency).toContain('911');
    const uk = await resolveCrisisResource('en-GB', 'hard');
    expect(us.services[0]?.name).not.toBe(uk.services[0]?.name);
  });

  it.each([
    ['a region the table does not list', 'fr-FR'],
    ['a tag with no region', 'en'],
    ['no preference at all', null],
  ])('falls back to the directory and the local emergency line for %s', async (_label, locale) => {
    const resource = await resolveCrisisResource(locale, 'hard');
    expect(resource.region).toBeNull();
    expect(resource.services).toEqual([
      expect.objectContaining({ name: INTERNATIONAL, url: 'https://findahelpline.com' }),
    ]);
    // No number is guessed for someone whose country is unknown.
    expect(resource.emergency).toBe(getCrisisResources().copy.emergency);
    expect(resource.emergency).toMatch(/local emergency number/);
  });

  it('carries the draft marker while the content awaits sign-off', async () => {
    expect(getCrisisResources().resources.provenance.status).toBe('draft');
    expect((await resolveCrisisResource('en-GB', 'soft')).status).toBe('draft');
  });

  it('tells a hard-tier reader their message is kept; a soft one carries on', async () => {
    const hard = await resolveCrisisResource('en-GB', 'hard');
    const soft = await resolveCrisisResource('en-GB', 'soft');
    expect(hard.keptMessage).toMatch(/still in the box/);
    expect(soft.keptMessage).toBeNull();
    expect(soft.intro).not.toBe(hard.intro);
  });
});

describe('crisisFrame', () => {
  it('ends the turn on a hard hit: an error frame with the crisis code', async () => {
    const frame = crisisFrame(await resolveCrisisResource('en-GB', 'hard'));
    expect(frame.type).toBe('error');
    expect(frame.code).toBe('crisis');
  });

  it('leads the turn on a soft hit: a warning frame, so her turn can follow', async () => {
    const frame = crisisFrame(await resolveCrisisResource('en-GB', 'soft'));
    expect(frame.type).toBe('warning');
    expect(frame.code).toBe('crisis');
  });

  it('puts every name and contact in the plain-text message, for a client that renders nothing else', async () => {
    const resource = await resolveCrisisResource('en-AU', 'hard');
    const text = crisisResourceText(resource);
    expect(resource.services.length).toBeGreaterThan(1);
    for (const service of resource.services) {
      expect(text).toContain(service.name);
      expect(text).toContain(service.contact);
    }
    expect(text).toContain(resource.emergency);
    expect(crisisFrame(resource).message).toBe(text);
  });
});

describe('the authored table', () => {
  it('lists every region once, each with at least one service', () => {
    const { regions } = getCrisisResources();
    expect(regions.length).toBeGreaterThan(3);
    expect(new Set(regions.map((r) => r.region)).size).toBe(regions.length);
    for (const region of regions) expect(region.services.length).toBeGreaterThan(0);
  });
});

describe('where the words come from (t-63 / t-88)', () => {
  const STORED_COPY = {
    slug: 'global',
    hardIntro: 'Stored hard intro — you deserve a person, now.',
    softIntro: 'Stored soft intro.',
    emergency: 'If you are in immediate danger, call your local emergency number now.',
    keptMessage: 'Stored: what you wrote is still in the box.',
    internationalName: 'Stored Directory',
    internationalContact: 'directory.example',
    internationalUrl: 'https://directory.example',
    internationalHours: 'Every country',
    status: 'signed_off',
    version: 3,
  };
  const STORED_GB = {
    region: 'GB',
    emergencyNumber: '999',
    services: [{ name: 'Edited Line', contact: 'Call 0800 000 000', hours: '24 hours a day' }],
    status: 'draft',
    version: 2,
  };

  function seeded(): void {
    db.findCopy.mockResolvedValue(STORED_COPY);
    db.findRegions.mockResolvedValue([STORED_GB]);
  }

  it('serves the stored rows once seeded — an edited region, the stored copy and directory', async () => {
    seeded();
    const resource = await resolveCrisisResource('en-GB', 'hard');
    expect(resource.services.map((s) => s.name)).toEqual(['Edited Line', 'Stored Directory']);
    expect(resource.intro).toBe(STORED_COPY.hardIntro);
    expect(resource.keptMessage).toBe(STORED_COPY.keptMessage);
    expect(resource.emergency).toBe(`${STORED_COPY.emergency} (999)`);
    expect(resource.version).toBe('c3/GB.2');
  });

  it('is a draft while any part shown is: a signed-off copy with a draft region', async () => {
    seeded();
    expect((await resolveCrisisResource('en-GB', 'hard')).status).toBe('draft');
    // Nowhere listed: only the copy is shown, and it is signed off.
    const elsewhere = await resolveCrisisResource('fr-FR', 'hard');
    expect(elsewhere).toMatchObject({ status: 'signed_off', region: null, version: 'c3' });
  });

  it('treats a removed region as unlisted once seeded — a re-seed does not bring it back', async () => {
    db.findCopy.mockResolvedValue(STORED_COPY);
    db.findRegions.mockResolvedValue([]);
    const resource = await resolveCrisisResource('en-GB', 'hard');
    expect(resource.region).toBeNull();
    expect(resource.services.map((s) => s.name)).toEqual(['Stored Directory']);
  });

  // Every case below used to serve the bundled file (f-safety t-63). t-88
  // removed that floor: none of them may resolve to anything at all now, and
  // in particular none may resolve to the bundled GB entry ('Samaritans',
  // 'Shout') that used to paper over exactly these failures.

  it('rejects when the tables are unseeded — no bundled copy fills in', async () => {
    db.findCopy.mockResolvedValue(null);
    db.findRegions.mockResolvedValue([]);

    await expect(resolveCrisisResource('en-GB', 'hard')).rejects.toThrow(/unseeded/);
    expect(db.findCopy).toHaveBeenCalled();
  });

  it('rejects when the read throws — no bundled copy fills in', async () => {
    db.findCopy.mockRejectedValue(new Error('connection terminated'));
    db.findRegions.mockResolvedValue([STORED_GB]);

    await expect(resolveCrisisResource('en-GB', 'hard')).rejects.toThrow('connection terminated');
  });

  it('rejects when a stored row fails validation — no bundled copy fills in', async () => {
    db.findCopy.mockResolvedValue(STORED_COPY);
    db.findRegions.mockResolvedValue([{ ...STORED_GB, services: [] }]);

    await expect(resolveCrisisResource('en-GB', 'hard')).rejects.toThrow();
  });

  it('never lets the bundled file’s words reach the frame when the tables cannot answer', async () => {
    db.findCopy.mockRejectedValue(new Error('connection terminated'));
    db.findRegions.mockResolvedValue([STORED_GB]);

    // Before t-88 this pipeline resolved to a frame carrying the bundled GB
    // entry ('Samaritans', 'Shout' — see the block above). Now the whole
    // pipeline rejects, so that text is never assembled into a served frame:
    // a positive check that no bundled copy stands in for the failed read.
    let settledValue: unknown = 'not settled';
    await resolveCrisisResource('en-GB', 'hard')
      .then(crisisFrame)
      .then(
        (frame) => {
          settledValue = frame;
        },
        (err: unknown) => {
          settledValue = err;
        }
      );

    expect(settledValue).toBeInstanceOf(Error);
    expect((settledValue as Error).message).toBe('connection terminated');
    expect(JSON.stringify(settledValue)).not.toContain('Samaritans');
  });

  describe('a slow read', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // The read deadline/race was deleted with the bundled fallback (t-88): a
    // slow read now waits instead of timing out to a bundled copy.
    it('waits for the tables rather than racing a deadline to the bundled file', async () => {
      let resolveRead: (value: typeof STORED_COPY) => void = () => undefined;
      db.findCopy.mockReturnValue(new Promise((resolve) => (resolveRead = resolve)));
      db.findRegions.mockResolvedValue([STORED_GB]);

      let settled = false;
      const pending = resolveCrisisResource('en-GB', 'hard').then((resource) => {
        settled = true;
        return resource;
      });

      // Ten minutes: comfortably past the old 750ms race, which used to hand
      // over to the bundled file at this point instead of waiting.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(settled).toBe(false);

      resolveRead(STORED_COPY);
      const resource = await pending;
      expect(resource.services.map((s) => s.name)).toEqual(['Edited Line', 'Stored Directory']);
    });
  });
});
