/**
 * The crisis resource as a file (f-content-seeds t-92).
 *
 * The REAL seed unit, the REAL import and the REAL read a crisis turn makes,
 * against one in-memory database. The rule that matters most is pinned first:
 * nothing an import writes arrives signed off, whatever the file claims — a
 * sign-off is an act on this environment's rows, and the person who meets an
 * unread helpline is someone in crisis.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import seedUnit from '@/prisma/seeds/app-lelanea/010-crisis-resources';
import { logger } from '@/lib/logging';
import * as crisis from '@/lib/app/safety/resources-admin';
import { signOffCrisisCopy, signOffCrisisRegion } from '@/lib/app/safety/crisis-admin';
import { loadCrisisContent, invalidateCrisisContentCache } from '@/lib/app/safety/resources-store';
import type { CrisisResourcesFile } from '@/lib/validations/app-crisis-resources';

beforeEach(async () => {
  db.current = createContentDbFake();
  invalidateCrisisContentCache();
  await seedUnit.run({
    prisma: db.current.client as unknown as PrismaClient,
    logger,
  });
});

function region(code: string) {
  return db.current!.rows('appCrisisRegion').find((row) => row.region === code);
}

/** Sign everything off, as a person would have on this page. */
async function signEverythingOff() {
  const copy = db.current!.rows('appCrisisCopy')[0];
  await signOffCrisisCopy(copy.version as number);
  for (const row of db.current!.rows('appCrisisRegion')) {
    await signOffCrisisRegion(row.region as string, row.version as number);
  }
}

/** What the file would say if someone had written a sign-off into it. */
function claimingSignOff(file: CrisisResourcesFile): CrisisResourcesFile {
  return {
    ...file,
    resources: {
      ...file.resources,
      provenance: {
        status: 'signed_off',
        awaitingSignOffFrom: 'Lelañea Fulton',
        note: 'Signed off in another environment.',
      },
    },
  };
}

describe('nothing signed off crosses', () => {
  it('imports a new region as draft even when the file says signed_off', async () => {
    const file = claimingSignOff(await crisis.exportCrisisFile());
    const withNew = {
      ...file,
      regions: [
        ...file.regions,
        {
          region: 'ZA',
          emergencyNumber: '10111',
          services: [{ name: 'SADAG', contact: 'Call 0800 567 567', hours: '24/7' }],
        },
      ],
    };

    await crisis.applyCrisisImport(withNew, false);

    expect(region('ZA')).toMatchObject({ status: 'draft', signedOffAt: null, version: 1 });
    // And the turn reads it as a draft.
    const served = await loadCrisisContent();
    expect(served.regions.find((row) => row.region === 'ZA')?.status).toBe('draft');
  });

  it('returns a changed, signed-off region to draft even when the file says signed_off', async () => {
    await signEverythingOff();
    const file = claimingSignOff(await crisis.exportCrisisFile());
    const changed = {
      ...file,
      regions: file.regions.map((row) =>
        row.region === 'GB' ? { ...row, emergencyNumber: '112' } : row
      ),
    };
    const before = region('GB')!;

    await crisis.applyCrisisImport(changed, false);

    expect(region('GB')).toMatchObject({
      emergencyNumber: '112',
      status: 'draft',
      signedOffAt: null,
      version: (before.version as number) + 1,
    });
  });

  it('leaves a region the file does not change signed off', async () => {
    await signEverythingOff();
    const file = await crisis.exportCrisisFile();
    const changed = {
      ...file,
      regions: file.regions.map((row) =>
        row.region === 'GB' ? { ...row, emergencyNumber: '112' } : row
      ),
    };
    const other = file.regions.find((row) => row.region !== 'GB')!.region;

    await crisis.applyCrisisImport(changed, false);

    expect(region(other)?.status).toBe('signed_off');
  });

  it('returns changed shared wording to draft', async () => {
    await signEverythingOff();
    const file = claimingSignOff(await crisis.exportCrisisFile());

    await crisis.applyCrisisImport(
      { ...file, copy: { ...file.copy, softIntro: 'Reworded.' } },
      false
    );

    expect(db.current!.rows('appCrisisCopy')[0]).toMatchObject({
      softIntro: 'Reworded.',
      status: 'draft',
      signedOffAt: null,
    });
  });
});

describe('the file round-trip', () => {
  it('plans no writes when a fresh export is imported, and applying it writes nothing', async () => {
    await signEverythingOff();
    const file = await crisis.exportCrisisFile();
    const before = db.current!.fingerprint();

    const preview = await crisis.previewCrisisImport(file, false);
    const applied = await crisis.applyCrisisImport(file, true);

    expect(preview).toMatchObject({ writesNothing: true, refusals: [] });
    expect(applied.plan.writesNothing).toBe(true);
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('exports only the file identity in the header, not a sign-off it cannot vouch for', async () => {
    const file = await crisis.exportCrisisFile();
    expect(file.resources).toEqual({ id: 'lelanea_crisis_resources' });
  });
});

describe('keep by default', () => {
  it('keeps a region the file leaves out, and lists it as kept', async () => {
    const file = await crisis.exportCrisisFile();
    const [dropped, ...rest] = file.regions;

    const { plan } = await crisis.applyCrisisImport({ ...file, regions: rest }, false);

    const section = plan.sections.find((s) => s.entity === 'region')!;
    expect(section.removals).toEqual([]);
    expect(section.kept).toEqual([dropped.region]);
    expect(region(dropped.region)).toBeDefined();
  });

  it('removes it only when asked, and hands back its words for the audit entry', async () => {
    const file = await crisis.exportCrisisFile();
    const [dropped, ...rest] = file.regions;

    const preview = await crisis.previewCrisisImport({ ...file, regions: rest }, true);
    expect(preview.sections.find((s) => s.entity === 'region')?.removals).toEqual([
      { key: dropped.region, changedFields: ['emergencyNumber', 'services'] },
    ]);
    const { removed } = await crisis.applyCrisisImport({ ...file, regions: rest }, true);

    expect(region(dropped.region)).toBeUndefined();
    expect(removed[dropped.region]).toEqual({
      emergencyNumber: dropped.emergencyNumber,
      services: dropped.services,
    });
  });
});

describe('refusals', () => {
  it('refuses a file whose rows a crisis turn could not serve', async () => {
    const file = await crisis.exportCrisisFile();
    const bad = {
      ...file,
      international: { ...file.international, url: 'http://not-https.example.com' },
    };

    await expect(crisis.previewCrisisImport(bad, false)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to import into tables that were never seeded', async () => {
    const file = await crisis.exportCrisisFile();
    db.current = createContentDbFake();

    await expect(crisis.applyCrisisImport(file, false)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'import_refused' },
    });
  });
});
