/**
 * The voice overlay store (f-content-seeds t-88): the context-selected layer of
 * her fingerprint, read from `app_voice_overlay_set` / `app_voice_overlay`, and
 * the write-once seed that fills both plus their revisions.
 *
 * Reads are proved against a stub Prisma client returning the rows the real
 * seed builds — the ROW is what is served, not the file, including when the two
 * differ, and an unseeded database is an error rather than an empty answer.
 * Writes are proved against a hand-built in-memory stand-in for the four
 * tables, the same shape
 * `tests/unit/prisma/seeds/app-lelanea/foundational-documents.test.ts` uses for
 * its seed unit — `seedVoiceOverlays` takes its client as an argument rather
 * than only through the module import, so the stub is passed directly instead
 * of going through `vi.mock('@/lib/db/client')`.
 *
 * @see lib/app/content/voice-overlay-store.ts
 * @see lib/app/content/voice-overlay-view.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  prisma: { appVoiceOverlaySet: { findFirst } },
}));

import { ContentNotSeededError } from '@/lib/app/content/document-view';
import {
  getVoiceOverlays,
  seedVoiceOverlays,
  VOICE_OVERLAY_SET_SNAPSHOT_FIELDS,
  VOICE_OVERLAY_SNAPSHOT_FIELDS,
} from '@/lib/app/content/voice-overlay-store';
import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { seededVoiceOverlayRows } from '@/tests/helpers/app/content-stores';

// ============================================================================
// Reads
// ============================================================================

describe('getVoiceOverlays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the set with its overlays ordered by position, and serves them that way', async () => {
    const rows = seededVoiceOverlayRows();
    const expectedOrder = rows.overlays.map((overlay) => overlay.situation);
    // Fed in reverse: the assertion must hold on the PROJECTION's ordering, not
    // on whatever order this stub happens to hand back.
    findFirst.mockResolvedValue({ ...rows.set, overlays: [...rows.overlays].reverse() });

    const overlays = await getVoiceOverlays();

    // By its authored name: since t-114 the set's `id` is generated and the
    // name is its `slug`, unique per org rather than alone.
    expect(findFirst).toHaveBeenCalledWith({
      where: { slug: 'lelanea_voice_fingerprint_overlays' },
      include: { overlays: { orderBy: { position: 'asc' } } },
    });
    expect(overlays.overlays.map((overlay) => overlay.situation)).toEqual(expectedOrder);
    expect(overlays.overlays.length).toBeGreaterThan(0);
  });

  it('serves what the ROW says, not what the file says', async () => {
    // The database is the source. A row that differs from the file is served as
    // the row — this is the point of the whole task.
    const rows = seededVoiceOverlayRows();
    const editedSituation = rows.overlays[0].situation;
    findFirst.mockResolvedValue({
      ...rows.set,
      title: 'Edited title',
      overlays: rows.overlays.map((overlay, index) =>
        index === 0
          ? { ...overlay, heading: 'Edited heading', lines: ['Edited beat.'], revision: 4 }
          : overlay
      ),
    });

    const overlays = await getVoiceOverlays();

    expect(overlays.collection).toMatchObject({ title: 'Edited title' });
    const edited = overlays.overlays.find((overlay) => overlay.situation === editedSituation);
    expect(edited).toMatchObject({
      heading: 'Edited heading',
      lines: ['Edited beat.'],
      revision: 4,
    });
  });

  it('throws ContentNotSeededError naming the seed unit, with no fallback to the file', async () => {
    findFirst.mockResolvedValue(null);

    await expect(getVoiceOverlays()).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getVoiceOverlays()).rejects.toThrow(/019-voice-overlays\.ts/);
  });
});

// ============================================================================
// Writes
// ============================================================================

type Row = Record<string, unknown> & {
  id?: string;
  slug?: string;
  setId?: string;
  situation?: string;
};

/**
 * Four tables, held in memory, with the calls the store makes. Rows get a
 * generated `id` on create, as the real tables do since t-114.
 */
function inMemoryVoiceOverlayDb() {
  const tables = {
    set: [] as Row[],
    overlay: [] as Row[],
    setRevision: [] as Row[],
    overlayRevision: [] as Row[],
  };
  let nextId = 0;
  const generateId = (): string => `gen-${++nextId}`;
  const client = {
    appVoiceOverlaySet: {
      findFirst: vi.fn(
        async ({ where }: { where: { slug: string } }) =>
          tables.set.find((row) => row.slug === where.slug) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: generateId() };
        tables.set.push(row);
        return { id: row.id };
      }),
    },
    appVoiceOverlay: {
      count: vi.fn(
        async ({ where }: { where: { setId: string } }) =>
          tables.overlay.filter((row) => row.setId === where.setId).length
      ),
      createManyAndReturn: vi.fn(async ({ data }: { data: Row[] }) => {
        const rows = data.map((row) => ({ ...structuredClone(row), id: generateId() }));
        tables.overlay.push(...rows);
        return rows.map(({ id, situation }) => ({ id, situation }));
      }),
    },
    appVoiceOverlaySetRevision: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        tables.setRevision.push({ ...data });
        return data;
      }),
    },
    appVoiceOverlayRevision: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        tables.overlayRevision.push(...data.map((row) => structuredClone(row)));
        return { count: data.length };
      }),
    },
    // Interactive form, as the store uses it: the callback gets a tx exposing
    // the same delegates.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      fn(client)
    ),
  };
  return { tables, client: client as unknown as PrismaClient, raw: client };
}

let db: ReturnType<typeof inMemoryVoiceOverlayDb>;

beforeEach(() => {
  db = inMemoryVoiceOverlayDb();
});

describe('seedVoiceOverlays', () => {
  it('writes the set, its overlays and each one’s revision 1, all in one transaction', async () => {
    const seed = buildVoiceOverlaySeed();

    const result = await seedVoiceOverlays(seed, db.client);

    expect(result).toEqual({ status: 'seeded', overlays: seed.overlays.length });
    expect(db.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(db.tables.set).toHaveLength(1);
    expect(db.tables.set[0]).toMatchObject({ slug: seed.set.slug, status: 'draft', revision: 1 });
    expect(db.tables.overlay).toHaveLength(seed.overlays.length);
    expect(db.tables.overlay.every((row) => row.status === 'draft' && row.revision === 1)).toBe(
      true
    );
  });

  it("points every overlay and revision at its parent's generated id, keeping the names beside", async () => {
    const seed = buildVoiceOverlaySeed();

    await seedVoiceOverlays(seed, db.client);

    const set = db.tables.set[0];
    expect(set.id).toEqual(expect.any(String));
    expect(set.id).not.toBe(seed.set.slug);
    for (const overlay of db.tables.overlay) {
      expect(overlay).toMatchObject({ setId: set.id, setSlug: seed.set.slug });
    }
    expect(db.tables.setRevision[0]).toMatchObject({ setId: set.id, setSlug: seed.set.slug });

    const overlayIdBySituation = new Map(
      db.tables.overlay.map((overlay) => [overlay.situation, overlay.id])
    );
    for (const revision of db.tables.overlayRevision) {
      expect(revision.overlayId).toBe(overlayIdBySituation.get(revision.situation as string));
    }
    expect(new Set(db.tables.overlayRevision.map((revision) => revision.overlayId)).size).toBe(
      seed.overlays.length
    );
  });

  it('gives the set and every overlay a v1 revision, seed-origin, with the snapshot fields recorded', async () => {
    const seed = buildVoiceOverlaySeed();

    await seedVoiceOverlays(seed, db.client);

    expect(db.tables.setRevision).toHaveLength(1);
    expect(db.tables.setRevision[0]).toMatchObject({
      revision: 1,
      status: 'draft',
      origin: 'seed',
      editorId: null,
      changedFields: [...VOICE_OVERLAY_SET_SNAPSHOT_FIELDS],
    });

    expect(db.tables.overlayRevision).toHaveLength(seed.overlays.length);
    for (const revision of db.tables.overlayRevision) {
      expect(revision).toMatchObject({
        revision: 1,
        status: 'draft',
        origin: 'seed',
        editorId: null,
        changedFields: [...VOICE_OVERLAY_SNAPSHOT_FIELDS],
      });
    }
  });

  it('writes nothing on a database that already has the set — the operator-owned guarantee', async () => {
    db.tables.set.push({ id: 'set-1', slug: 'lelanea_voice_fingerprint_overlays' });
    // Counted by the stored set's generated id, not its name.
    db.tables.overlay.push({ setId: 'set-1' }, { setId: 'set-1' }, { setId: 'another-set' });
    const seed = buildVoiceOverlaySeed();

    const result = await seedVoiceOverlays(seed, db.client);

    expect(result).toEqual({ status: 'skipped', overlays: 2 });
    expect(db.raw.appVoiceOverlaySet.create).not.toHaveBeenCalled();
    expect(db.raw.appVoiceOverlay.createManyAndReturn).not.toHaveBeenCalled();
    expect(db.raw.appVoiceOverlaySetRevision.create).not.toHaveBeenCalled();
    expect(db.raw.appVoiceOverlayRevision.createMany).not.toHaveBeenCalled();
    expect(db.raw.$transaction).not.toHaveBeenCalled();
  });

  it('re-validates on write: a malformed exemplars block throws rather than storing it', async () => {
    const seed = buildVoiceOverlaySeed();
    const malformed = { ...seed, set: { ...seed.set, exemplars: { heading: 'In her words' } } };

    await expect(seedVoiceOverlays(malformed, db.client)).rejects.toThrow();
    expect(db.tables.set).toHaveLength(0);
  });

  it('re-validates on write: a malformed coreOnly block throws rather than storing it', async () => {
    const seed = buildVoiceOverlaySeed();
    const malformed = {
      ...seed,
      set: { ...seed.set, coreOnly: { heading: 'Her core voice', lines: [] } },
    };

    await expect(seedVoiceOverlays(malformed, db.client)).rejects.toThrow();
    expect(db.tables.set).toHaveLength(0);
  });

  it('re-validates on write: a malformed provenance block throws rather than storing it', async () => {
    const seed = buildVoiceOverlaySeed();
    const malformed = { ...seed, set: { ...seed.set, provenance: { status: 'drafted' } } };

    await expect(seedVoiceOverlays(malformed, db.client)).rejects.toThrow();
    expect(db.tables.set).toHaveLength(0);
  });
});
