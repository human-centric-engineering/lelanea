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
vi.mock('@/lib/app/safety/resources-store', async (importOriginal) => ({
  // The real `contentFromRows`: the page's warning must use the turn's own check.
  ...(await importOriginal<typeof import('@/lib/app/safety/resources-store')>()),
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

type Row = Record<string, unknown> & { version: number };
let copyRow: Row | null;
let gbRow: Row | null;

/** What Prisma's conditional `updateMany` does: apply only where the version still matches. */
function conditional(get: () => Row | null, set: (row: Row) => void) {
  return async ({
    where,
    data,
  }: {
    where: { version?: number };
    data: Record<string, unknown> & { version?: unknown };
  }) => {
    const row = get();
    if (!row || (where.version !== undefined && row.version !== where.version)) return { count: 0 };
    const { version, ...rest } = data;
    const bumped = isIncrement(version) ? row.version + version.increment : row.version;
    set({ ...row, ...rest, version: bumped });
    return { count: 1 };
  };
}

function isIncrement(value: unknown): value is { increment: number } {
  return typeof value === 'object' && value !== null && 'increment' in value;
}

beforeEach(() => {
  vi.clearAllMocks();
  copyRow = { ...COPY };
  gbRow = { ...GB };
  db.copy.findUnique.mockImplementation(async () => copyRow);
  db.region.findUnique.mockImplementation(async () => gbRow);
  db.region.findMany.mockImplementation(async () => (gbRow ? [gbRow] : []));
  db.copy.updateMany.mockImplementation(
    conditional(
      () => copyRow,
      (row) => (copyRow = row)
    )
  );
  db.region.updateMany.mockImplementation(
    conditional(
      () => gbRow,
      (row) => (gbRow = row)
    )
  );
});

describe('before the seed', () => {
  it('reads as unseeded, and refuses every write 409 without touching a row', async () => {
    copyRow = null;
    gbRow = null;
    expect(await getCrisisAdminView()).toEqual({
      seeded: false,
      unservable: null,
      copy: null,
      regions: [],
    });

    const writes = [
      updateCrisisCopy(COPY_TEXT, 1),
      signOffCrisisCopy(1),
      createCrisisRegion({ region: 'FR', emergencyNumber: '112', services: [SAMARITANS] }),
      updateCrisisRegion('GB', { emergencyNumber: '999', services: [SAMARITANS] }, 2),
      signOffCrisisRegion('GB', 2),
      removeCrisisRegion('GB'),
    ];
    for (const write of writes) await expect(write).rejects.toBeInstanceOf(ConflictError);

    expect(db.region.create).not.toHaveBeenCalled();
    expect(db.copy.updateMany).not.toHaveBeenCalled();
    expect(db.region.deleteMany).not.toHaveBeenCalled();
    expect(db.invalidate).not.toHaveBeenCalled();
  });
});

describe('updateCrisisCopy', () => {
  it('an edit sends the copy back to draft, bumps its version and reports what changed', async () => {
    const { copy, changes } = await updateCrisisCopy({ ...COPY_TEXT, hardIntro: 'Reworded.' }, 3);

    expect(db.copy.updateMany).toHaveBeenCalledWith({
      where: { slug: 'global', version: 3 },
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
    const { copy, changes } = await updateCrisisCopy(COPY_TEXT, 3);
    expect(changes).toEqual({});
    expect(copy).toMatchObject({ status: 'signed_off', version: 3 });
    expect(db.copy.updateMany).not.toHaveBeenCalled();
  });

  it('refuses 409 a save from a stale form, writing nothing', async () => {
    // Another admin saved v3 → v4 after this one opened the form at v3.
    copyRow = { ...COPY, hardIntro: 'Corrected by someone else.', version: 4 };
    await expect(updateCrisisCopy({ ...COPY_TEXT, hardIntro: 'Mine.' }, 3)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'version_moved', currentVersion: 4 },
    });
    expect(db.copy.updateMany).not.toHaveBeenCalled();
    expect(copyRow.hardIntro).toBe('Corrected by someone else.');
  });

  it('refuses 409 when another save lands between the read and the write', async () => {
    db.copy.updateMany.mockResolvedValueOnce({ count: 0 });
    copyRow = { ...COPY };
    db.copy.findUnique
      .mockImplementationOnce(async () => copyRow) // the first read: still v3
      .mockImplementationOnce(async () => ({ ...COPY, version: 4 })); // after losing the race
    await expect(updateCrisisCopy({ ...COPY_TEXT, hardIntro: 'Mine.' }, 3)).rejects.toMatchObject({
      details: { reason: 'version_moved', currentVersion: 4 },
    });
    expect(db.invalidate).not.toHaveBeenCalled();
  });
});

describe('updateCrisisRegion', () => {
  it('an edit sends the region back to draft with a new version', async () => {
    const edited = [{ ...SAMARITANS, contact: 'Call 116 123 (free)' }];
    const { region, changes } = await updateCrisisRegion(
      'GB',
      { emergencyNumber: '999', services: edited },
      2
    );

    expect(db.region.updateMany).toHaveBeenCalledWith({
      where: { region: 'GB', version: 2 },
      data: expect.objectContaining({ services: edited, status: 'draft', signedOffAt: null }),
    });
    expect(region).toMatchObject({ status: 'draft', version: 3 });
    expect(Object.keys(changes)).toEqual(['services']);
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it('a save that changes nothing writes nothing', async () => {
    const { changes } = await updateCrisisRegion(
      'GB',
      { emergencyNumber: '999', services: [SAMARITANS] },
      2
    );
    expect(changes).toEqual({});
    expect(db.region.updateMany).not.toHaveBeenCalled();
  });

  it('is not fooled by JSONB’s key order: an untouched region keeps its sign-off', async () => {
    // What Postgres actually returns: keys shortest-first, not as written.
    gbRow = {
      ...GB,
      services: [{ name: SAMARITANS.name, hours: SAMARITANS.hours, contact: SAMARITANS.contact }],
    };
    const { changes, region } = await updateCrisisRegion(
      'GB',
      { emergencyNumber: '999', services: [SAMARITANS] },
      2
    );
    expect(changes).toEqual({});
    expect(region.status).toBe('signed_off');
    expect(db.region.updateMany).not.toHaveBeenCalled();
  });

  it('refuses 409 a stale save — another admin’s corrected number is not put back', async () => {
    gbRow = { ...GB, emergencyNumber: '999 or 112', version: 3 };
    await expect(
      updateCrisisRegion('GB', { emergencyNumber: '999', services: [SAMARITANS] }, 2)
    ).rejects.toMatchObject({
      status: 409,
      details: { reason: 'version_moved', currentVersion: 3 },
    });
    expect(db.region.updateMany).not.toHaveBeenCalled();
    expect(gbRow.emergencyNumber).toBe('999 or 112');
  });

  it('404s a region that is not listed', async () => {
    gbRow = null;
    await expect(
      updateCrisisRegion('FR', { emergencyNumber: '112', services: [SAMARITANS] }, 1)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('sign-off', () => {
  it('signs off the version the admin read', async () => {
    await signOffCrisisCopy(3);
    expect(db.copy.updateMany).toHaveBeenCalledWith({
      where: { slug: 'global', version: 3 },
      data: { status: 'signed_off', signedOffAt: expect.any(Date) },
    });
    expect(db.invalidate).toHaveBeenCalledTimes(1);
  });

  it('refuses 409 when the version moved since it was read', async () => {
    await expect(signOffCrisisCopy(2)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'version_moved', currentVersion: 3 },
    });

    await expect(signOffCrisisRegion('GB', 1)).rejects.toMatchObject({
      details: { reason: 'version_moved', currentVersion: 2 },
    });
    expect(db.invalidate).not.toHaveBeenCalled();
  });

  it('refuses to sign off a region whose stored services are malformed', async () => {
    gbRow = { ...GB, services: 'not a list' };
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

describe('getCrisisAdminView — says when the stored rows cannot be served', () => {
  it('is null while every row is servable', async () => {
    expect((await getCrisisAdminView()).unservable).toBeNull();
  });

  it.each([
    [
      'a directory link that is not https',
      () => (copyRow = { ...COPY, internationalUrl: 'http://x.example' }),
    ],
    ['a blank emergency number', () => (gbRow = { ...GB, emergencyNumber: '  ' })],
    ['a region code that is not two capitals', () => (gbRow = { ...GB, region: 'gb' })],
  ])('names the problem for %s — the same rows the turn falls back on', async (_label, arrange) => {
    arrange();
    const { unservable } = await getCrisisAdminView();
    expect(unservable).toEqual(expect.any(String));
    expect(unservable).not.toMatch(/vitest|export/);
  });
});
