/**
 * Unit Tests: the authored-content loader
 *
 * Covers the four accessors the API and the renderers use: reading order,
 * the normalisation that gives every client one predictable shape, the
 * `null`-not-throw contract on an unknown id, what is deliberately withheld,
 * and the parse-once memoisation.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * The document ids (`the_initiation`, `the_mission`) are Lelañea's own copy. A
 * fork that replaces `content/` should repoint these at its own document ids and
 * keep the cases: what is being asserted — reading order, normalisation, the
 * `null`-not-throw contract, memoisation — is the loader's behaviour, and holds
 * for any content. Do not mock the seam here; a mocked loader would assert
 * nothing but the mock.
 *
 * @see lib/app/content/index.ts
 */

import { describe, it, expect } from 'vitest';
import {
  getDiscoveryQuestions,
  getFoundationalDocument,
  getJourneyStructure,
  listFoundationalDocuments,
} from '@/lib/app/content';

describe('authored content loader', () => {
  describe('listFoundationalDocuments', () => {
    it('returns documents in the collection’s authored reading order', () => {
      const { documents } = listFoundationalDocuments();

      expect(documents[0].id).toBe('the_initiation');
      expect(documents.at(-1)?.id).toBe('terms_of_use');
    });

    it('normalises the optional members so clients never see undefined', () => {
      const mission = listFoundationalDocuments().documents.find(
        (document) => document.id === 'the_mission'
      );

      expect(mission).toMatchObject({
        requiresAcknowledgement: false,
        placeholders: [],
        renderStyle: null,
        renderNote: null,
      });
    });

    it('reports a block count instead of the prose', () => {
      const summary = listFoundationalDocuments().documents.find(
        (document) => document.id === 'the_initiation'
      );

      expect(summary?.blockCount).toBeGreaterThan(0);
      expect(summary).not.toHaveProperty('blocks');
    });

    it('withholds the editorial review notes and source-file provenance', () => {
      const index = listFoundationalDocuments();

      expect(index).not.toHaveProperty('reviewNotes');
      expect(index.documents[0]).not.toHaveProperty('sourceFile');
    });
  });

  describe('getFoundationalDocument', () => {
    it('returns the document with its blocks in authored order', () => {
      const mission = getFoundationalDocument('the_mission');

      expect(mission?.title).toBeTruthy();
      expect(mission?.blocks).toHaveLength(mission!.blockCount);
      expect(mission?.blocks[0]).toHaveProperty('type');
    });

    it('returns null for an unknown id, leaving the 404 to the caller', () => {
      expect(getFoundationalDocument('the_manifesto')).toBeNull();
    });

    it('returns null rather than matching on a prefix', () => {
      expect(getFoundationalDocument('the_mission_statement')).toBeNull();
    });

    it('returns the same parsed blocks on repeat calls (parsed once, memoised)', () => {
      const first = getFoundationalDocument('the_mission');
      const second = getFoundationalDocument('the_mission');

      expect(first?.blocks).toBe(second?.blocks);
    });
  });

  describe('getJourneyStructure', () => {
    it('carries the journey title and subtitle as authored', () => {
      const { collection } = getJourneyStructure();

      expect(collection.title).toBeTruthy();
      expect(collection.subtitle).toBeTruthy();
    });

    it('lists every module under exactly one tier', () => {
      const structure = getJourneyStructure();
      const listed = structure.tiers.flatMap((tier) => tier.modules);

      expect(listed).toHaveLength(structure.modules.length);
      expect(new Set(listed).size).toBe(structure.modules.length);
    });

    it('withholds the editorial review notes', () => {
      expect(getJourneyStructure()).not.toHaveProperty('reviewNotes');
    });
  });

  describe('getDiscoveryQuestions', () => {
    it('numbers the questions from one, in order', () => {
      const { questions } = getDiscoveryQuestions();

      expect(questions.map((question) => question.number)).toEqual(
        questions.map((_, index) => index + 1)
      );
    });

    it('keeps the preamble and the pacing guidance with the questions', () => {
      const { preamble, pacing } = getDiscoveryQuestions();

      expect(preamble.text).toBeTruthy();
      expect(pacing.rushDiscouraged).toBe(true);
    });

    it('withholds the editorial review notes', () => {
      expect(getDiscoveryQuestions()).not.toHaveProperty('reviewNotes');
    });
  });
});
