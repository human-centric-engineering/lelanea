/**
 * Unit Tests: lib/app/content/index.ts — the authored-content loader
 *
 * Covers the file-backed accessors that remain until t-87 — the journey and
 * the discovery questions — and their parse-once memoisation. The foundational
 * documents are read from the database since t-86; see `document-store.test.ts`.
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
 * Named for the module it mirrors, not for what it covers. `loader.test.ts`
 * read better but sat outside the mirror convention `check:missing-tests`
 * enforces, so every `/pre-pr` run reported this module as untested — an
 * advisory that is wrong, recurring, and the kind that teaches people to skim
 * past the check.
 *
 * @see lib/app/content/index.ts
 */

import { describe, it, expect } from 'vitest';
import { getDiscoveryQuestions, getJourneyStructure } from '@/lib/app/content';

describe('authored content loader', () => {
  // Her foundational documents moved to the database in t-86. Their reads are
  // covered against a mocked client in `document-store.test.ts`; this file keeps
  // the collections that are still read from files until t-87.
  describe('memoisation', () => {
    it('returns the very same view on repeat calls (projected once, memoised)', () => {
      expect(getJourneyStructure()).toBe(getJourneyStructure());
      expect(getDiscoveryQuestions()).toBe(getDiscoveryQuestions());
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

    it('withholds the maintainers’ working notes from every module and phase', () => {
      // These reach an UNAUTHENTICATED endpoint. An earlier draft returned
      // `file.modules` wholesale and published "No authored screen yet. Needs a
      // short module opener.", the names of the content files on disk, and the
      // rest of the build's internal annotations. The projection is what stops
      // that, and this is what stops the projection quietly regressing.
      for (const entry of getJourneyStructure().modules) {
        expect(entry).not.toHaveProperty('notes');
        expect(entry).not.toHaveProperty('appBehavior');
        expect(entry).not.toHaveProperty('contentRef');
        for (const phase of entry.phases) {
          expect(phase).not.toHaveProperty('contentNote');
          expect(phase).not.toHaveProperty('contentFile');
          expect(phase).not.toHaveProperty('contentSteps');
          expect(phase).not.toHaveProperty('contentQuestions');
        }
      }
    });

    it('projects tiers too, not just modules and phases', () => {
      // The one level that was still passing through wholesale after the first
      // round of fixes. Safe at the time — but it was the single place where a
      // new authored annotation would have been published by default, which is
      // the failure mode the projection exists to remove.
      for (const tier of getJourneyStructure().tiers) {
        expect(Object.keys(tier).sort()).toEqual(['id', 'intent', 'label', 'modules', 'order']);
      }
    });

    it('keeps the two fields a public client genuinely needs', () => {
      const phases = getJourneyStructure().modules.flatMap((entry) => entry.phases);

      // `contentRef` is a link: a client turns it into a /documents/:id request.
      expect(phases.some((phase) => phase.contentRef === 'the_initiation')).toBe(true);
      // `proposed` keeps the public view honest about what is not built yet.
      expect(phases.some((phase) => phase.proposed)).toBe(true);
    });

    it('normalises every projected optional, so no field is undefined', () => {
      for (const entry of getJourneyStructure().modules) {
        expect(entry.subtitle).not.toBeUndefined();
        expect(entry.chartTitle).not.toBeUndefined();
        expect(entry.produces).not.toBeUndefined();
        for (const phase of entry.phases) {
          expect(phase.contentRef).not.toBeUndefined();
          expect(phase.proposed).not.toBeUndefined();
          expect(phase.questionCount).not.toBeUndefined();
        }
      }
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

    it('withholds the editorial review notes and the source-file provenance', () => {
      const set = getDiscoveryQuestions();

      expect(set).not.toHaveProperty('reviewNotes');
      expect(set.collection).not.toHaveProperty('sourceFile');
      expect(set.collection).not.toHaveProperty('notes');
    });

    it('projects each question, so a future authored annotation is withheld', () => {
      // The last accessor that returned its payload wholesale. Auth-gated, so
      // lower stakes than the journey leak — but the same publish-by-default
      // shape, and the doc claims every accessor projects.
      const allowed = ['id', 'number', 'text', 'inputType', 'hint', 'conditionalFollowUp'];

      for (const question of getDiscoveryQuestions().questions) {
        expect(Object.keys(question).every((key) => allowed.includes(key))).toBe(true);
      }
    });
  });
});
