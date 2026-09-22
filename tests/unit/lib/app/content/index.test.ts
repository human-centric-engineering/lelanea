/**
 * Unit Tests: lib/app/content/index.ts — the authored-content loader
 *
 * Since t-87 this module loads only the voice material from files (the
 * fingerprint, the overlays and the golden set, covered by their own test
 * files). Her documents (t-86), the journey's text, the discovery questions and
 * the resource library (t-87) are read from the database through their stores,
 * and only their shapes are re-exported here.
 *
 * What is pinned here is that boundary: this module must not load the journey
 * or the questions from their files any more, and must stay free of the
 * database, because the voice fingerprint's import closure is walked for it
 * (`tests/unit/lib/app/voice/fingerprint.test.ts`). The projection cases that
 * used to live here moved with the projection, to `journey-seed.test.ts` and
 * `question-seed.test.ts`.
 *
 * Named for the module it mirrors, not for what it covers. `check:missing-tests`
 * enforces the mirror convention, and a module reported as untested on every
 * `/pre-pr` run teaches people to skim past the check.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * It has to: what is pinned is what this module imports and exports. A fork
 * that still loads a collection here from a file should drop that file's name
 * from the first case, not the case.
 *
 * @see lib/app/content/index.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import * as content from '@/lib/app/content';

const source = readFileSync(path.join(process.cwd(), 'lib/app/content/index.ts'), 'utf8');

describe('authored content loader', () => {
  it('no longer reads the journey, the questions or the resources from their files', () => {
    expect(source).not.toContain('lelanea_module_structure.json');
    expect(source).not.toContain('onboarding_discovery_questions.json');
    expect(source).not.toContain('lelanea_resources.json');
  });

  it('exposes no read of a database-backed collection, only the shapes', () => {
    // A read re-exported here would pull the database client into everything
    // that imports this module, including the voice fingerprint.
    expect(content).not.toHaveProperty('getJourneyStructure');
    expect(content).not.toHaveProperty('getDiscoveryQuestions');
    expect(content).not.toHaveProperty('getFoundationalDocument');
    expect(source).not.toMatch(
      /from '@\/lib\/app\/content\/(journey|question|resource|document)-store'/
    );
  });

  it('still serves the voice material, projected once and memoised', () => {
    expect(content.getVoiceFingerprint()).toBe(content.getVoiceFingerprint());
    expect(content.getVoiceOverlays()).toBe(content.getVoiceOverlays());
    expect(content.getVoiceGoldenSet()).toBe(content.getVoiceGoldenSet());
  });
});
