/**
 * The taxonomy store: what the global slot provider hands Daybreak (f-slots t-70).
 *
 * The provider is the seam's first production caller, so the cases here are
 * about what reaches `framework_slot_definition` — which is what reaches the
 * capture prompt, and from there a person.
 *
 * Two of them would be silent in production if wrong. A provider that returned
 * RETIRED rows would have the sync reactivate every slug an admin had retired,
 * on every boot, with the admin's editor still showing it retired. And a row
 * whose free-form classifier holds something the framework does not recognise
 * would be passed straight through, because the column is a `String` and
 * nothing downstream re-checks it.
 *
 * @see lib/app/slots/taxonomy-store.ts
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/client', () => ({ prisma: { appSlotDefinition: { findMany } } }));

const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logging', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  loadGlobalSlotDefinitions,
  changedDefinitionFields,
  SLOT_DEFINITION_FIELDS,
  type StoredSlotDefinition,
} from '@/lib/app/slots/taxonomy-store';

function row(overrides: Partial<StoredSlotDefinition> = {}): StoredSlotDefinition {
  return {
    slug: 'aspirations',
    group: 'the_person',
    description: 'What they are reaching for.',
    visibility: 'open',
    mode: 'targeted',
    dataType: 'text',
    sensitivity: 'standard',
    priorityWeight: 85,
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadGlobalSlotDefinitions', () => {
  it('hands the sync every authored field, and no field the sync does not take', async () => {
    findMany.mockResolvedValue([row()]);

    await expect(loadGlobalSlotDefinitions()).resolves.toEqual([
      {
        slug: 'aspirations',
        group: 'the_person',
        description: 'What they are reaching for.',
        visibility: 'open',
        mode: 'targeted',
        dataType: 'text',
        sensitivity: 'standard',
        priorityWeight: 85,
      },
    ]);

    // `scope` is stamped by the sync, not supplied — supplying it would be a
    // second copy of the one thing that decides which partition owns the row.
    const [definition] = await loadGlobalSlotDefinitions();
    expect(definition).not.toHaveProperty('scope');
    // `isActive` likewise: the sync derives it from presence or absence.
    expect(definition).not.toHaveProperty('isActive');
  });

  it('asks the database for active rows only', async () => {
    findMany.mockResolvedValue([]);
    await loadGlobalSlotDefinitions();

    // The retirement mechanism, seen from here: withholding a retired slug is
    // what makes the sync deactivate its projection. Filtering AFTER the query
    // would work too, so this pins the query because the query is also what
    // keeps a large retired set off the boot path.
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { isActive: true } });
  });

  it('returns nothing when the table is unseeded, rather than the bundled file', async () => {
    // Deliberate: the crisis resource falls back to its file because a crisis
    // turn must not depend on a database read; a slot definition is not that,
    // and a fallback would re-supply slugs an admin had RETIRED. An empty
    // result is read by the sync as a fluke, so it writes nothing either way.
    findMany.mockResolvedValue([]);
    await expect(loadGlobalSlotDefinitions()).resolves.toEqual([]);
  });

  it.each([
    ['visibility', 'semi_open'],
    ['mode', 'freeform'],
    ['dataType', 'blob'],
    ['sensitivity', 'very_secret'],
  ])(
    'withholds a row whose %s the framework does not recognise, and says so',
    async (field, bad) => {
      findMany.mockResolvedValue([row({ slug: 'good' }), row({ slug: 'bad', [field]: bad })]);

      const definitions = await loadGlobalSlotDefinitions();

      // One bad row does not take the taxonomy with it.
      expect(definitions.map((d) => d.slug)).toEqual(['good']);
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('unrecognised classifier'),
        expect.objectContaining({ slug: 'bad', field, value: bad })
      );
    }
  );

  it('shouts when EVERY row is withheld, because that case fails OPEN', async () => {
    // The opposite outcome to the one above, and the dangerous one. This case
    // exists BECAUSE of a behaviour that is not ours and is pinned elsewhere:
    // `tests/integration/lib/framework/data-slots/global-slots.test.ts`,
    // "an empty provider on a fluke boot leaves every global row active".
    // Nothing is deactivated, so the stale projections stay live and the slots
    // keep being asked under their old wording.
    //
    // Cited rather than restated — if Daybreak ever makes an empty provider
    // retire instead, that test fails and this log becomes wrong, and the
    // pointer is what connects the two.
    findMany.mockResolvedValue([
      row({ slug: 'bad_one', mode: 'freeform' }),
      row({ slug: 'bad_two', sensitivity: 'very_secret' }),
    ]);

    await expect(loadGlobalSlotDefinitions()).resolves.toEqual([]);

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('EVERY active definition was withheld'),
      { withheld: ['bad_one', 'bad_two'] }
    );
  });

  it('does not shout that when something survived — then deactivation is real', async () => {
    findMany.mockResolvedValue([row({ slug: 'good' }), row({ slug: 'bad', mode: 'freeform' })]);

    await loadGlobalSlotDefinitions();

    expect(loggerError).not.toHaveBeenCalledWith(
      expect.stringContaining('EVERY active definition was withheld'),
      expect.anything()
    );
  });

  it('does not shout on an unseeded table — nothing was withheld', async () => {
    // Empty because there is nothing there, not because everything failed
    // validation. Those must not log the same way.
    findMany.mockResolvedValue([]);

    await loadGlobalSlotDefinitions();

    expect(loggerError).not.toHaveBeenCalled();
  });

  it('does not swallow a read failure', async () => {
    // The sync logs a provider fault at boot and rethrows it on an on-demand
    // re-sync, which is what the caller who asked for the re-sync needs to see.
    // Catching here would turn both into "the taxonomy is empty".
    findMany.mockRejectedValue(new Error('connection refused'));
    await expect(loadGlobalSlotDefinitions()).rejects.toThrow('connection refused');
  });
});

describe('the sync contract this module is built on', () => {
  // The fix for a defect that hit this feature three times: every prose
  // description of what Daybreak's global pass does with what we hand it was
  // re-derived from `sync.ts`, and every one was wrong somewhere. The cure was
  // to CITE the test that states the contract instead of restating it — which
  // only works while the citation resolves.
  //
  // So this is the guard on the cure. A renamed case there silently dangles
  // three pointers here, in `011-slot-taxonomy.ts` and in
  // `.context/app/slots.md`, and a reader who follows a dead pointer goes back
  // to reading `sync.ts` — exactly the state that produced the original bug.
  //
  // Its inputs are FILES, which is why this file is in `leafAlwaysRunTests`
  // (`lib/app/leaf-ci.ts`): a branch renaming a case there reaches this through
  // no module graph.
  const CONTRACT = join(
    process.cwd(),
    'tests/integration/lib/framework/data-slots/global-slots.test.ts'
  );

  /** The cases our code and docs name. Keep in step with those citations. */
  const CITED = [
    // Omission is the retirement mechanism — `loadGlobalSlotDefinitions`
    // filtering on `isActive` depends on it.
    'a slug the provider drops is deactivated',
    // Omitting EVERYTHING retires nothing — the fail-open case the store logs
    // its own line for.
    'an empty provider on a fluke boot leaves every global row active',
    // The pass is idempotent — why the seed may call it unconditionally.
    're-syncing after an edit writes the edit, and re-syncing again writes nothing',
  ];

  it('still names every case our code and docs cite', () => {
    const source = readFileSync(CONTRACT, 'utf8');
    const missing = CITED.filter((name) => !source.includes(name));

    expect(
      missing,
      'These case names are cited by `lib/app/slots/taxonomy-store.ts`, ' +
        '`prisma/seeds/app-lelanea/011-slot-taxonomy.ts` and `.context/app/slots.md` ' +
        'as the statement of the global slot sync contract, and no longer exist in ' +
        `${relative(process.cwd(), CONTRACT)}. Update the citations to the new ` +
        'names — do not replace them with a prose description of what the sync does, ' +
        'which is the mistake they were introduced to fix.'
    ).toEqual([]);
  });
});

describe('SLOT_DEFINITION_FIELDS', () => {
  it('is exactly the authored columns of the model, derived from the schema', () => {
    // THE guard on this constant, and the one the "every field is diffed" case
    // below cannot be: that case proves the diff reads every field IN the
    // constant, which stays true when a column is added to the model and not to
    // the constant. This reads the schema instead.
    //
    // What breaks if they drift: the seed writes a v1 revision whose
    // `changedFields` omits the new column, and an edit to it writes no
    // revision at all — a version of the wording that no captured answer can be
    // read back against.
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema', 'app.prisma'), 'utf8');
    const model = /model AppSlotDefinition \{([\s\S]*?)\n\}/.exec(schema)?.[1];
    expect(model, 'AppSlotDefinition not found in app.prisma').toBeDefined();

    // Everything the model declares, minus the four this constant deliberately
    // excludes: `slug` is the identity and never changes, `version` is derived
    // from the history, and the two timestamps are the database's.
    const NOT_AUTHORED = new Set(['slug', 'version', 'createdAt', 'updatedAt', 'revisions']);
    const columns = [...(model ?? '').matchAll(/^\s{2}(\w+)\s+\S/gm)]
      .map((m) => m[1])
      .filter((name) => !NOT_AUTHORED.has(name));

    expect([...SLOT_DEFINITION_FIELDS].sort()).toEqual(columns.sort());
  });
});

describe('changedDefinitionFields', () => {
  it('is empty when nothing moved — which is what makes an edit write no revision', () => {
    expect(changedDefinitionFields(row(), row())).toEqual([]);
  });

  it('names exactly the fields that moved', () => {
    expect(
      changedDefinitionFields(row(), row({ description: 'Reworded.', priorityWeight: 40 }))
    ).toEqual(['description', 'priorityWeight']);
  });

  it('notices a retirement, because that is an edit like any other', () => {
    expect(changedDefinitionFields(row(), row({ isActive: false }))).toEqual(['isActive']);
  });

  it('covers every authored field, so a new column cannot be added unwatched', () => {
    // Derived from the same constant the snapshot and the seed use. If a column
    // is added to the model and not to `SLOT_DEFINITION_FIELDS`, an edit to it
    // would write no revision and the history would skip a version silently.
    const before = row();
    for (const field of SLOT_DEFINITION_FIELDS) {
      const value = before[field];
      const mutated =
        typeof value === 'string'
          ? `${value}-changed`
          : typeof value === 'number'
            ? value + 1
            : !value;
      expect(changedDefinitionFields(before, row({ [field]: mutated }))).toEqual([field]);
    }
  });
});
