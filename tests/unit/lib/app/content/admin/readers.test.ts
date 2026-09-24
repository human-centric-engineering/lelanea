/**
 * The readers registry stays honest (f-content-seeds t-91).
 *
 * `DOCUMENT_READERS` and `SECTION_READERS` are what stop the admin deleting a
 * document, or dropping a section key, that a surface selects by name. A
 * surface added in code without a line there would lose that guard silently,
 * so this scans the code for what it selects and fails on anything unlisted.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_READERS, SECTION_READERS } from '@/lib/app/content/admin/readers';
import {
  SECTION_KEYS,
  buildFoundationalSeed,
} from '@/lib/app/content/seed-input/foundational-seed';
import { DOCUMENT_FOR_KIND } from '@/lib/app/gateway/acknowledgements';

const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const relative = path.join(dir, name);
    if (statSync(path.join(ROOT, relative)).isDirectory()) return sources(relative);
    return /\.(ts|tsx)$/.test(name) ? [relative] : [];
  });
}

const CODE = [...sources('app'), ...sources('components')].map((file) =>
  readFileSync(path.join(ROOT, file), 'utf8')
);

describe('DOCUMENT_READERS', () => {
  it('lists every document code renders by id', () => {
    const rendered = new Set(
      CODE.flatMap((text) =>
        [...text.matchAll(/requireDocument\('([a-z_]+)'\)/g)].map((match) => match[1])
      )
    );
    for (const id of Object.values(DOCUMENT_FOR_KIND)) rendered.add(id);
    // The scan found the real population, not nothing.
    expect(rendered.size).toBeGreaterThanOrEqual(6);
    for (const id of rendered) expect(DOCUMENT_READERS[id], id).toBeDefined();
  });

  it('covers all seven seeded documents, so none of them can be deleted', () => {
    const seeded = buildFoundationalSeed().documents.map((document) => document.id);
    expect(seeded).toHaveLength(7);
    for (const id of seeded) expect(DOCUMENT_READERS[id]?.length, id).toBeGreaterThan(0);
  });
});

describe('SECTION_READERS', () => {
  it('names exactly the section keys the seed writes', () => {
    const seeded = Object.entries(SECTION_KEYS).flatMap(([document, ranges]) =>
      ranges.map((range) => `${document}:${range.key}`)
    );
    const guarded = SECTION_READERS.map((entry) => `${entry.document}:${entry.section}`);
    expect(new Set(guarded)).toEqual(new Set(seeded));
  });

  it('every key a surface passes to a section selector is guarded', () => {
    const literal = CODE.flatMap((text) =>
      [...text.matchAll(/selectSection(?:Text|Heading)?\([^,]+,\s*'([a-z_]+)'/g)].map(
        (match) => match[1]
      )
    );
    expect(literal.length).toBeGreaterThan(0);
    const guarded = new Set(SECTION_READERS.map((entry) => entry.section));
    for (const key of literal) expect(guarded.has(key), key).toBe(true);
  });
});
