/**
 * The slot taxonomy seed: fills an empty table from the bundled file, and never
 * touches it again (f-slots t-70).
 *
 * ## `fp4` — operator-owned, written once
 *
 * The cases that matter come after the first, and they are the ones a
 * per-slug "create if absent" would get wrong: a re-run must leave an admin's
 * rewording alone, and must not revive a slot an admin retired. A retired row
 * is still a row, which is why emptiness — not the absence of a given slug —
 * is what decides.
 *
 * ## The projection is half the unit
 *
 * On a fresh database `_framework/000-framework-boot.ts` runs BEFORE this one,
 * so the boot-time global pass reads an empty table and correctly writes
 * nothing. Without the sync call at the bottom of `run()`,
 * `framework_slot_definition` would hold no global row until the next server
 * boot — and `db:reset` in CI never boots a server. That is asserted here
 * rather than trusted.
 *
 * @see prisma/seeds/app-lelanea/011-slot-taxonomy.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

/** Stands in for the leaf boot seam: the unit calls it to register the provider. */
const initLeafApp = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/app/leaf-bootstrap', () => ({ initLeafApp }));

/** Stands in for Daybreak's global pass. */
const syncGlobalSlotDefinitions = vi.hoisted(() =>
  vi.fn(async () => ({
    status: 'synced' as const,
    provided: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: [] as string[],
  }))
);
// Partial: the content loader reaches the same barrel for the framework's
// classifier vocabulary, so replacing the whole module would break its parse.
vi.mock('@/lib/framework/data-slots', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/framework/data-slots')>()),
  syncGlobalSlotDefinitions,
}));

/** Lets one case seed from a short, controlled file instead of the real one. */
const override = vi.hoisted(() => ({ slots: null as unknown[] | null }));
vi.mock('@/lib/app/content/slot-taxonomy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/content/slot-taxonomy')>();
  return {
    ...actual,
    getSlotTaxonomy: () => {
      const file = actual.getSlotTaxonomy();
      if (override.slots === null) return file;
      return { ...file, slots: override.slots };
    },
  };
});

import unit from '@/prisma/seeds/app-lelanea/011-slot-taxonomy';
import { getSlotTaxonomy } from '@/lib/app/content/slot-taxonomy';
import { SLOT_DEFINITION_FIELDS } from '@/lib/app/slots/taxonomy-store';

interface DefinitionRow {
  slug: string;
  group: string;
  description: string;
  visibility: string;
  mode: string;
  dataType: string;
  sensitivity: string;
  priorityWeight: number;
  isActive: boolean;
  version: number;
}

interface RevisionRow {
  slotSlug: string;
  version: number;
  description: string;
  isActive: boolean;
  changedFields: string[];
  origin: string;
  editorId: string | null;
}

let definitions: DefinitionRow[];
let revisions: RevisionRow[];

const prisma = {
  appSlotDefinition: {
    findFirst: vi.fn(async () => definitions[0] ?? null),
    count: vi.fn(async (args?: { where?: { isActive?: boolean } }) =>
      args?.where?.isActive === undefined
        ? definitions.length
        : definitions.filter((d) => d.isActive === args.where?.isActive).length
    ),
    createMany: vi.fn(async ({ data }: { data: DefinitionRow[] }) => {
      for (const d of data) if (!definitions.some((x) => x.slug === d.slug)) definitions.push(d);
      return { count: data.length };
    }),
  },
  appSlotDefinitionRevision: {
    createMany: vi.fn(async ({ data }: { data: RevisionRow[] }) => {
      revisions.push(...data);
      return { count: data.length };
    }),
  },
  $transaction: vi.fn(async (writes: Array<Promise<unknown>>) => Promise.all(writes)),
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function run(): Promise<void> {
  await unit.run({ prisma: prisma as never, logger: logger as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  override.slots = null;
  definitions = [];
  revisions = [];
});

describe('011-slot-taxonomy — the first run', () => {
  it('creates every definition in the file, each active at v1', async () => {
    const file = getSlotTaxonomy();
    await run();

    expect(definitions).toHaveLength(file.slots.length);
    expect(definitions.map((d) => d.slug).sort()).toEqual(file.slots.map((s) => s.slug).sort());
    expect(definitions.every((d) => d.isActive && d.version === 1)).toBe(true);

    // Field-by-field on one slot, so a column silently dropped from the seed's
    // payload fails here rather than shipping a taxonomy missing a classifier.
    const authored = file.slots.find((s) => s.group === 'development');
    const stored = definitions.find((d) => d.slug === authored?.slug);
    expect(stored).toMatchObject({
      group: authored?.group,
      description: authored?.description,
      visibility: 'hidden',
      mode: authored?.mode,
      dataType: authored?.dataType,
      sensitivity: authored?.sensitivity,
      priorityWeight: authored?.priorityWeight,
    });
  });

  it('writes a v1 revision per definition, from the seed and not from a person', async () => {
    const file = getSlotTaxonomy();
    await run();

    expect(revisions).toHaveLength(file.slots.length);
    expect(revisions.every((r) => r.version === 1)).toBe(true);
    expect(revisions.every((r) => r.origin === 'seed')).toBe(true);
    // `editorId` null AND `origin` seed. The origin is what distinguishes this
    // from a revision an erased admin left behind, which is also null.
    expect(revisions.every((r) => r.editorId === null)).toBe(true);
    // Against nothing, everything is new — so the history view reads v1 as the
    // creation rather than as a change to eight fields.
    expect(revisions.every((r) => r.changedFields.length === SLOT_DEFINITION_FIELDS.length)).toBe(
      true
    );
  });

  it('writes the definitions and their history in ONE transaction', async () => {
    await run();
    // The marker is "any definition row exists", so a partial write — rows
    // without their v1 history — would be read as "already seeded" forever and
    // the history would start at v2.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('projects the result into the framework table', async () => {
    await run();
    expect(syncGlobalSlotDefinitions).toHaveBeenCalledTimes(1);
    // After the write, not before: the boot pass already ran against an empty
    // table on a fresh database.
    const syncOrder = syncGlobalSlotDefinitions.mock.invocationCallOrder[0];
    const writeOrder = prisma.$transaction.mock.invocationCallOrder[0];
    expect(syncOrder).toBeGreaterThan(writeOrder);
  });

  it('registers the provider first, because the boot unit may have been skipped', async () => {
    await run();
    expect(initLeafApp).toHaveBeenCalledTimes(1);
    expect(initLeafApp.mock.invocationCallOrder[0]).toBeLessThan(
      syncGlobalSlotDefinitions.mock.invocationCallOrder[0]
    );
  });
});

describe('011-slot-taxonomy — a re-run', () => {
  it('writes nothing when the table already holds definitions', async () => {
    await run();
    vi.clearAllMocks();

    await run();

    expect(prisma.appSlotDefinition.createMany).not.toHaveBeenCalled();
    expect(prisma.appSlotDefinitionRevision.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('leaves an admin-edited row alone', async () => {
    await run();
    const edited = definitions[0];
    edited.description = 'Reworded by an admin.';
    edited.version = 2;
    const before = structuredClone(definitions);

    await run();

    expect(definitions).toEqual(before);
  });

  it('does not revive a slot an admin retired', async () => {
    await run();
    const retired = definitions[0];
    retired.isActive = false;
    const retiredSlug = retired.slug;

    await run();

    // The case a per-slug "create if absent" gets wrong: a retired row is still
    // a row, and recreating it would undo the retirement on every seed run.
    expect(definitions.filter((d) => d.slug === retiredSlug)).toHaveLength(1);
    expect(definitions.find((d) => d.slug === retiredSlug)?.isActive).toBe(false);
  });

  it('does not add a slot the file gained after seeding', async () => {
    await run();
    const seeded = definitions.length;

    override.slots = [
      ...getSlotTaxonomy().slots,
      {
        slug: 'added_later',
        group: 'the_person',
        description: 'Added to the file after the database was seeded.',
        visibility: 'open',
        mode: 'targeted',
        dataType: 'text',
        sensitivity: 'standard',
        priorityWeight: 0,
      },
    ];
    await run();

    // Once seeded, the tables are the taxonomy and the editor is how a slot is
    // added. An edit to the file reaches an unseeded database and nothing else.
    expect(definitions).toHaveLength(seeded);
    expect(definitions.some((d) => d.slug === 'added_later')).toBe(false);
  });

  it('still re-syncs, so a lost projection is repaired', async () => {
    await run();
    vi.clearAllMocks();

    await run();

    expect(syncGlobalSlotDefinitions).toHaveBeenCalledTimes(1);
  });
});

describe('011-slot-taxonomy — safe on empty', () => {
  it('deletes nothing when the file has no slots', async () => {
    await run();
    const before = structuredClone(definitions);
    vi.clearAllMocks();

    override.slots = [];
    await run();

    // Two guards, and the second is the one that matters: the unit short-
    // circuits on the marker anyway, and it has no removal pass at all — so an
    // emptied file cannot retire the taxonomy even on an unseeded database.
    expect(definitions).toEqual(before);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes nothing at either tier when the file is empty and the table is too', async () => {
    override.slots = [];
    syncGlobalSlotDefinitions.mockResolvedValueOnce({
      status: 'empty',
    } as never);

    await run();

    expect(definitions).toEqual([]);
    expect(revisions).toEqual([]);
  });
});

describe('011-slot-taxonomy — a failing sync', () => {
  it('fails the seed rather than reporting success', async () => {
    // A seed that reports success while the taxonomy reached no agent is
    // exactly the silent failure this unit exists to prevent.
    syncGlobalSlotDefinitions.mockRejectedValueOnce(new Error('sync exploded'));
    await expect(run()).rejects.toThrow('sync exploded');
  });
});
