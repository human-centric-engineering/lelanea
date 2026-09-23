/**
 * The content files and their rows are inverses on everything stored
 * (f-content-seeds t-91), pinned per collection from the REAL seed with no
 * database: rows → the file the export writes → the rows the seed and the
 * import would write, and the result equals where it started.
 *
 * Each file is also checked with the collection's own schema, the one the seed
 * and the import parse with, so the export can never write a file either of
 * them refuses.
 */

import { describe, expect, it } from 'vitest';

import {
  foundationalFileFromRows,
  foundationalSeedFromFile,
  journeyFileFromStructure,
  journeySeedFromFile,
  questionSeedFromFile,
  questionsFileFromSet,
  resourcesFileFromLibrary,
  resourcesSeedFromFile,
} from '@/lib/app/content/content-files';
import {
  discoveryQuestionsFileSchema,
  foundationalDocumentsFileSchema,
  journeyStructureFileSchema,
} from '@/lib/app/content/schemas';
import { buildResourcesFileSchema } from '@/lib/app/content/resources';
import { toDocumentDetail } from '@/lib/app/content/document-view';
import { toJourneyStructure } from '@/lib/app/content/journey-view';
import { toQuestionSet } from '@/lib/app/content/question-view';
import { toResourcesLibrary } from '@/lib/app/content/resource-view';
import {
  buildFoundationalSeed,
  readFoundationalDocumentsFile,
} from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import { JOURNEY_MODULES } from '@/lib/app/journey/roster';

const at = <T extends object>(rows: readonly T[]) => rows.map((row) => ({ ...row, revision: 1 }));

describe('foundational documents', () => {
  const seed = buildFoundationalSeed();
  const details = at(seed.documents).map((row) => toDocumentDetail(row));
  const file = foundationalFileFromRows(seed.collection, details);

  it('exports a file the seed’s schema accepts, with every block keyed', () => {
    expect(foundationalDocumentsFileSchema.safeParse(file).success).toBe(true);
    expect(file.documents).toHaveLength(7);
    expect(
      file.documents.every((document) =>
        document.blocks.every((block) => block.section !== undefined)
      )
    ).toBe(true);
  });

  it('projects back to exactly the rows it came from', () => {
    expect(foundationalSeedFromFile(file)).toEqual(seed);
  });

  it('keys her unkeyed file with the function it is given, and leaves it unkeyed without one', () => {
    const hers = readFoundationalDocumentsFile();
    const keyed = foundationalSeedFromFile(hers, () => [
      { type: 'paragraph', text: 'k', section: 'k' },
    ]);
    expect(keyed.documents[0].blocks).toEqual([{ type: 'paragraph', text: 'k', section: 'k' }]);
    const unkeyed = foundationalSeedFromFile(hers);
    expect(
      unkeyed.documents
        .flatMap((document) => document.blocks)
        .every((block) => block.section === null)
    ).toBe(true);
  });

  it('gives each document its own version where the file has one, the collection’s otherwise', () => {
    const edited = structuredClone(file);
    edited.documents[0].version = '9.9';
    delete edited.documents[1].version;
    const projected = foundationalSeedFromFile(edited);
    expect(projected.documents[0].version).toBe('9.9');
    expect(projected.documents[1].version).toBe(edited.collection.version);
  });
});

describe('journey', () => {
  const seed = buildJourneySeed();
  const structure = toJourneyStructure(seed.journey, at(seed.tiers), at(seed.modules));
  const file = journeyFileFromStructure(structure);

  it('exports a file the seed’s schema accepts', () => {
    expect(journeyStructureFileSchema.safeParse(file).success).toBe(true);
    expect(file.modules).toHaveLength(JOURNEY_MODULES.length);
  });

  it('projects back to exactly the rows it came from', () => {
    expect(journeySeedFromFile(file)).toEqual(seed);
  });

  it('refuses a file whose structure is not the roster’s', () => {
    const moved = structuredClone(file);
    moved.modules[1].number = 99;
    expect(() => journeySeedFromFile(moved)).toThrow(/roster/);
  });
});

describe('discovery questions', () => {
  const seed = buildQuestionSeed();
  const file = questionsFileFromSet(
    toQuestionSet({ ...seed.set, revision: 1 }, at(seed.questions))
  );

  it('exports a file the seed’s schema accepts', () => {
    expect(discoveryQuestionsFileSchema.safeParse(file).success).toBe(true);
    expect(file.questions).toHaveLength(30);
  });

  it('projects back to exactly the rows it came from', () => {
    expect(questionSeedFromFile(file)).toEqual(seed);
  });
});

describe('resources', () => {
  const seed = buildResourcesSeed();
  const library = toResourcesLibrary(seed.collection, at(seed.resources), at(seed.words));
  const file = resourcesFileFromLibrary(library);

  it('exports a file the seed’s schema accepts', () => {
    const schema = buildResourcesFileSchema({
      moduleIds: new Set(JOURNEY_MODULES.map((entry) => entry.id)),
      documentIds: new Set(buildFoundationalSeed().documents.map((document) => document.id)),
    });
    expect(schema.safeParse(file).success).toBe(true);
    expect(Object.keys(file.words)).toEqual(expect.arrayContaining(['default']));
  });

  it('projects back to exactly the rows it came from, films and readings included', () => {
    const withItems = toResourcesLibrary(
      seed.collection,
      [
        {
          id: 'a-film',
          kind: 'film',
          position: 0,
          title: 'F',
          subtitle: 'f',
          relatesTo: null,
          duration: '1:00',
          readingTime: null,
          href: 'https://example.com/f',
          documentId: null,
          revision: 1,
        },
        {
          id: 'a-reading',
          kind: 'reading',
          position: 0,
          title: 'R',
          subtitle: 'r',
          relatesTo: 'journey',
          duration: null,
          readingTime: '3 min',
          href: null,
          documentId: 'the_mission',
          revision: 1,
        },
        {
          id: 'b-reading',
          kind: 'reading',
          position: 1,
          title: 'L',
          subtitle: 'l',
          relatesTo: null,
          duration: null,
          readingTime: '4 min',
          href: 'https://example.com/l',
          documentId: null,
          revision: 1,
        },
      ],
      at(seed.words)
    );
    const back = resourcesSeedFromFile(resourcesFileFromLibrary(withItems));
    expect(
      back.resources.map((row) => [row.id, row.kind, row.position, row.documentId, row.href])
    ).toEqual([
      ['a-film', 'film', 0, null, 'https://example.com/f'],
      ['a-reading', 'reading', 0, 'the_mission', null],
      ['b-reading', 'reading', 1, null, 'https://example.com/l'],
    ]);
    expect(resourcesSeedFromFile(file)).toEqual(seed);
  });
});
