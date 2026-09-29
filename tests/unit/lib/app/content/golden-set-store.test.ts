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

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  prisma: { appVoiceGoldenSet: { findFirst } },
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
    // Since t-114 the row's `id` is generated; the authored name is `slug`.
    id: 'gen-golden-set',
    slug: seed.id,
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
    findFirst.mockResolvedValue(pointerRow());

    const pointer = await getGoldenSetPointer();

    expect(findFirst).toHaveBeenCalledWith({ where: { slug: VOICE_GOLDEN_SET_ID } });
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
    findFirst.mockResolvedValue(pointerRow({ version: '9.9', status: 'signed_off', revision: 3 }));

    const pointer = await getGoldenSetPointer();

    expect(pointer).toMatchObject({ version: '9.9', status: 'signed_off', revision: 3 });
  });

  it('throws ContentNotSeededError naming the seed unit when there is no row', async () => {
    findFirst.mockResolvedValue(null);

    await expect(getGoldenSetPointer()).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getGoldenSetPointer()).rejects.toThrow(/004-voice-golden-set\.ts/);
  });

  it('throws on a row whose status is outside the known vocabulary', async () => {
    findFirst.mockResolvedValue(pointerRow({ status: 'published' }));

    await expect(getGoldenSetPointer()).rejects.toThrow(/failed validation on read/);
  });

  it('throws on a row with a malformed provenance block', async () => {
    findFirst.mockResolvedValue(pointerRow({ provenance: { status: 'drafted' } }));

    await expect(getGoldenSetPointer()).rejects.toThrow(/failed validation on read/);
  });

  it('reads on the client it is handed, like `seedGoldenSetPointer` beside it', async () => {
    // It used to ignore one, which split `getGoldenSetAdminView`'s three
    // queries across two clients: a caller inside a transaction read two rows
    // on it and this one outside it. Found by /code-review.
    const injected = vi.fn().mockResolvedValue(pointerRow({ version: '4.2' }));
    const client = {
      appVoiceGoldenSet: { findFirst: injected },
    } as unknown as PrismaClient;

    const pointer = await getGoldenSetPointer(client);

    expect(pointer).toMatchObject({ version: '4.2' });
    expect(injected).toHaveBeenCalledWith({ where: { slug: VOICE_GOLDEN_SET_ID } });
    // The module's own client was not touched.
    expect(findFirst).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Writes
// ============================================================================

type Row = Record<string, unknown> & { id?: string; slug?: string };

/**
 * Two tables, held in memory, with the calls the store makes. The pointer row
 * gets a generated `id` on create, as the real table does since t-114.
 */
function inMemoryGoldenSetDb() {
  const tables = { pointer: [] as Row[], revision: [] as Row[] };
  const client = {
    appVoiceGoldenSet: {
      findFirst: vi.fn(
        async ({ where }: { where: { slug: string } }) =>
          tables.pointer.find((row) => row.slug === where.slug) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: `gen-${tables.pointer.length + 1}` };
        tables.pointer.push(row);
        return { id: row.id };
      }),
    },
    appVoiceGoldenSetRevision: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        tables.revision.push({ ...data });
        return data;
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
      id: 'gen-1',
      slug: seed.id,
      version: seed.version,
      status: 'draft',
      revision: 1,
    });
    expect(db.tables.revision).toHaveLength(1);
    expect(db.tables.revision[0]).toMatchObject({
      // By the pointer's generated id, with its name kept beside.
      setId: 'gen-1',
      setSlug: seed.id,
      revision: 1,
      version: seed.version,
      status: 'draft',
      origin: 'seed',
      editorId: null,
      changedFields: [...GOLDEN_SET_SNAPSHOT_FIELDS],
    });
  });

  it('returns skipped with the STORED version and writes nothing on a second call', async () => {
    db.tables.pointer.push({ id: 'gen-stored', slug: seed.id, version: '9.9' });

    const result = await seedGoldenSetPointer(seed, db.client);

    // The row's version, not the seed argument's — the whole point of
    // write-once is that an operator's repoint survives a re-seed.
    expect(result).toEqual({ status: 'skipped', version: '9.9' });
    expect(db.raw.appVoiceGoldenSet.create).not.toHaveBeenCalled();
    expect(db.raw.appVoiceGoldenSetRevision.create).not.toHaveBeenCalled();
    expect(db.raw.$transaction).not.toHaveBeenCalled();
  });
});
