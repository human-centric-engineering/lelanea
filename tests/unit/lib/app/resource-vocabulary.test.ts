/**
 * Resources are videos, audio and articles — and nothing else, anywhere.
 *
 * Owner ruling, 24 Sept 2026, after the older words had been corrected more
 * than once and kept coming back: the stored kinds were still named for them,
 * so every new surface that printed a kind, and every session reading the code,
 * picked them up again. The kinds are renamed now
 * (`20261001100000_app_resource_kinds`), and this file is what keeps them
 * gone: it reads the Lelañea-owned tree off disk and fails on the old words.
 *
 * ## What it bans, and where
 *
 * - **Everywhere we own** — code, copy, seed data, `content/`, our docs and our
 *   tests: the words for a moving picture, and "piece(s) of writing / reading".
 *   Neither has a legitimate use in this product.
 * - **In any file whose path names a resource**: "reading" as a kind — the
 *   plural, a quoted literal, or after an article or conjunction ("a reading",
 *   "and reading"). "Reading" as a verb and "reading time" are fine and stay.
 *   It is scoped because "readings" is the notes' own word for what the AI
 *   inferred (`notes-panel.tsx`), and the spend meter has a `'reading'` state;
 *   neither is a resource.
 *
 * ## What it leaves alone
 *
 * `prisma/migrations/` — applied migrations are frozen, and the kinds migration
 * has to name the old values to move them. `.context/app/planning/` — the
 * owner's source material and design files, kept as she wrote them.
 *
 * On the always-run list (`lib/app/leaf-ci.ts`): its inputs are files, so no
 * module graph selects it, and the branch that brings a word back is exactly
 * the branch a scoped run would not have chosen.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** The trees Lelañea owns. Framework and platform trees are not ours to police. */
const SCANNED = [
  'app/(lelanea)',
  'app/admin/app',
  'app/api/v1/app',
  'app/api/v1/admin/app',
  'lib/app',
  'components/app',
  'prisma/seeds/app-lelanea',
  'seed-data',
  'content',
  '.context/app',
  'tests/unit/lib/app',
  'tests/unit/components/app',
  'tests/unit/app',
  'tests/unit/prisma/seeds/app-lelanea',
  'tests/helpers/app',
];

const SKIPPED = ['.context/app/planning', 'tests/unit/lib/app/resource-vocabulary.test.ts'];

const EXTENSIONS = /\.(ts|tsx|js|mjs|json|md|css)$/;

/** Banned in every scanned file. */
const EVERYWHERE: readonly RegExp[] = [/\bfilms?\b/i, /\bpieces? of (writing|reading)\b/i];

/** Banned in a file whose path names a resource: "reading" used as the kind. */
const IN_RESOURCE_FILES: readonly RegExp[] = [
  /\breadings\b/i,
  /['"`]reading['"`]/,
  /\b(a|an|no|and|or|every|one|external)\s+reading\b(?!\s+(time|order|a\b|the\b|it\b))/i,
];

function filesUnder(dir: string): string[] {
  const absolute = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(absolute, name);
    const rel = relative(ROOT, path);
    if (SKIPPED.some((skip) => rel === skip || rel.startsWith(`${skip}/`))) return [];
    if (statSync(path).isDirectory()) return filesUnder(rel);
    return EXTENSIONS.test(name) ? [rel] : [];
  });
}

/** Every `file:line: text` in the scanned tree that one of the patterns matches. */
function offences(): string[] {
  const found: string[] = [];
  for (const file of SCANNED.flatMap(filesUnder)) {
    const patterns = /resource/i.test(file) ? [...EVERYWHERE, ...IN_RESOURCE_FILES] : EVERYWHERE;
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (patterns.some((pattern) => pattern.test(line))) {
          found.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

describe('the resource vocabulary', () => {
  it('scans a tree that exists, so a clean result means something', () => {
    // An empty scan would pass the case below for the wrong reason (`fp6`).
    const files = SCANNED.flatMap(filesUnder);
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('lib/app/content/resources.ts');
    expect(files).toContain('components/app/shell/resources-drawer.tsx');
  });

  it('never calls a resource anything but a video, audio or an article', () => {
    expect(offences()).toEqual([]);
  });

  it('catches the words it is here to catch', () => {
    // The patterns, against the phrasings that actually shipped before the
    // rename, so a loosened pattern fails here rather than silently passing.
    const everywhere = (text: string) => EVERYWHERE.some((p) => p.test(text));
    const inResource = (text: string) =>
      [...EVERYWHERE, ...IN_RESOURCE_FILES].some((p) => p.test(text));

    expect(everywhere('Resources — films and reading')).toBe(true);
    expect(everywhere('one of her pieces of writing')).toBe(true);
    expect(inResource("kind: z.enum(['video', 'reading'])")).toBe(true);
    expect(inResource('two videos and three readings')).toBe(true);
    expect(inResource('a reading is a document or a link')).toBe(true);

    expect(inResource('its reading time as its length')).toBe(false);
    expect(inResource('reading a suggestion back')).toBe(false);
    expect(inResource('the documents in reading order')).toBe(false);
  });
});
