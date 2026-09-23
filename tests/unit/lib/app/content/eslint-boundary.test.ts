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
 * **What this cannot see, and what covers it.** A lint rule is given one file at
 * a time, so nothing here can tell that a permitted module is reachable from a
 * page — which is exactly how the barrel came to hand two drafted files to 347
 * import paths while every case below passed. The graph half is
 * `tests/unit/lib/app/content/runtime-import-graph.test.ts`. Neither check
 * replaces the other: this one fails the moment someone writes the import,
 * against a fixture that never has to exist; that one fails on a path no single
 * file reveals.
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
 * A fork that serves authored content from files rather than a database wants a
 * WIDER `ignores`, not a missing rule: add the module that reads them and keep
 * every other path held to it.
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
// What a page is meant to do instead: read the collection from its store.
const VIA_STORE = `import { getJourneyStructure } from '@/lib/app/content/journey-store';\nexport const journey = getJourneyStructure();\n`;
const NAMED_REEXPORT = `export { default as documents } from '@/content/lelanea_foundational_documents.json';\n`;
const STAR_REEXPORT = `export * from '@/content/lelanea_module_structure.json';\n`;
const DRAFTED_IMPORT = `import overlays from '@/seed-data/drafted/lelanea_voice_overlays.json';\nexport const all = overlays;\n`;

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
    it('fails a static import of authored JSON from a page', async () => {
      const result = await lint(STATIC_IMPORT, 'app/(public)/about/page.ts');

      expect(result.errorCount).toBe(1);
      expect(result.messages[0].ruleId).toBe('no-restricted-syntax');
      expect(result.messages[0].message).toMatch(/SEED INPUT/);
      // The message has to name where reading it IS allowed, or the person who
      // hits this has a refusal and no next move (HB10).
      expect(result.messages[0].message).toMatch(/seed-input/);
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

    it('fails an import of the drafted seed data, which left content/ but not the boundary', async () => {
      const result = await lint(DRAFTED_IMPORT, 'lib/app/voice/overlays.ts');

      expect(result.errorCount).toBe(1);
      expect(result.messages[0].ruleId).toBe('no-restricted-syntax');
    });

    it('leaves other seed data alone', async () => {
      const result = await lint(
        `import chunks from '@/prisma/seeds/data/chunks/chunks.json';\nexport const all = chunks;\n`,
        'lib/orchestration/chunks.ts'
      );

      expect(result.errorCount).toBe(0);
    });

    it('fails the barrel too — the exemption it used to have is what t-89 removed', async () => {
      // `lib/app/content/**` was permitted wholesale until t-89, and this case
      // asserted the barrel could import a file. It could, and did: the voice
      // fingerprint and the golden set reached 347 import paths through it, one
      // of them a client component. The case is inverted rather than deleted,
      // because the inversion is the whole change.
      const result = await lint(STATIC_IMPORT, 'lib/app/content/index.ts');

      expect(result.errorCount).toBe(1);
      expect(result.messages[0].message).toMatch(/SEED INPUT/);
    });

    it('allows a seed-input module to import a file — that is what the folder is', async () => {
      const result = await lint(STATIC_IMPORT, 'lib/app/content/seed-input/foundational-seed.ts');

      expect(result.errorCount).toBe(0);
    });

    it('fails a seed unit importing a file directly — it reads through its builder', async () => {
      // Inverted rather than deleted, because t-89 briefly allowed this and the
      // allowance is the interesting part. A seed that imports the JSON itself
      // writes rows the Zod schema never saw, skipping the referential and
      // placeholder checks the `seed-input/` builders exist to run. Nothing
      // needed it — no seed imports a file directly — and nothing else would
      // have caught its use, because the graph walk does not root at `prisma/`.
      // Caught by /code-review.
      const result = await lint(DRAFTED_IMPORT, 'prisma/seeds/app-lelanea/019-voice-overlays.ts');

      expect(result.errorCount).toBe(1);
      expect(result.messages[0].message).toMatch(/SEED INPUT/);
    });

    it('allows a seed unit to reach a file through its seed-input builder', async () => {
      // The permitted shape, beside the banned one: the specifier names the
      // builder, not the JSON, so the rule does not match and the schema runs.
      const result = await lint(
        `import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';\nexport const seed = buildVoiceOverlaySeed;\n`,
        'prisma/seeds/app-lelanea/019-voice-overlays.ts'
      );

      expect(result.errorCount).toBe(0);
    });

    it('allows a test to import a file — a test ships in no build', async () => {
      const result = await lint(STATIC_IMPORT, 'tests/unit/lib/app/content/schemas.test.ts');

      expect(result.errorCount).toBe(0);
    });

    it('allows a page to reach a collection through its store', async () => {
      const result = await lint(VIA_STORE, 'app/(public)/journey/page.ts');

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
        'ImportDeclaration[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
        'ImportExpression[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
        'ExportNamedDeclaration[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
        'ExportAllDeclaration[source.value=/^@\\/(content|seed-data\\/drafted)\\//]',
      ]);
    });

    it('is active inside lib/app/content, outside the seed-input folder', async () => {
      // The barrel is an ordinary module now. Asserted against the RESOLVED
      // config rather than the block, because the narrowing that matters is the
      // one ESLint actually applies to that path.
      const config = await new ESLint().calculateConfigForFile('lib/app/content/index.ts');

      expect(config.rules['no-restricted-syntax']).toBeDefined();
    });

    it('is not active inside lib/app/content/seed-input', async () => {
      const config = await new ESLint().calculateConfigForFile(
        'lib/app/content/seed-input/foundational-seed.ts'
      );

      expect(config.rules['no-restricted-syntax']).toBeUndefined();
    });

    it('is not active for a test', async () => {
      const config = await new ESLint().calculateConfigForFile(
        'tests/unit/lib/app/content/schemas.test.ts'
      );

      expect(config.rules['no-restricted-syntax']).toBeUndefined();
    });

    it('IS active for a seed unit — the one exemption t-89 added and gave back', async () => {
      const config = await new ESLint().calculateConfigForFile(
        'prisma/seeds/app-lelanea/019-voice-overlays.ts'
      );

      expect(config.rules['no-restricted-syntax']).toBeDefined();
    });
  });
});

/**
 * The second block in the seam: a leaf test may import the framework it
 * exercises, and the `@/`-alias ban survives the replace-not-merge. Both halves
 * are asserted against the RESOLVED project config, because the failure mode
 * is a block that lints clean on its own and never reaches a real file.
 */
describe('leaf tests may import the framework', () => {
  function importPatterns(config: Linter.Config): string[] {
    const [, options] = config.rules?.['no-restricted-imports'] as [
      number,
      { patterns: { group: string[] }[] },
    ];
    return options.patterns.flatMap((pattern) => pattern.group);
  }

  it('lifts the framework ban for a test under tests/**/lib/app/**', async () => {
    const config = await new ESLint().calculateConfigForFile(
      'tests/unit/lib/app/modules/registration.test.ts'
    );
    const groups = importPatterns(config);

    expect(groups).not.toContain('@/lib/framework');
    expect(groups).not.toContain('@/lib/framework/*');
    // Restated, not lost: the alias ban is what replace-not-merge would drop.
    expect(groups).toEqual(expect.arrayContaining(['./*', '../*']));
  });

  it('leaves the framework ban in place for a test of the app shell', async () => {
    const config = await new ESLint().calculateConfigForFile(
      'tests/unit/components/app/shell/drawer.test.tsx'
    );

    expect(importPatterns(config)).toEqual(expect.arrayContaining(['@/lib/framework']));
  });
});
