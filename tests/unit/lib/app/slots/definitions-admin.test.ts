/**
 * The slot-definition editor's writer (f-slots t-71).
 *
 * What is proved here rather than at the route: the change rule (an edit that
 * changes nothing writes no revision and bumps no version), the optimistic lock
 * in both of its layers, that every write appends history and asks for the
 * re-sync, that a retirement withholds the slug from the provider while leaving
 * every answer captured under it readable, and that an upload's preview is the
 * plan its apply runs.
 *
 * ## The fake, and why it is stateful (`B9`)
 *
 * Unit tests here have no database, and canned return values would prove only
 * that the module calls Prisma. The chains that matter are multi-step — write,
 * then read back what the write did; apply a file twice and see the second do
 * nothing — so the mock below is a small in-memory store with the two
 * behaviours the module actually leans on: a conditional `updateMany` that
 * applies only while the version still matches, and rows that persist between
 * calls.
 *
 * `select` is ignored: it is a projection, and nothing here asserts on the
 * absence of a column. Ordering is not, because the view's group list is
 * derived from the order rows come back in.
 *
 * @see lib/app/slots/definitions-admin.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown> & { slug: string; version: number };
type Revision = Record<string, unknown> & { slotSlug: string; version: number };

const store = vi.hoisted(() => ({
  definitions: [] as Row[],
  revisions: [] as Revision[],
  values: [] as Record<string, unknown>[],
  users: [] as { id: string; email: string }[],
}));

const sync = vi.hoisted(() => vi.fn());

const db = vi.hoisted(() => {
  const byOrder = (rows: Row[]) =>
    [...rows].sort((a, b) =>
      a.group === b.group
        ? a.slug.localeCompare(b.slug)
        : String(a.group).localeCompare(String(b.group))
    );

  const definition = {
    // `where` is honoured for `isActive` and nothing else — it is the only
    // predicate either reader uses, and it is load-bearing: the provider's whole
    // retirement mechanism is `where: { isActive: true }`, so a fake that
    // ignored it would pass the test that proves a retired slug is withheld.
    findMany: vi.fn(async ({ where }: { where?: { isActive?: boolean } } = {}) =>
      byOrder(
        where?.isActive === undefined
          ? store.definitions
          : store.definitions.filter((row) => row.isActive === where.isActive)
      )
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { slug: string } }) =>
        store.definitions.find((row) => row.slug === where.slug) ?? null
    ),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { slug: string } }) => {
      const row = store.definitions.find((r) => r.slug === where.slug);
      if (!row) throw new Error(`no definition ${where.slug}`);
      return row;
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { createdAt: NOW, updatedAt: NOW, ...data };
      store.definitions.push(row);
      return row;
    }),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      for (const row of data) store.definitions.push({ createdAt: NOW, updatedAt: NOW, ...row });
      return { count: data.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { slug: string }; data: Partial<Row> }) => {
      const row = store.definitions.find((r) => r.slug === where.slug);
      if (!row) throw new Error(`no definition ${where.slug}`);
      Object.assign(row, data, { updatedAt: NOW });
      return row;
    }),
    // The lock's second layer: applies only where the version still matches.
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { slug: string; version?: number };
        data: Partial<Row>;
      }) => {
        const row = store.definitions.find((r) => r.slug === where.slug);
        if (!row || (where.version !== undefined && row.version !== where.version)) {
          return { count: 0 };
        }
        Object.assign(row, data, { updatedAt: NOW });
        return { count: 1 };
      }
    ),
  };

  const revision = {
    findMany: vi.fn(async ({ where }: { where: { slotSlug: string } }) =>
      store.revisions
        .filter((r) => r.slotSlug === where.slotSlug)
        .sort((a, b) => b.version - a.version)
    ),
    create: vi.fn(async ({ data }: { data: Revision }) => {
      const row = { id: `rev-${store.revisions.length + 1}`, changedAt: NOW, ...data };
      store.revisions.push(row);
      return row;
    }),
    createMany: vi.fn(async ({ data }: { data: Revision[] }) => {
      for (const row of data) {
        store.revisions.push({ id: `rev-${store.revisions.length + 1}`, changedAt: NOW, ...row });
      }
      return { count: data.length };
    }),
  };

  return {
    appSlotDefinition: definition,
    appSlotDefinitionRevision: revision,
    slotValue: {
      findMany: vi.fn(async () => store.values),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        store.users.filter((u) => where.id.in.includes(u.id))
      ),
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: db }));
vi.mock('@/lib/db/utils', () => ({
  // The real one forwards to `prisma.$transaction`; the fake forwards to the
  // same store, so a throw inside the callback still propagates and the module's
  // "throw to roll the revision back" path is exercised — what it cannot prove
  // is the rollback itself, which is Postgres's.
  executeTransaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
}));
vi.mock('@/lib/framework/data-slots', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/framework/data-slots')>()),
  syncGlobalSlotDefinitions: sync,
}));

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { getSlotHeads } from '@/lib/framework/data-slots';
import { loadGlobalSlotDefinitions } from '@/lib/app/slots/taxonomy-store';
import {
  applyTaxonomyUpload,
  createSlotDefinition,
  exportTaxonomyFile,
  taxonomyExportFilename,
  planTaxonomyUpload,
  getSlotTaxonomyAdminView,
  listSlotDefinitionHistory,
  previewTaxonomyUpload,
  setSlotDefinitionActive,
  updateSlotDefinition,
} from '@/lib/app/slots/definitions-admin';

const NOW = new Date('2026-09-20T12:00:00Z');
const ADMIN = 'admin-1';

const FIELDS = {
  group: 'life_areas',
  description: 'How their body stands right now, in their own words.',
  visibility: 'open',
  mode: 'targeted',
  dataType: 'text',
  sensitivity: 'special_category',
  priorityWeight: 70,
  isActive: true,
} as const;

/** The authored half of an edit — what `PUT` sends, minus the version. */
const UPDATE = {
  group: FIELDS.group,
  description: FIELDS.description,
  visibility: FIELDS.visibility,
  dataType: FIELDS.dataType,
  sensitivity: FIELDS.sensitivity,
  priorityWeight: FIELDS.priorityWeight,
} as const;

function seedDefinition(slug: string, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    slug,
    ...FIELDS,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
  store.definitions.push(row);
  return row;
}

/**
 * A taxonomy file in the shape `slotTaxonomyFileSchema` accepts.
 *
 * The defaults deliberately differ from {@link FIELDS}, so a slot seeded with
 * FIELDS and listed here with no overrides reads as an edit. Pass
 * `{ ...FIELDS }` to express "the file agrees with what is stored".
 */
function taxonomyFile(
  slots: {
    slug: string;
    group?: string;
    description?: string;
    sensitivity?: string;
    priorityWeight?: number;
  }[]
) {
  const entries = slots.map((slot) => ({
    slug: slot.slug,
    group: slot.group ?? 'life_areas',
    description: slot.description ?? 'From the file.',
    visibility: 'open',
    mode: 'targeted',
    dataType: 'text',
    sensitivity: slot.sensitivity ?? 'standard',
    priorityWeight: slot.priorityWeight ?? 50,
  }));
  return {
    taxonomy: {
      id: 'lelanea_slot_taxonomy',
      title: 'Test taxonomy',
      version: '1.0',
      locale: 'en-GB',
      provenance: { status: 'draft', awaitingSignOffFrom: 'the owner', note: 'a test file' },
      notes: ['a note'],
    },
    groups: [...new Set(entries.map((e) => e.group))].map((key) => ({
      key,
      title: key,
      description: `the ${key} group`,
    })),
    slots: entries,
  };
}

beforeEach(() => {
  store.definitions = [];
  store.revisions = [];
  store.values = [];
  store.users = [];
  vi.clearAllMocks();
  sync.mockResolvedValue({
    status: 'synced',
    provided: 1,
    created: 0,
    updated: 1,
    deactivated: 0,
    skipped: [],
  });
});

describe('reading the taxonomy', () => {
  it('shows retired definitions too, and derives the group list from what is stored', async () => {
    seedDefinition('life_physical_health');
    seedDefinition('person_disposition', { group: 'the_person', isActive: false });

    const view = await getSlotTaxonomyAdminView();

    expect(view.seeded).toBe(true);
    expect(view.definitions.map((d) => d.slug)).toEqual([
      'life_physical_health',
      'person_disposition',
    ]);
    // A retired slot is what someone comes here to restore. Hiding it would make
    // a retirement look like the deletion this table never does.
    expect(view.definitions.find((d) => d.slug === 'person_disposition')?.isActive).toBe(false);
    expect(view.groups).toEqual(['life_areas', 'the_person']);
  });

  it('reports an unseeded database rather than an empty taxonomy', async () => {
    const view = await getSlotTaxonomyAdminView();
    expect(view).toMatchObject({ seeded: false, definitions: [], groups: [] });
  });
});

describe('adding a definition', () => {
  it('is born at v1 with every field in its history, and asks for the re-sync', async () => {
    const { definition, sync: outcome } = await createSlotDefinition(
      { slug: 'life_work', ...UPDATE },
      ADMIN
    );

    expect(definition).toMatchObject({ slug: 'life_work', version: 1, isActive: true });
    // Never offered and never written otherwise: a definition row IS the
    // pre-declaration.
    expect(definition.mode).toBe('targeted');
    expect(store.revisions).toHaveLength(1);
    expect(store.revisions[0]).toMatchObject({
      slotSlug: 'life_work',
      version: 1,
      origin: 'admin',
      editorId: ADMIN,
    });
    // Against nothing, everything is new — so the history view reads v1 as the
    // creation rather than as a change to eight things at once.
    expect(store.revisions[0]?.changedFields).toEqual([
      'group',
      'description',
      'visibility',
      'mode',
      'dataType',
      'sensitivity',
      'priorityWeight',
      'isActive',
    ]);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('synced');
  });

  it('refuses a slug that is already taken, writing nothing', async () => {
    seedDefinition('life_work');

    await expect(createSlotDefinition({ slug: 'life_work', ...UPDATE }, ADMIN)).rejects.toThrow(
      ConflictError
    );
    expect(store.revisions).toHaveLength(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it('says so when the slug belongs to a RETIRED definition, rather than "already exists"', async () => {
    // Otherwise the admin sees a clash on a slug the editor is not showing them,
    // and invents a slug variant — the one thing a slug must never become.
    seedDefinition('life_work', { isActive: false });

    await expect(
      createSlotDefinition({ slug: 'life_work', ...UPDATE }, ADMIN)
    ).rejects.toMatchObject({
      status: 409,
      details: { reason: 'retired', slug: 'life_work' },
    });
  });
});

describe('rewording a definition', () => {
  it('appends a revision, bumps the version, and asks for the re-sync', async () => {
    seedDefinition('life_work', { version: 3 });

    const result = await updateSlotDefinition(
      'life_work',
      { ...UPDATE, description: 'Reworded.' },
      3,
      ADMIN
    );

    expect(result.changed).toEqual(['description']);
    expect(result.definition.version).toBe(4);
    expect(store.definitions[0]?.description).toBe('Reworded.');
    expect(store.revisions).toHaveLength(1);
    expect(store.revisions[0]).toMatchObject({
      version: 4,
      description: 'Reworded.',
      changedFields: ['description'],
      origin: 'admin',
      editorId: ADMIN,
    });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('writes nothing at all when nothing changed — no revision, no bump, no re-sync', async () => {
    // The change rule. Without it, opening a form and pressing save would put a
    // version in the history whose wording is the previous one's.
    seedDefinition('life_work', { version: 3 });

    const result = await updateSlotDefinition('life_work', UPDATE, 3, ADMIN);

    expect(result.changed).toEqual([]);
    expect(result.definition.version).toBe(3);
    expect(store.revisions).toHaveLength(0);
    expect(db.appSlotDefinition.updateMany).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(result.sync.status).toBe('not_needed');
  });

  it('refuses 409 a save from a stale form, leaving the other edit standing', async () => {
    // Another admin saved v3 → v4 after this one opened the form at v3.
    seedDefinition('life_work', { version: 4, description: 'Corrected by someone else.' });

    await expect(
      updateSlotDefinition('life_work', { ...UPDATE, description: 'Mine.' }, 3, ADMIN)
    ).rejects.toMatchObject({
      status: 409,
      details: { reason: 'version_moved', currentVersion: 4 },
    });

    expect(db.appSlotDefinition.updateMany).not.toHaveBeenCalled();
    expect(store.definitions[0]?.description).toBe('Corrected by someone else.');
    expect(store.revisions).toHaveLength(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it('refuses 409 a save that loses the race between the read and the write', async () => {
    // The second layer: the version was still 3 when it was read, and had moved
    // by the time the conditional update ran.
    seedDefinition('life_work', { version: 3 });
    db.appSlotDefinition.updateMany.mockImplementationOnce(async () => {
      store.definitions[0].version = 4;
      return { count: 0 };
    });

    await expect(
      updateSlotDefinition('life_work', { ...UPDATE, description: 'Mine.' }, 3, ADMIN)
    ).rejects.toMatchObject({
      status: 409,
      details: { reason: 'version_moved', currentVersion: 4 },
    });
    expect(sync).not.toHaveBeenCalled();
  });

  it('refuses 404 a slug that does not exist', async () => {
    await expect(updateSlotDefinition('nope', UPDATE, 1, ADMIN)).rejects.toThrow(NotFoundError);
  });
});

describe('retiring and restoring', () => {
  it('retires without deleting, records it as a field change, and re-syncs', async () => {
    seedDefinition('life_work', { version: 2 });

    const result = await setSlotDefinitionActive('life_work', false, 2, ADMIN);

    expect(result.changed).toEqual(['isActive']);
    expect(store.definitions).toHaveLength(1);
    expect(store.definitions[0]?.isActive).toBe(false);
    expect(store.revisions[0]).toMatchObject({ version: 3, isActive: false, origin: 'admin' });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('withholds a retired slug from the provider, which is what deactivates its projection', async () => {
    // Withholding IS the retirement mechanism — pinned upstream as "a slug the
    // provider drops is deactivated".
    seedDefinition('life_work', { version: 1 });
    seedDefinition('life_money', { version: 1 });

    await setSlotDefinitionActive('life_work', false, 1, ADMIN);

    const provided = await loadGlobalSlotDefinitions();
    expect(provided.map((d) => d.slug)).toEqual(['life_money']);
  });

  it('restores one, and writes that as its own version', async () => {
    seedDefinition('life_work', { version: 4, isActive: false });

    const result = await setSlotDefinitionActive('life_work', true, 4, ADMIN);

    expect(result.changed).toEqual(['isActive']);
    expect(store.definitions[0]?.isActive).toBe(true);
    expect(store.revisions[0]).toMatchObject({ version: 5, isActive: true });
  });

  it('writes nothing when the definition is already in that state', async () => {
    seedDefinition('life_work', { version: 2 });

    const result = await setSlotDefinitionActive('life_work', true, 2, ADMIN);

    expect(result.changed).toEqual([]);
    expect(store.revisions).toHaveLength(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it('leaves every answer captured under a retired slug readable', async () => {
    // The promise retirement makes: the row stays, the values stay, and the
    // history explains them. Driven through the framework's own read path,
    // because that is what a member's panel and the agent both call.
    seedDefinition('life_work', { version: 1 });
    store.values.push({
      id: 'v1',
      userId: 'user-1',
      slotSlug: 'life_work',
      version: 1,
      value: 'Stretched, but it matters to me.',
      supersededAt: null,
    });

    await setSlotDefinitionActive('life_work', false, 1, ADMIN);

    const heads = await getSlotHeads('user-1');
    expect(heads.map((h) => h.slotSlug)).toEqual(['life_work']);
    expect(heads[0]?.value).toBe('Stretched, but it matters to me.');
  });
});

describe('the history view', () => {
  it('reads newest first and names the admin who made each edit', async () => {
    seedDefinition('life_work', { version: 1 });
    store.users.push({ id: ADMIN, email: 'admin@example.com' });
    await updateSlotDefinition('life_work', { ...UPDATE, description: 'Reworded.' }, 1, ADMIN);
    store.revisions.unshift({
      id: 'rev-seed',
      slotSlug: 'life_work',
      version: 1,
      ...FIELDS,
      changedFields: ['group'],
      origin: 'seed',
      editorId: null,
      changedAt: NOW,
    });

    const history = await listSlotDefinitionHistory('life_work');

    expect(history.map((r) => r.version)).toEqual([2, 1]);
    expect(history[0]).toMatchObject({ origin: 'admin', editorEmail: 'admin@example.com' });
    // A null editor on a seed row is the ordinary case, and `origin` is what
    // distinguishes it from an admin whose account has since been erased.
    expect(history[1]).toMatchObject({ origin: 'seed', editorId: null, editorEmail: null });
  });

  it('refuses 404 for a slug that does not exist', async () => {
    await expect(listSlotDefinitionHistory('nope')).rejects.toThrow(NotFoundError);
  });
});

describe('uploading a taxonomy file', () => {
  it('previews exactly what applying writes', async () => {
    seedDefinition('life_work', { version: 2, description: 'Stored wording.' });
    seedDefinition('life_money', { version: 1 });
    const file = taxonomyFile([
      { slug: 'life_work', description: 'File wording.' },
      { slug: 'life_new' },
    ]);

    const preview = await previewTaxonomyUpload(file, 'merge');
    const { plan } = await applyTaxonomyUpload(file, 'merge', ADMIN);

    expect(plan).toEqual(preview);
    expect(preview.creates.map((c) => c.slug)).toEqual(['life_new']);
    expect(preview.updates.map((u) => u.slug)).toEqual(['life_work']);
    expect(preview.absentFromFile).toEqual(['life_money']);
  });

  it('merge never retires what the file omits', async () => {
    seedDefinition('life_money', { version: 1 });

    const { plan } = await applyTaxonomyUpload(
      taxonomyFile([{ slug: 'life_new' }]),
      'merge',
      ADMIN
    );

    expect(plan.retirements).toEqual([]);
    expect(plan.absentFromFile).toEqual(['life_money']);
    expect(store.definitions.find((d) => d.slug === 'life_money')?.isActive).toBe(true);
  });

  it('replace retires what the file omits, and names every one of them first', async () => {
    seedDefinition('life_money', { version: 1 });

    const preview = await previewTaxonomyUpload(taxonomyFile([{ slug: 'life_new' }]), 'replace');
    expect(preview.retirements.map((r) => r.slug)).toEqual(['life_money']);

    await applyTaxonomyUpload(taxonomyFile([{ slug: 'life_new' }]), 'replace', ADMIN);
    expect(store.definitions.find((d) => d.slug === 'life_money')?.isActive).toBe(false);
    // Retired, not deleted — at either tier.
    expect(store.definitions).toHaveLength(2);
  });

  it('leaves a retired slug retired even when the file lists it', async () => {
    // The file format cannot express retirement, so a retired slug appearing in
    // it is indistinguishable from one that was never retired. Reviving it on
    // that evidence is the seed's own documented trap.
    seedDefinition('life_work', { version: 3, isActive: false });

    const { plan } = await applyTaxonomyUpload(
      taxonomyFile([{ slug: 'life_work', description: 'File wording.' }]),
      'merge',
      ADMIN
    );

    expect(plan.skippedRetired).toEqual(['life_work']);
    expect(plan.updates).toEqual([]);
    expect(store.definitions[0]).toMatchObject({ isActive: false, version: 3 });
    expect(store.revisions).toHaveLength(0);
  });

  it('is idempotent — applying the same file twice writes once', async () => {
    const file = taxonomyFile([{ slug: 'life_work' }, { slug: 'life_money' }]);

    const first = await applyTaxonomyUpload(file, 'replace', ADMIN);
    expect(first.plan.creates).toHaveLength(2);
    expect(store.revisions).toHaveLength(2);

    const second = await applyTaxonomyUpload(file, 'replace', ADMIN);
    expect(second.plan.creates).toEqual([]);
    expect(second.plan.updates).toEqual([]);
    expect(second.plan.retirements).toEqual([]);
    // In the file's order, not the table's: the plan is a reading of the file.
    expect(second.plan.unchanged).toEqual(['life_work', 'life_money']);
    expect(store.revisions).toHaveLength(2);
    expect(second.sync.status).toBe('not_needed');
  });

  it('writes one revision per changed slot, and none for the untouched', async () => {
    seedDefinition('life_work', { version: 1, description: 'Stored.' });
    seedDefinition('life_money', { version: 1 });

    await applyTaxonomyUpload(
      taxonomyFile([
        { slug: 'life_work', description: 'Changed.' },
        // Every authored field as stored, so this one is genuinely untouched.
        {
          slug: 'life_money',
          description: FIELDS.description,
          sensitivity: FIELDS.sensitivity,
          priorityWeight: FIELDS.priorityWeight,
        },
      ]),
      'merge',
      ADMIN
    );

    expect(store.revisions).toHaveLength(1);
    expect(store.revisions[0]).toMatchObject({
      slotSlug: 'life_work',
      version: 2,
      origin: 'admin',
    });
  });

  it('refuses a file that is not a taxonomy, writing nothing', async () => {
    await expect(previewTaxonomyUpload({ slots: [] }, 'merge')).rejects.toThrow(ValidationError);
    await expect(applyTaxonomyUpload({ slots: [] }, 'merge', ADMIN)).rejects.toThrow(
      ValidationError
    );
    expect(store.definitions).toHaveLength(0);
  });

  it('refuses an open-mode row by name rather than coercing it', async () => {
    const file = taxonomyFile([{ slug: 'life_work' }]);
    file.slots[0].mode = 'open';

    await expect(previewTaxonomyUpload(file, 'merge')).rejects.toMatchObject({
      status: 400,
      details: { openMode: ['life_work'] },
    });
  });
});

describe('the re-sync', () => {
  it('reports a failed projection rather than throwing away a committed edit', async () => {
    // The edit IS saved. Throwing here would tell the admin nothing happened.
    seedDefinition('life_work', { version: 1 });
    sync.mockRejectedValueOnce(new Error('the provider blew up'));

    const result = await updateSlotDefinition(
      'life_work',
      { ...UPDATE, description: 'Reworded.' },
      1,
      ADMIN
    );

    expect(result.sync).toEqual({ status: 'failed', message: 'the provider blew up' });
    expect(store.definitions[0]?.description).toBe('Reworded.');
    expect(store.revisions).toHaveLength(1);
  });

  it('passes a non-synced status through, distinct from never having run', async () => {
    seedDefinition('life_work', { version: 1 });
    sync.mockResolvedValueOnce({ status: 'empty' });

    const result = await setSlotDefinitionActive('life_work', false, 1, ADMIN);

    expect(result.sync.status).toBe('empty');
  });
});

describe('exporting the taxonomy', () => {
  const NOON = new Date('2026-09-20T12:00:00.000Z');

  it('round-trips: importing a fresh export plans nothing', async () => {
    // The whole reason the export exists in this shape. Not "the formats look
    // alike" — the planner is run against the exported file and asserted to
    // find nothing to do.
    seedDefinition('life_work', { version: 2 });
    seedDefinition('person_disposition', { group: 'the_person', version: 1 });

    const file = await exportTaxonomyFile(NOON);
    const { definitions } = await getSlotTaxonomyAdminView();
    const plan = planTaxonomyUpload(file, 'replace', definitions);

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.retirements).toEqual([]);
    expect(plan.unchanged.sort()).toEqual(['life_work', 'person_disposition']);
  });

  it('leaves retired definitions out, so a round trip cannot resurrect them', async () => {
    // The format has no `isActive`. Exporting a retired slot would write it as
    // active, and importing that into a fresh database would undo every
    // retirement ever made.
    seedDefinition('life_work', { version: 1 });
    seedDefinition('life_old', { version: 4, isActive: false });

    const file = await exportTaxonomyFile(NOON);

    expect(file.slots.map((slot) => slot.slug)).toEqual(['life_work']);
  });

  it('declares exactly the groups its slots use', async () => {
    // Forced rather than chosen: the schema requires every slot to name a
    // declared group AND every declared group to hold a slot.
    seedDefinition('life_work', { version: 1 });
    seedDefinition('person_disposition', { group: 'the_person', version: 1 });
    seedDefinition('old_one', { group: 'retired_group', version: 1, isActive: false });

    const file = await exportTaxonomyFile(NOON);

    expect(file.groups.map((group) => group.key)).toEqual(['life_areas', 'the_person']);
  });

  it('says in the file what the file cannot carry', async () => {
    seedDefinition('life_work', { version: 1 });

    const file = await exportTaxonomyFile(NOON);

    expect(file.taxonomy.notes.join(' ')).toMatch(/Active slots only/);
    expect(file.taxonomy.notes.join(' ')).toMatch(/Group titles and descriptions are not stored/);
    expect(file.taxonomy.notes.join(' ')).toMatch(/versions and their edit history are not/);
  });

  it('refuses to write an empty taxonomy rather than an invalid file', async () => {
    seedDefinition('life_work', { version: 1, isActive: false });

    await expect(exportTaxonomyFile(NOON)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'nothing_to_export' },
    });
  });

  it('refuses, naming the rows, when a stored classifier is not in the vocabulary', async () => {
    // Reachable by a hand edit, because the classifier columns are free-form
    // strings. The provider withholds such a row from the sync; an export must
    // NOT do the same silently — a file quietly missing a slot is how a round
    // trip deletes one.
    seedDefinition('life_work', { version: 1, sensitivity: 'extremely' });

    await expect(exportTaxonomyFile(NOON)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'unexportable' },
    });
  });

  it('names the file for the day it was taken', () => {
    expect(taxonomyExportFilename(NOON)).toBe('lelanea-slot-taxonomy-2026-09-20.json');
  });
});
