/**
 * The crisis resource's writer (f-safety t-63): an edit that changes something
 * goes back to `draft` with a new version; one that changes nothing does not;
 * a sign-off must name the version it read; nothing is written before the seed;
 * and each write drops the resolver's cache.
 *
 * @see lib/app/safety/crisis-admin.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  copy: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  region: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  invalidate: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { appCrisisCopy: db.copy, appCrisisRegion: db.region },
}));
vi.mock('@/lib/app/safety/resources-store', () => ({
  CRISIS_COPY_SLUG: 'global',
  invalidateCrisisContentCache: db.invalidate,
}));

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import {
  createCrisisRegion,
  getCrisisAdminView,
  removeCrisisRegion,
  signOffCrisisCopy,
  signOffCrisisRegion,
  updateCrisisCopy,
  updateCrisisRegion,
} from '@/lib/app/safety/crisis-admin';

const NOW = new Date('2026-09-19T12:00:00Z');
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
  status: 'signed_off',
  version: 3,
  signedOffAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};
const {
  slug: _slug,
  status: _s,
  version: _v,
  signedOffAt: _so,
  createdAt: _c,
  updatedAt: _u,
  ...COPY_TEXT
} = COPY;
const SAMARITANS = { name: 'Samaritans', contact: 'Call 116 123', hours: '24 hours a day' };
const GB = {
  region: 'GB',
  emergencyNumber: '999',
  services: [SAMARITANS],
  status: 'signed_off',
  version: 2,
  signedOffAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.copy.findUnique.mockResolvedValue(COPY);
  db.region.findUnique.mockResolvedValue(GB);
  db.copy.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...COPY,
    ...data,
    version: COPY.version + 1,
  }));
  db.region.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...GB,
    ...data,
    version: GB.version + 1,
  }));
});

describe('before the seed', () => {
  it('reads as unseeded, and refuses every write 409 without touching a row', async () => {
    db.copy.findUnique.mockResolvedValue(null);
    db.region.findMany.mockResolvedValue([]);
    expect(await getCrisisAdminView()).toEqual({ seeded: false, copy: null, regions: [] });

    const writes = [
      updateCrisisCopy(COPY_TEXT),
      signOffCrisisCopy(1),
      createCrisisRegion({ region: 'FR', emergencyNumber: '112', services: [SAMARITANS] }),
      updateCrisisRegion('GB', { emergencyNumber: '999', services: [SAMARITANS] }),
      signOffCrisisRegion('GB', 2),
      removeCrisisRegion('GB'),
    ];
    for (const write of writes) await expect(write).rejects.toBeInstanceOf(ConflictError);

    expect(db.region.create).not.toHaveBeenCalled();
    expect(db.copy.update).not.toHaveBeenCalled();
    expect(db.region.deleteMany).not.toHaveBeenCalled();
    expect(db.invalidate).not.toHaveBeenCalled();
  });
});

describe('updateCrisisCopy', () => {
  it('an edit sends the copy back to draft, bumps its version and reports what changed', async () => {
    const { copy, changes } = await updateCrisisCopy({ ...COPY_TEXT, hardIntro: 'Reworded.' });

    expect(db.copy.update).toHaveBeenCalledWith({
      where: { slug: 'global' },
      data: expect.objectContaining({
        hardIntro: 'Reworded.',
        status: 'draft',
        signedOffAt: null,
        version: { increment: 1 },
      }),
    });
    expect(copy).toMatchObject({ status: 'draft', version: 4 });
    expect(changes).toEqual({ hardIntro: { from: 'Hard.', to: 'Reworded.' } });
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it('a save that changes nothing is not an edit: the sign-off stands', async () => {
    const { copy, changes } = await updateCrisisCopy(COPY_TEXT);
    expect(changes).toEqual({});
    expect(copy).toMatchObject({ status: 'signed_off', version: 3 });
    expect(db.copy.update).not.toHaveBeenCalled();
  });
});

describe('updateCrisisRegion', () => {
  it('an edit sends the region back to draft with a new version', async () => {
    const edited = [{ ...SAMARITANS, contact: 'Call 116 123 (free)' }];
    const { region, changes } = await updateCrisisRegion('GB', {
      emergencyNumber: '999',
      services: edited,
    });

    expect(db.region.update).toHaveBeenCalledWith({
      where: { region: 'GB' },
      data: expect.objectContaining({ services: edited, status: 'draft', signedOffAt: null }),
    });
    expect(region).toMatchObject({ status: 'draft', version: 3 });
    expect(Object.keys(changes)).toEqual(['services']);
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it('a save that changes nothing writes nothing', async () => {
    const { changes } = await updateCrisisRegion('GB', {
      emergencyNumber: '999',
      services: [SAMARITANS],
    });
    expect(changes).toEqual({});
    expect(db.region.update).not.toHaveBeenCalled();
  });

  it('404s a region that is not listed', async () => {
    db.region.findUnique.mockResolvedValue(null);
    await expect(
      updateCrisisRegion('FR', { emergencyNumber: '112', services: [SAMARITANS] })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('sign-off', () => {
  it('signs off the version the admin read', async () => {
    db.copy.updateMany.mockResolvedValue({ count: 1 });
    await signOffCrisisCopy(3);
    expect(db.copy.updateMany).toHaveBeenCalledWith({
      where: { slug: 'global', version: 3 },
      data: { status: 'signed_off', signedOffAt: expect.any(Date) },
    });
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it('refuses 409 when the version moved since it was read', async () => {
    db.copy.updateMany.mockResolvedValue({ count: 0 });
    await expect(signOffCrisisCopy(2)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'version_moved', currentVersion: 3 },
    });

    db.region.updateMany.mockResolvedValue({ count: 0 });
    await expect(signOffCrisisRegion('GB', 1)).rejects.toMatchObject({
      details: { reason: 'version_moved', currentVersion: 2 },
    });
    expect(db.invalidate).not.toHaveBeenCalled();
  });

  it('refuses to sign off a region whose stored services are malformed', async () => {
    db.region.findUnique.mockResolvedValue({ ...GB, services: 'not a list' });
    await expect(signOffCrisisRegion('GB', 2)).rejects.toMatchObject({
      details: { reason: 'malformed' },
    });
    expect(db.region.updateMany).not.toHaveBeenCalled();
  });
});

describe('createCrisisRegion', () => {
  it('lists a new region as a draft', async () => {
    db.region.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...GB,
      ...data,
      version: 1,
    }));
    const row = await createCrisisRegion({
      region: 'FR',
      emergencyNumber: '112',
      services: [SAMARITANS],
    });
    expect(db.region.create).toHaveBeenCalledWith({
      data: { region: 'FR', emergencyNumber: '112', services: [SAMARITANS], status: 'draft' },
    });
    expect(row).toMatchObject({ region: 'FR', status: 'draft', version: 1 });
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it('refuses 409 for a region already listed', async () => {
    db.region.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(
      createCrisisRegion({ region: 'GB', emergencyNumber: '999', services: [SAMARITANS] })
    ).rejects.toMatchObject({ status: 409, details: { reason: 'exists' } });
  });
});

describe('removeCrisisRegion', () => {
  it('deletes the row and returns what it held, for the audit log', async () => {
    db.region.deleteMany.mockResolvedValue({ count: 1 });
    const removed = await removeCrisisRegion('GB');
    expect(db.region.deleteMany).toHaveBeenCalledWith({ where: { region: 'GB' } });
    expect(removed).toMatchObject({ region: 'GB', emergencyNumber: '999' });
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it('404s when another admin removed it first', async () => {
    db.region.deleteMany.mockResolvedValue({ count: 0 });
    await expect(removeCrisisRegion('GB')).rejects.toBeInstanceOf(NotFoundError);
  });
});
