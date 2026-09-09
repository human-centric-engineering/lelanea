/**
 * Unit Tests: lib/app/content/values.ts — release-2 authored content
 *
 * The Values module, the exploration framework, and the sixteen written value
 * explorations. Validated on the same terms as the served content and drifting
 * just as loudly, but deliberately not reachable over HTTP until release 2.
 *
 * Its own file rather than a section of `schemas.test.ts` because it mirrors its
 * own module — and because the thing most worth asserting here is the boundary:
 * that this content is *not* served.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * The counts below are Lelañea's authored material. A fork replacing `content/`
 * should repoint them at its own files and keep the cases — what is being
 * asserted (the files parse, and release-2 content stays out of the served
 * module's import graph) holds for any content.
 *
 * @see lib/app/content/values.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getValuesModule,
  getValuesReferenceFramework,
  getValueExplorations,
} from '@/lib/app/content/values';

describe('release-2 authored content', () => {
  describe('the three files parse', () => {
    it('parses the ten-step Values module and its 265-value library', () => {
      const valuesModule = getValuesModule();

      expect(valuesModule.steps).toHaveLength(10);
      expect(valuesModule.values).toHaveLength(265);
      expect(valuesModule.module.stepOrder).toHaveLength(valuesModule.steps.length);
    });

    it('parses the reference framework', () => {
      const framework = getValuesReferenceFramework();

      expect(framework.parts).toHaveLength(12);
      expect(framework.lenses).toHaveLength(7);
      expect(framework.standardStructure).toHaveLength(22);
    });

    it('parses the sixteen value explorations', () => {
      const explorations = getValueExplorations();

      expect(explorations.values).toHaveLength(16);
      expect(explorations.collection.valueCount).toBe(explorations.values.length);
    });
  });

  describe('memoisation', () => {
    it('parses once and hands back the same object', () => {
      expect(getValuesModule()).toBe(getValuesModule());
      expect(getValuesReferenceFramework()).toBe(getValuesReferenceFramework());
      expect(getValueExplorations()).toBe(getValueExplorations());
    });

    it('freezes what it returns, like the served loader', () => {
      const valuesModule = getValuesModule();

      expect(Object.isFrozen(valuesModule)).toBe(true);
      expect(Object.isFrozen(valuesModule.values)).toBe(true);
      expect(() => {
        Object.assign(valuesModule.values[0], { label: 'rewritten' });
      }).toThrow(TypeError);
    });
  });

  describe('the release-2 boundary', () => {
    it('is not reachable from the served loader’s module graph', () => {
      // The 271KB of value explorations must not ride along in a bundle that
      // only wanted a mission statement. A static import in either direction
      // would undo that, and nothing else in the repo would notice.
      //
      // Comments are stripped first. The served loader's own docblock *names*
      // `@/lib/app/content/values` when explaining the split, and matching the
      // raw text failed on that — a mention is not an import, which is the
      // oldest false positive in this repo's tooling.
      const servedLoader = stripComments(readFileSync('lib/app/content/index.ts', 'utf8'));

      expect(servedLoader).not.toMatch(/@\/lib\/app\/content\/values/);
      expect(servedLoader).not.toMatch(/@\/content\/values_module/);
      expect(servedLoader).not.toMatch(/@\/content\/value_explorations/);
      expect(servedLoader).not.toMatch(/@\/content\/values_reference_framework/);
    });

    it('the comment-stripping the case above relies on actually works', () => {
      // Without this, a stripper that returned '' would make the assertion
      // above vacuous — it would pass against any file, including one that
      // does import the release-2 loader.
      expect(stripComments('/* @/lib/app/content/values */\nconst a = 1;')).toBe('\nconst a = 1;');
      expect(stripComments('// @/lib/app/content/values\nconst b = 2;')).toBe('\nconst b = 2;');
      expect(stripComments("import x from '@/lib/app/content/values';")).toMatch(
        /@\/lib\/app\/content\/values/
      );
    });

    it('is served by no route', () => {
      // If this ever needs to change, it is a release-2 decision made on
      // purpose — not something a route quietly picks up.
      const routes = [
        'app/api/v1/app/content/documents/route.ts',
        'app/api/v1/app/content/documents/[id]/route.ts',
        'app/api/v1/app/content/journey-structure/route.ts',
        'app/api/v1/app/content/discovery-questions/route.ts',
      ];

      for (const route of routes) {
        expect(readFileSync(route, 'utf8')).not.toMatch(/lib\/app\/content\/values/);
      }
    });
  });
});

/** Block and line comments removed, so a mention in prose is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
