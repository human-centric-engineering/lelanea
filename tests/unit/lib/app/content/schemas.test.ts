/**
 * Unit Tests: authored-content schemas
 *
 * The load-bearing test of this feature. It parses all six real files under
 * `content/` through the accessors that ship, so an edit to authored copy that
 * changes its shape — a renamed key, a document dropped from `suggestedOrder`,
 * a question deleted without updating `questionCount` — fails here rather than
 * at a blank page months later.
 *
 * It deliberately reads the real files rather than fixtures. A fixture would
 * test the schema against itself; the whole value is the coupling to what
 * Lelañea actually authored.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * The counts and ids below are Lelañea's authored content, not a platform
 * contract. A fork of this app that replaces `content/` with its own material
 * should expect every case here to fail, and should REWRITE them against its own
 * files rather than delete them — the coupling to real content is the entire
 * value of this test. The drift-detection cases in the middle section are
 * content-independent and can be kept as they are.
 *
 * Release-2 files (Values module, framework, explorations) are parsed in
 * `values.test.ts`, which mirrors the module that loads them.
 *
 * @see lib/app/content/schemas.ts
 */

import { describe, it, expect } from 'vitest';
import {
  listFoundationalDocuments,
  getFoundationalDocument,
  getJourneyStructure,
  getDiscoveryQuestions,
} from '@/lib/app/content';
import {
  foundationalDocumentsFileSchema,
  journeyStructureFileSchema,
  discoveryQuestionsFileSchema,
  type ModuleTier,
} from '@/lib/app/content/schemas';

describe('authored content schemas', () => {
  // ---------------------------------------------------------------------------
  // 1. Every real file validates
  // ---------------------------------------------------------------------------

  describe('the six real files', () => {
    it('parses the foundational documents, all seven of them', () => {
      const index = listFoundationalDocuments();

      expect(index.documents).toHaveLength(7);
      expect(index.collection.locale).toBe('en-US');
      expect(index.documents.map((document) => document.id)).toEqual([
        'the_initiation',
        'the_heart_behind_lelanea',
        'the_mission',
        'about_the_creator',
        'the_lineage_of_lelanea',
        'disclaimer',
        'terms_of_use',
      ]);
    });

    it('parses the journey structure — five tiers over seventeen modules', () => {
      const structure = getJourneyStructure();

      expect(structure.tiers).toHaveLength(5);
      expect(structure.modules).toHaveLength(17);
    });

    it('parses the thirty discovery questions', () => {
      const questions = getDiscoveryQuestions();

      expect(questions.questions).toHaveLength(30);
      expect(questions.collection.module).toBe('module_00_onboarding');
      expect(questions.collection.phase).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Drift fails loudly — the reason the schemas are strict
  // ---------------------------------------------------------------------------

  describe('drift detection', () => {
    /** A minimal file that satisfies every structural rule, to mutate below. */
    function validDocumentsFile() {
      return {
        collection: {
          id: 'c',
          title: 'T',
          version: '1.0',
          app: { name: 'n', trademarkedName: 't', url: 'u', nameNote: 'note' },
          creator: { name: 'Lelañea Fulton', titles: ['author'] },
          textFormat: 'plain',
          formatNotes: [],
          suggestedOrder: ['doc_a'],
          sourceFiles: [],
          locale: 'en-US',
        },
        documents: [
          {
            id: 'doc_a',
            title: 'A',
            subtitle: null,
            category: 'about',
            surface: 'about_mission',
            sourceFile: 'a.docx',
            blocks: [{ type: 'paragraph', text: 'Hello.' }],
          },
        ],
        reviewNotes: [],
      };
    }

    it('accepts the minimal valid shape (guards the negative cases below)', () => {
      // Without this, a fixture broken for an unrelated reason still satisfies
      // the `toThrow(/message/)` cases below — ZodError stringifies every issue,
      // so an incidental second fault reads as a pass.
      expect(() => foundationalDocumentsFileSchema.parse(validDocumentsFile())).not.toThrow();
      expect(() => journeyStructureFileSchema.parse(journeyFileForMutation())).not.toThrow();
      expect(() => discoveryQuestionsFileSchema.parse(discoveryFileForMutation())).not.toThrow();
    });

    it('rejects an unknown key rather than silently dropping it', () => {
      const file = validDocumentsFile();
      Object.assign(file.documents[0], { tone: 'warm' });

      expect(() => foundationalDocumentsFileSchema.parse(file)).toThrow(/tone/);
    });

    it('rejects a block type no renderer knows how to draw', () => {
      const file = validDocumentsFile();
      file.documents[0].blocks = [{ type: 'blockquote', text: 'Hello.' }] as never;

      expect(() => foundationalDocumentsFileSchema.parse(file)).toThrow();
    });

    it('rejects a document missing from suggestedOrder, which would hide it', () => {
      const file = validDocumentsFile();
      file.collection.suggestedOrder = [];

      expect(() => foundationalDocumentsFileSchema.parse(file)).toThrow(
        /missing from suggestedOrder/
      );
    });

    it('rejects a suggestedOrder entry that names no document', () => {
      const file = validDocumentsFile();
      file.collection.suggestedOrder = ['doc_a', 'doc_ghost'];

      expect(() => foundationalDocumentsFileSchema.parse(file)).toThrow(/doc_ghost/);
    });

    it('rejects two documents sharing an id, which would shadow one of them', () => {
      const file = validDocumentsFile();
      file.documents.push({ ...file.documents[0], title: 'A, again' });

      expect(() => foundationalDocumentsFileSchema.parse(file)).toThrow(/Duplicate document id/);
    });

    it('rejects a tier naming a module that does not exist', () => {
      const structure = journeyFileForMutation();
      structure.tiers[0].modules.push('module_99_phantom');

      expect(() => journeyStructureFileSchema.parse(structure)).toThrow(/module_99_phantom/);
    });

    it('rejects a module that no tier lists, which the journey would not show', () => {
      const structure = journeyFileForMutation();
      // Popped from a two-module tier, so the tier itself stays valid (a tier
      // needs at least one module) and the orphaned module is the only fault.
      const orphaned = structure.tiers[0].modules.pop()!;

      expect(() => journeyStructureFileSchema.parse(structure)).toThrow(
        new RegExp(`${orphaned}.*belongs to no tier`)
      );
    });

    it('rejects questions numbered out of step with their position', () => {
      const file = discoveryFileForMutation();
      [file.questions[0].number, file.questions[1].number] = [
        file.questions[1].number,
        file.questions[0].number,
      ];

      expect(() => discoveryQuestionsFileSchema.parse(file)).toThrow(/sits at position 1/);
    });

    it('rejects a suggestedOrder that repeats an id, which would list it twice', () => {
      const file = validDocumentsFile();
      file.collection.suggestedOrder = ['doc_a', 'doc_a'];

      expect(() => foundationalDocumentsFileSchema.parse(file)).toThrow(/repeats a document id/);
    });

    it('rejects one tier listing the same module twice', () => {
      const structure = journeyFileForMutation();
      structure.tiers[0].modules = ['module_a', 'module_a', 'module_b'];

      expect(() => journeyStructureFileSchema.parse(structure)).toThrow(/listed more than once/);
    });

    it('rejects a module that repeats a phase number', () => {
      const structure = journeyFileForMutation();
      structure.modules[0].phases = [
        { number: 1, displayNumber: '01', title: 'One', description: 'First.' },
        { number: 1, displayNumber: '02', title: 'Two', description: 'Second.' },
      ];

      expect(() => journeyStructureFileSchema.parse(structure)).toThrow(/repeats a phase number/);
    });

    it('rejects a phase tier naming a phase the module does not have', () => {
      const structure = journeyFileForMutation();
      structure.modules[0].phases = [
        { number: 1, displayNumber: '01', title: 'One', description: 'First.' },
      ];
      structure.modules[0].phaseTiers = [
        { id: 'orientation' as const, label: 'Orientation', order: 1, phases: [1, 9] },
      ];

      expect(() => journeyStructureFileSchema.parse(structure)).toThrow(/names phase 9/);
    });

    it('rejects a module listed under a tier it does not declare', () => {
      const structure = journeyFileForMutation();
      structure.modules[0].tier = 'integration_and_expansion';

      expect(() => journeyStructureFileSchema.parse(structure)).toThrow(/declares tier/);
    });

    it('rejects a questionCount that no longer matches the questions', () => {
      const file = discoveryFileForMutation();
      file.content.questionCount = 29;

      expect(() => discoveryQuestionsFileSchema.parse(file)).toThrow(/questionCount says 29/);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Authored detail the renderer depends on
  // ---------------------------------------------------------------------------

  describe('authored render metadata', () => {
    it('keeps the cadence note on the welcome statement', () => {
      const initiation = getFoundationalDocument('the_initiation');

      expect(initiation?.renderStyle).toBe('cadence');
      expect(initiation?.renderNote).toMatch(/do not merge them into flowing prose/i);
    });

    it('marks exactly the two legal documents as requiring acknowledgement', () => {
      const requiring = listFoundationalDocuments()
        .documents.filter((document) => document.requiresAcknowledgement)
        .map((document) => document.id);

      expect(requiring).toEqual(['disclaimer', 'terms_of_use']);
    });

    it('numbers the clauses of the Terms of Use', () => {
      const terms = getFoundationalDocument('terms_of_use');
      const numbered = terms?.blocks.filter(
        (block) => block.type === 'heading' && block.number !== undefined
      );

      expect(numbered?.length).toBeGreaterThan(0);
    });
  });
});

/**
 * A minimal journey file that satisfies every structural rule, for the
 * referential cases below to break in one specific way each.
 *
 * Hand-built rather than read back through the loader: the loader returns the
 * *served* projection, which deliberately drops fields the file schema requires,
 * and coupling these cases to the API's public shape would mean a projection
 * change breaking tests about validation. The real files are parsed for real in
 * the first block of this suite; that is where authored reality is asserted.
 */
function journeyFileForMutation() {
  return {
    app: {
      name: 'Lelañea',
      url: 'https://lelanea.app',
      journeyTitle: 'The Journey',
      journeySubtitle: 'A subtitle',
      version: '1.0',
      sources: [],
      structureNotes: [],
      locale: 'en-US',
    },
    tiers: [
      {
        id: 'onboarding' as const,
        label: 'Onboarding',
        order: 0,
        modules: ['module_a', 'module_b'],
        intent: 'Arrive.',
      },
    ],
    modules: [
      {
        id: 'module_a',
        number: 0,
        displayNumber: '00',
        title: 'A',
        tier: 'onboarding' as ModuleTier,
        phases: [] as {
          number: number;
          displayNumber: string;
          title: string;
          description: string;
        }[],
        phaseTiers: [] as {
          id: 'orientation' | 'discernment' | 'integration';
          label: string;
          order: number;
          phases: number[];
        }[],
      },
      {
        id: 'module_b',
        number: 1,
        displayNumber: '01',
        title: 'B',
        tier: 'onboarding' as ModuleTier,
      },
    ],
    reviewNotes: [],
  };
}

/** The same, for the discovery-questions file. */
function discoveryFileForMutation() {
  return {
    content: {
      id: 'onboarding_discovery_questions',
      title: 'Discovery Questions',
      chartTitle: 'Discovery',
      module: 'module_00_onboarding',
      phase: 8,
      sourceFile: 'x.docx',
      version: '1.0',
      textFormat: 'plain',
      questionCount: 2,
      notes: [],
      locale: 'en-US',
    },
    preamble: { style: 'plain', text: 'Take your time.' },
    pacing: { rushDiscouraged: true, allowPartialCompletion: true, note: 'No rush.' },
    questions: [
      { id: 'q1', number: 1, text: 'First?', inputType: 'long_text' as const },
      { id: 'q2', number: 2, text: 'Second?', inputType: 'long_text' as const },
    ],
    reviewNotes: [],
  };
}
