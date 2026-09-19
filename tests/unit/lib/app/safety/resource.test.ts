/**
 * Which services a person in danger is shown, and the frame that carries them
 * (f-safety t-58), and where their words come from (t-63).
 *
 * The first blocks read the real authored file — the tables are empty here, so
 * the bundled file is what answers — and a change to the table that breaks a
 * region fails here. "Where the words come from" puts rows in the tables, then
 * breaks the read three ways.
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
import {
  CRISIS_READ_DEADLINE_MS,
  invalidateCrisisContentCache,
} from '@/lib/app/safety/resources-store';
import {
  crisisFrame,
  crisisResourceText,
  regionOfLocale,
  resolveCrisisResource,
} from '@/lib/app/safety/resource';

const INTERNATIONAL = 'Find A Helpline';

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCrisisContentCache();
  // Unseeded: the bundled file answers, as it does before `db:seed` has run.
  db.findCopy.mockResolvedValue(null);
  db.findRegions.mockResolvedValue([]);
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

describe('where the words come from (t-63)', () => {
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

  /** What the bundled file names for GB — the floor every failure must land on. */
  function expectBundledGb(resource: Awaited<ReturnType<typeof resolveCrisisResource>>): void {
    expect(resource.region).toBe('GB');
    expect(resource.services.map((s) => s.name)).toEqual(['Samaritans', 'Shout', INTERNATIONAL]);
    expect(resource.intro).toBe(getCrisisResources().copy.hardIntro);
    expect(resource.version).toBe(getCrisisResources().resources.version);
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

  it('treats a removed region as unlisted once seeded — the file does not bring it back', async () => {
    db.findCopy.mockResolvedValue(STORED_COPY);
    db.findRegions.mockResolvedValue([]);
    const resource = await resolveCrisisResource('en-GB', 'hard');
    expect(resource.region).toBeNull();
    expect(resource.services.map((s) => s.name)).toEqual(['Stored Directory']);
  });

  it('serves the bundled file while the tables are empty', async () => {
    expectBundledGb(await resolveCrisisResource('en-GB', 'hard'));
    expect(db.findCopy).toHaveBeenCalled();
  });

  it('serves the bundled file when the read throws', async () => {
    db.findCopy.mockRejectedValue(new Error('connection terminated'));
    db.findRegions.mockResolvedValue([STORED_GB]);
    expectBundledGb(await resolveCrisisResource('en-GB', 'hard'));
  });

  it('serves the bundled file when a stored row fails validation', async () => {
    db.findCopy.mockResolvedValue(STORED_COPY);
    db.findRegions.mockResolvedValue([{ ...STORED_GB, services: [] }]);
    expectBundledGb(await resolveCrisisResource('en-GB', 'hard'));
  });

  describe('a read that passes its deadline', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('serves the bundled file at the deadline, without waiting for the read', async () => {
      db.findCopy.mockReturnValue(new Promise(() => undefined)); // never settles
      db.findRegions.mockResolvedValue([STORED_GB]);

      let settled = false;
      const pending = resolveCrisisResource('en-GB', 'hard').then((resource) => {
        settled = true;
        return resource;
      });
      await vi.advanceTimersByTimeAsync(CRISIS_READ_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expectBundledGb(await pending);
    });
  });
});
