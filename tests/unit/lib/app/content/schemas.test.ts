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
  getValuesModule,
  getValuesReferenceFramework,
  getValueExplorations,
} from '@/lib/app/content/values';
import {
  foundationalDocumentsFileSchema,
  journeyStructureFileSchema,
  discoveryQuestionsFileSchema,
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

    it('parses the release-2 files, which are validated but not served', () => {
      expect(getValuesModule().steps).toHaveLength(10);
      expect(getValuesModule().values).toHaveLength(265);
      expect(getValuesReferenceFramework().parts).toHaveLength(12);
      expect(getValueExplorations().values).toHaveLength(16);
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
      expect(() => foundationalDocumentsFileSchema.parse(validDocumentsFile())).not.toThrow();
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

    it('rejects a module listed under a tier it does not declare', () => {
      const structure = structuredClone(
        journeyStructureFileSchema.parse(rawJourneyStructureForMutation())
      );
      structure.modules[0].tier = 'integration_and_expansion';

      expect(() => journeyStructureFileSchema.parse(structure)).toThrow(/declares tier/);
    });

    it('rejects a questionCount that no longer matches the questions', () => {
      const questions = getDiscoveryQuestions();
      const file = {
        content: {
          id: questions.collection.id,
          title: questions.collection.title,
          chartTitle: questions.collection.chartTitle,
          module: questions.collection.module,
          phase: questions.collection.phase,
          sourceFile: 'x.docx',
          version: questions.collection.version,
          textFormat: 'plain',
          questionCount: 29,
          notes: [],
          locale: questions.collection.locale,
        },
        preamble: questions.preamble,
        pacing: questions.pacing,
        questions: questions.questions,
        reviewNotes: [],
      };

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
 * The journey structure as authored, re-serialised through the loader so the
 * mutation tests above start from real data without importing the JSON (which
 * the content-boundary ESLint rule forbids outside `lib/app/content`).
 */
function rawJourneyStructureForMutation(): unknown {
  const structure = getJourneyStructure();
  return {
    app: {
      name: structure.collection.id,
      url: 'https://lelanea.app',
      journeyTitle: structure.collection.title,
      journeySubtitle: structure.collection.subtitle,
      version: structure.collection.version,
      sources: [],
      structureNotes: [],
      locale: structure.collection.locale,
    },
    tiers: structure.tiers,
    modules: structure.modules,
    reviewNotes: [],
  };
}
