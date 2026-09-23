/**
 * Unit Tests: lib/app/content/index.ts — the authored-content barrel
 *
 * **This module reads no file at all, as of t-89.** It carries the shapes every
 * surface renders and `findPlaceholders`, and nothing else: the reads live on
 * the `*-store.ts` modules, and the two accessors that still parse a file —
 * the voice fingerprint's always-on core and the golden set — moved to
 * `seed-input/voice-fingerprint` and `seed-input/voice-golden-set`, each with
 * its own test file beside it.
 *
 * That move is the point of this file. Until t-89 the barrel imported those two
 * files, so all 347 import paths that reached it for a type or for
 * `findPlaceholders` carried them — including `authored-document.tsx`, a client
 * component. The first case pins the property directly rather than naming the
 * files one at a time, so a seventh file added here fails it too.
 *
 * The module must also stay free of the DATABASE, because the voice
 * fingerprint's import closure is walked for it
 * (`tests/unit/lib/app/voice/fingerprint.test.ts`). The projection cases that
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
 * serving a collection from files rather than a database still wants the
 * import-graph property — it just has a different set of permitted readers, so
 * it should widen `tests/unit/lib/app/content/runtime-import-graph.test.ts`'s
 * allowlist rather than drop either check.
 *
 * @see lib/app/content/index.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import * as content from '@/lib/app/content';

const source = readFileSync(path.join(process.cwd(), 'lib/app/content/index.ts'), 'utf8');

describe('the authored-content barrel', () => {
  it('imports no authored file at all — not one, not by any spelling', () => {
    // Pinned as a property rather than as a list of six filenames: t-89 was
    // caused by TWO files this module imported while a case naming the other
    // four passed. `@/content/` and `@/seed-data/drafted/` are the two folders
    // the lint boundary guards, and this asserts neither is named here.
    expect(source).not.toMatch(/@\/content\//);
    expect(source).not.toMatch(/@\/seed-data\//);
    // The whole of `seed-input/` is off-limits too, type imports included: a
    // type import is erased, but a module here importing one is a standing
    // invitation to reach for the value beside it.
    expect(source).not.toMatch(/@\/lib\/app\/content\/seed-input\//);
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

  it('exposes no file-backed accessor either — the voice core and golden set left in t-89', () => {
    // Both were memoised accessors on this module until t-89. They are now on
    // `@/lib/app/content/seed-input/voice-fingerprint` and `.../voice-golden-set`,
    // where the seeds and the smoke scripts reach them and a page cannot; the
    // test file beside each covers its behaviour.
    expect(content).not.toHaveProperty('getVoiceFingerprint');
    expect(content).not.toHaveProperty('getVoiceGoldenSet');
  });

  it('still serves the shapes and the placeholder helper the surfaces need', () => {
    // The counterfactual to the three cases above: a barrel emptied by mistake
    // would pass all of them. `findPlaceholders` is the one VALUE export left,
    // and it is what `authored-document.tsx` reaches for — the import that
    // carried both voice files into the client bundle before t-89.
    expect(typeof content.findPlaceholders).toBe('function');
    expect(content.PLACEHOLDER_PATTERN).toBeInstanceOf(RegExp);
    expect(typeof content.ContentNotSeededError).toBe('function');
  });
});
