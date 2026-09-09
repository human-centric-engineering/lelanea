/**
 * Unit Tests: the `content/*.json` import boundary
 *
 * The seam only holds if the rule is (a) written correctly and (b) actually
 * wired into the config ESLint resolves for a project file. Both fail silently
 * on their own — a selector typo lints clean, and a block that never reaches the
 * root config lints clean too — so this test asserts both.
 *
 * The fixture is linted from a code string rather than a file on disk: a real
 * fixture that fails lint would have to be excluded from `npm run lint` to keep
 * the gate green, and an excluded fixture proves nothing.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/eslint.config.mjs` seam
 * ---------------------------------------------------------------------------
 * The wiring cases at the bottom assert that Lelañea's leaf ESLint seam still
 * carries this one block. A fork that adds blocks of its own to that seam will
 * still pass (the rule is looked up by name, not by position), but a fork that
 * removes the content boundary should delete this file rather than loosen it —
 * a boundary test that no longer tests a boundary is worse than none.
 *
 * @see lib/app/eslint.config.mjs — `contentJsonImportBoundary`, and why the rule
 *   is `no-restricted-syntax` rather than the obvious `no-restricted-imports`
 */

import { describe, it, expect } from 'vitest';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { contentJsonImportBoundary } from '@/lib/app/eslint.config.mjs';

// The seam is a `.mjs` flat-config file, so TypeScript widens its rule tuple to
// an array. The shape is asserted by the wiring tests below, not by the compiler.
const boundaryBlock = contentJsonImportBoundary as unknown as Linter.Config;

const STATIC_IMPORT = `import documents from '@/content/lelanea_foundational_documents.json';\nexport const first = documents;\n`;
const DYNAMIC_IMPORT = `export const load = () => import('@/content/values_module.json');\n`;
const VIA_LOADER = `import { getJourneyStructure } from '@/lib/app/content';\nexport const journey = getJourneyStructure();\n`;
const NAMED_REEXPORT = `export { default as documents } from '@/content/lelanea_foundational_documents.json';\n`;
const STAR_REEXPORT = `export * from '@/content/lelanea_module_structure.json';\n`;

/** ESLint carrying only the boundary block, plus a parser that reads TypeScript. */
function boundaryLinter(): ESLint {
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
      boundaryBlock,
    ],
  });
}

async function lint(code: string, filePath: string) {
  const [result] = await boundaryLinter().lintText(code, { filePath });
  return result;
}

describe('content/*.json import boundary', () => {
  describe('the rule itself', () => {
    it('fails a static import of authored JSON from outside lib/app/content', async () => {
      const result = await lint(STATIC_IMPORT, 'app/(public)/about/page.ts');

      expect(result.errorCount).toBe(1);
      expect(result.messages[0].ruleId).toBe('no-restricted-syntax');
      expect(result.messages[0].message).toMatch(/read through `@\/lib\/app\/content`/);
    });

    it('fails a dynamic import too, which a plain grep would miss', async () => {
      const result = await lint(DYNAMIC_IMPORT, 'lib/reporting/values.ts');

      expect(result.errorCount).toBe(1);
      expect(result.messages[0].ruleId).toBe('no-restricted-syntax');
    });

    it('fails a named re-export, which launders the JSON to every consumer', async () => {
      const result = await lint(NAMED_REEXPORT, 'lib/content-shim.ts');

      expect(result.errorCount).toBe(1);
      expect(result.messages[0].message).toMatch(/re-export/);
    });

    it('fails a star re-export too', async () => {
      const result = await lint(STAR_REEXPORT, 'lib/content-shim.ts');

      expect(result.errorCount).toBe(1);
    });

    it('allows the loader itself to import the files', async () => {
      const result = await lint(STATIC_IMPORT, 'lib/app/content/index.ts');

      expect(result.errorCount).toBe(0);
    });

    it('allows any other file to reach content through the loader', async () => {
      const result = await lint(VIA_LOADER, 'app/(public)/journey/page.ts');

      expect(result.errorCount).toBe(0);
    });

    it('leaves unrelated JSON imports alone', async () => {
      const result = await lint(
        `import pkg from '@/package.json';\nexport const version = pkg.version;\n`,
        'lib/version.ts'
      );

      expect(result.errorCount).toBe(0);
    });
  });

  describe('wiring into the project config', () => {
    it('is active for an ordinary project file', async () => {
      const config = await new ESLint().calculateConfigForFile('lib/api/responses.ts');
      const [severity, ...selectors] = config.rules['no-restricted-syntax'] as [
        number,
        ...{ selector: string }[],
      ];

      // `calculateConfigForFile` normalises severity to its numeric form.
      expect(severity).toBe(2);
      expect(selectors.map((entry) => entry.selector)).toEqual([
        'ImportDeclaration[source.value=/^@\\/content\\//]',
        'ImportExpression[source.value=/^@\\/content\\//]',
        'ExportNamedDeclaration[source.value=/^@\\/content\\//]',
        'ExportAllDeclaration[source.value=/^@\\/content\\//]',
      ]);
    });

    it('is not active inside lib/app/content', async () => {
      const config = await new ESLint().calculateConfigForFile('lib/app/content/index.ts');

      expect(config.rules['no-restricted-syntax']).toBeUndefined();
    });
  });
});
