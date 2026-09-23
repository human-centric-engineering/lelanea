/**
 * The golden set pointer store (f-content-seeds t-88): which authored version
 * is current, read from and written to `app_voice_golden_set`.
 *
 * Reads are proved against a stub Prisma client returning the row the real
 * seed builds, plus rows this module should refuse: an unknown status, a
 * malformed provenance block, and no row at all. Writes are proved against a
 * hand-built in-memory stand-in for the pointer and its revision table, the
 * same shape `tests/unit/prisma/seeds/app-lelanea/foundational-documents.test.ts`
 * uses for its seed unit — `seedGoldenSetPointer` takes its client as an
 * argument, so the stub is passed directly instead of only through
 * `vi.mock('@/lib/db/client')`.
 *
 * @see lib/app/content/golden-set-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  prisma: { appVoiceGoldenSet: { findUnique } },
}));

import { ContentNotSeededError } from '@/lib/app/content/document-view';
import {
  getGoldenSetPointer,
  seedGoldenSetPointer,
  GOLDEN_SET_SNAPSHOT_FIELDS,
  VOICE_GOLDEN_SET_ID,
} from '@/lib/app/content/golden-set-store';
import { buildGoldenSetSeed } from '@/lib/app/content/seed-input/golden-set-seed';

const seed = buildGoldenSetSeed();

function pointerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: seed.id,
    title: seed.title,
    version: seed.version,
    locale: seed.locale,
    provenance: seed.provenance,
    status: 'draft',
    revision: 1,
    ...overrides,
  };
}

// ============================================================================
// Reads
// ============================================================================

describe('getGoldenSetPointer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects the row into the served pointer shape', async () => {
    findUnique.mockResolvedValue(pointerRow());

    const pointer = await getGoldenSetPointer();

    expect(findUnique).toHaveBeenCalledWith({ where: { id: VOICE_GOLDEN_SET_ID } });
    expect(pointer).toEqual({
      id: seed.id,
      title: seed.title,
      version: seed.version,
      locale: seed.locale,
      provenance: seed.provenance,
      status: 'draft',
      revision: 1,
    });
  });

  it('serves what the ROW says, not what the file says', async () => {
    findUnique.mockResolvedValue(pointerRow({ version: '9.9', status: 'signed_off', revision: 3 }));

    const pointer = await getGoldenSetPointer();

    expect(pointer).toMatchObject({ version: '9.9', status: 'signed_off', revision: 3 });
  });

  it('throws ContentNotSeededError naming the seed unit when there is no row', async () => {
    findUnique.mockResolvedValue(null);

    await expect(getGoldenSetPointer()).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getGoldenSetPointer()).rejects.toThrow(/004-voice-golden-set\.ts/);
  });

  it('throws on a row whose status is outside the known vocabulary', async () => {
    findUnique.mockResolvedValue(pointerRow({ status: 'published' }));

    await expect(getGoldenSetPointer()).rejects.toThrow(/failed validation on read/);
  });

  it('throws on a row with a malformed provenance block', async () => {
    findUnique.mockResolvedValue(pointerRow({ provenance: { status: 'drafted' } }));

    await expect(getGoldenSetPointer()).rejects.toThrow(/failed validation on read/);
  });

  it('reads on the client it is handed, like `seedGoldenSetPointer` beside it', async () => {
    // It used to ignore one, which split `getGoldenSetAdminView`'s three
    // queries across two clients: a caller inside a transaction read two rows
    // on it and this one outside it. Found by /code-review.
    const injected = vi.fn().mockResolvedValue(pointerRow({ version: '4.2' }));
    const client = {
      appVoiceGoldenSet: { findUnique: injected },
    } as unknown as PrismaClient;

    const pointer = await getGoldenSetPointer(client);

    expect(pointer).toMatchObject({ version: '4.2' });
    expect(injected).toHaveBeenCalledWith({ where: { id: VOICE_GOLDEN_SET_ID } });
    // The module's own client was not touched.
    expect(findUnique).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Writes
// ============================================================================

type Row = Record<string, unknown> & { id?: string };

/** Two tables, held in memory, with the calls the store makes. */
function inMemoryGoldenSetDb() {
  const tables = { pointer: [] as Row[], revision: [] as Row[] };
  const client = {
    appVoiceGoldenSet: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          tables.pointer.find((row) => row.id === where.id) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        tables.pointer.push({ ...data });
        return data;
      }),
    },
    appVoiceGoldenSetRevision: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        tables.revision.push({ ...data });
        return data;
      }),
    },
    // Array form, as the store uses it: every operation already started.
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  return { tables, client: client as unknown as PrismaClient, raw: client };
}

let db: ReturnType<typeof inMemoryGoldenSetDb>;

beforeEach(() => {
  db = inMemoryGoldenSetDb();
});

describe('seedGoldenSetPointer', () => {
  it('writes the pointer and its revision 1, once, in one transaction', async () => {
    const result = await seedGoldenSetPointer(seed, db.client);

    expect(result).toEqual({ status: 'seeded' });
    expect(db.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(db.tables.pointer).toHaveLength(1);
    expect(db.tables.pointer[0]).toMatchObject({
      id: seed.id,
      version: seed.version,
      status: 'draft',
      revision: 1,
    });
    expect(db.tables.revision).toHaveLength(1);
    expect(db.tables.revision[0]).toMatchObject({
      setId: seed.id,
      revision: 1,
      version: seed.version,
      status: 'draft',
      origin: 'seed',
      editorId: null,
      changedFields: [...GOLDEN_SET_SNAPSHOT_FIELDS],
    });
  });

  it('returns skipped with the STORED version and writes nothing on a second call', async () => {
    db.tables.pointer.push({ id: seed.id, version: '9.9' });

    const result = await seedGoldenSetPointer(seed, db.client);

    // The row's version, not the seed argument's — the whole point of
    // write-once is that an operator's repoint survives a re-seed.
    expect(result).toEqual({ status: 'skipped', version: '9.9' });
    expect(db.raw.appVoiceGoldenSet.create).not.toHaveBeenCalled();
    expect(db.raw.appVoiceGoldenSetRevision.create).not.toHaveBeenCalled();
    expect(db.raw.$transaction).not.toHaveBeenCalled();
  });
});
