/**
 * The journey's text as the seed builds it, and as it is served once stored
 * (f-content-seeds t-87).
 *
 * These are the projection cases the file loader had before t-87, applied to
 * what replaced it: the rows `buildJourneySeed()` writes, read back through the
 * real `toJourneyStructure()`. What they guard is unchanged — the maintainers'
 * working notes never reach a row, let alone the unauthenticated journey API —
 * and the seam they guard it at moved to the seed.
 *
 * Also: the builder refuses a file that disagrees with the code roster, and the
 * data migration embeds exactly what the builder writes.
 *
 * @see lib/app/content/seed-input/journey-seed.ts
 * @see lib/app/content/journey-view.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertRosterMatchesFile,
  buildJourneySeed,
  readJourneyStructureFile,
} from '@/lib/app/content/seed-input/journey-seed';
import { toJourneyStructure, type JourneyStructure } from '@/lib/app/content/journey-view';
import { seededJourneyRows } from '@/tests/helpers/app/content-stores';

function served(): JourneyStructure {
  const rows = seededJourneyRows();
  return toJourneyStructure(rows.journey, rows.tiers, rows.modules);
}

describe('the journey, as seeded and served', () => {
  it('carries the journey title and subtitle as authored', () => {
    const { collection } = served();
    const file = readJourneyStructureFile();

    expect(collection).toMatchObject({
      id: file.app.name,
      title: file.app.journeyTitle,
      subtitle: file.app.journeySubtitle,
      version: file.app.version,
    });
  });

  it('lists every module under exactly one tier', () => {
    const structure = served();
    const listed = structure.tiers.flatMap((tier) => tier.modules);

    expect(listed).toHaveLength(structure.modules.length);
    expect(new Set(listed).size).toBe(structure.modules.length);
  });

  it('withholds the editorial review notes', () => {
    expect(served()).not.toHaveProperty('reviewNotes');
  });

  it('withholds the maintainers’ working notes from every module and phase', () => {
    // These reach an UNAUTHENTICATED endpoint. An earlier draft returned
    // `file.modules` wholesale and published "No authored screen yet. Needs a
    // short module opener.", the names of the content files on disk, and the
    // rest of the build's internal annotations. Since t-87 the projection runs
    // at the seed, so a note never reaches a row either.
    const rows = seededJourneyRows();
    for (const entry of [...served().modules, ...rows.modules]) {
      expect(entry).not.toHaveProperty('notes');
      expect(entry).not.toHaveProperty('appBehavior');
      expect(entry).not.toHaveProperty('contentRef');
    }
    for (const phase of served().modules.flatMap((entry) => entry.phases)) {
      expect(phase).not.toHaveProperty('contentNote');
      expect(phase).not.toHaveProperty('contentFile');
      expect(phase).not.toHaveProperty('contentSteps');
      expect(phase).not.toHaveProperty('contentQuestions');
    }
  });

  it('serves tiers field by field: the row’s words, the roster’s structure, a revision', () => {
    for (const tier of served().tiers) {
      expect(Object.keys(tier).sort()).toEqual([
        'id',
        'intent',
        'label',
        'modules',
        'order',
        'revision',
      ]);
    }
  });

  it('keeps the two phase fields a public client genuinely needs', () => {
    const phases = served().modules.flatMap((entry) => entry.phases);

    // `contentRef` is a link: a client turns it into a /documents/:id request.
    expect(phases.some((phase) => phase.contentRef === 'the_initiation')).toBe(true);
    // `proposed` keeps the public view honest about what is not built yet.
    expect(phases.some((phase) => phase.proposed)).toBe(true);
  });

  it('normalises every optional, so no field is undefined', () => {
    for (const entry of served().modules) {
      expect(entry.subtitle).not.toBeUndefined();
      expect(entry.chartTitle).not.toBeUndefined();
      expect(entry.produces).not.toBeUndefined();
      expect(entry.phaseTiers).not.toBeUndefined();
      for (const phase of entry.phases) {
        expect(phase.contentRef).not.toBeUndefined();
        expect(phase.proposed).not.toBeUndefined();
        expect(phase.questionCount).not.toBeUndefined();
      }
    }
  });

  it('serves exactly what the file served before t-87, word for word', () => {
    const file = readJourneyStructureFile();
    const structure = served();

    for (const authored of file.modules) {
      const stored = structure.modules.find((entry) => entry.id === authored.id);
      expect(stored).toMatchObject({
        number: authored.number,
        displayNumber: authored.displayNumber,
        title: authored.title,
        tier: authored.tier,
        subtitle: authored.subtitle ?? null,
      });
      expect(stored?.phases.map((phase) => phase.title)).toEqual(
        (authored.phases ?? []).map((phase) => phase.title)
      );
    }
    for (const authored of file.tiers) {
      expect(structure.tiers.find((tier) => tier.id === authored.id)).toMatchObject({
        label: authored.label,
        intent: authored.intent,
        order: authored.order,
        modules: authored.modules,
      });
    }
  });
});

describe('the roster and the file', () => {
  it('agree today', () => {
    expect(() => assertRosterMatchesFile(readJourneyStructureFile())).not.toThrow();
  });

  it('a module moved between tiers in the file fails the seed rather than splitting the two', () => {
    const file = readJourneyStructureFile();
    const moved = {
      ...file,
      modules: file.modules.map((entry) =>
        entry.id === 'module_05_kindness_vs_nice'
          ? { ...entry, tier: 'foundations' as const }
          : entry
      ),
    };

    expect(() => buildJourneySeed(moved)).toThrow(/roster .* disagree: modules differ/);
  });

  it('a module the roster does not know fails the seed', () => {
    const file = readJourneyStructureFile();
    const extra = {
      ...file,
      modules: [
        ...file.modules,
        { ...file.modules[16], id: 'module_17_beyond', number: 17, displayNumber: '17' },
      ],
    };

    expect(() => buildJourneySeed(extra)).toThrow(/modules differ/);
  });
});

describe('the stored JSON is validated on the way out', () => {
  it('throws on a module whose phases fail validation, rather than rendering them', () => {
    const rows = seededJourneyRows();
    const broken = rows.modules.map((row) =>
      row.id === 'module_01_values' ? { ...row, phases: [{ title: 'no number' }] } : row
    );

    expect(() => toJourneyStructure(rows.journey, rows.tiers, broken)).toThrow(
      /module "module_01_values" failed validation/
    );
  });

  it('throws on a phase tier that names a phase the module does not have', () => {
    const rows = seededJourneyRows();
    const values = rows.modules.find((row) => row.id === 'module_01_values')!;
    const phaseTiers = (values.phaseTiers as { phases: number[] }[]).map((tier, index) =>
      index === 0 ? { ...tier, phases: [99] } : tier
    );
    const broken = rows.modules.map((row) =>
      row.id === 'module_01_values' ? { ...row, phaseTiers } : row
    );

    expect(() => toJourneyStructure(rows.journey, rows.tiers, broken)).toThrow(/phase 99/);
  });

  it('throws on a roster module with no row: a place with no name is not rendered', () => {
    const rows = seededJourneyRows();

    expect(() =>
      toJourneyStructure(
        rows.journey,
        rows.tiers,
        rows.modules.filter((row) => row.id !== 'module_09_nervous_system')
      )
    ).toThrow(/"module_09_nervous_system" is in the roster but has no row/);
  });
});

describe('the data migration', () => {
  // Production migrates on every start and seeds only on request, so the rows
  // every environment gets come from the migration, not the seed. It embeds the
  // seed as JSON. This keeps the two from disagreeing: edit the file or the
  // builder, and this fails until the migration is regenerated (or, once
  // shipped, a follow-up migration moves the rows that need it).
  it('writes exactly what the seed builds today', () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        'prisma/migrations/20260928100100_app_journey_questions_resources_data/migration.sql'
      ),
      'utf8'
    );
    const match = /\$t87journey\$([\s\S]*?)\$t87journey\$/.exec(sql);

    expect(match, 'the migration no longer embeds the journey seed JSON').not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(buildJourneySeed());
  });

  it('records the same changed fields the service records', async () => {
    const { MODULE_SNAPSHOT_FIELDS, TIER_SNAPSHOT_FIELDS } =
      await import('@/lib/app/content/journey-store');
    const sql = readFileSync(
      path.join(
        process.cwd(),
        'prisma/migrations/20260928100100_app_journey_questions_resources_data/migration.sql'
      ),
      'utf8'
    );

    for (const fields of [TIER_SNAPSHOT_FIELDS, MODULE_SNAPSHOT_FIELDS]) {
      expect(sql).toContain(`ARRAY[${fields.map((f) => `'${f}'`).join(', ')}]`);
    }
  });
});
