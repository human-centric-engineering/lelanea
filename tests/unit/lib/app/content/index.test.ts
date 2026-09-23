/**
 * Unit Tests: lib/app/content/index.ts — the authored-content loader
 *
 * Since t-87 this module loads voice material from files: through t-87 that was
 * the fingerprint, the overlays and the golden set. t-88 moved the overlays to
 * the database as well (`app_voice_overlay_set` / `app_voice_overlay`, read
 * through `@/lib/app/content/voice-overlay-store`'s `getVoiceOverlays()`, async
 * and covered by its own test file); what this module still loads from a file
 * is the fingerprint's always-on core and the golden set. Her documents (t-86),
 * the journey's text, the discovery questions, the resource library (t-87) and
 * now the overlays (t-88) are read from the database through their stores, and
 * only their shapes are re-exported here.
 *
 * What is pinned here is that boundary: this module must not load the journey,
 * the questions or the overlays from their files any more, and must stay free
 * of the database, because the voice fingerprint's import closure is walked for
 * it (`tests/unit/lib/app/voice/fingerprint.test.ts`). The projection cases that
 * used to live here moved with the projection, to `journey-seed.test.ts`,
 * `question-seed.test.ts` and `voice-overlays.test.ts`.
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
  it('no longer reads the journey, the questions, the resources or the overlays from their files', () => {
    expect(source).not.toContain('lelanea_module_structure.json');
    expect(source).not.toContain('onboarding_discovery_questions.json');
    expect(source).not.toContain('lelanea_resources.json');
    // t-88: the overlays joined the boundary above.
    expect(source).not.toContain('lelanea_voice_overlays.json');
  });

  it('exposes no read of a database-backed collection, only the shapes', () => {
    // A read re-exported here would pull the database client into everything
    // that imports this module, including the voice fingerprint.
    expect(content).not.toHaveProperty('getJourneyStructure');
    expect(content).not.toHaveProperty('getDiscoveryQuestions');
    expect(content).not.toHaveProperty('getFoundationalDocument');
    // t-88: the overlays' read lives on the store, not here.
    expect(content).not.toHaveProperty('getVoiceOverlays');
    expect(source).not.toMatch(
      /from '@\/lib\/app\/content\/(journey|question|resource|document|voice-overlay)-store'/
    );
  });

  it('still serves the voice fingerprint and golden set, projected once and memoised', () => {
    // The overlays used to be part of this memoised trio (see the docblock
    // above); they moved to the async, per-request `getVoiceOverlays()` on
    // `@/lib/app/content/voice-overlay-store` in t-88, covered by
    // `voice-overlays.test.ts`, so there is nothing left to assert about them
    // here.
    expect(content.getVoiceFingerprint()).toBe(content.getVoiceFingerprint());
    expect(content.getVoiceGoldenSet()).toBe(content.getVoiceGoldenSet());
  });
});
