/**
 * Only `lib/app/memory/memory-index.ts` reads or writes the memory index
 * (f-memory t-129).
 *
 * Two reasons, both load-bearing. The table is a leaf stand-in for
 * daybreak#287 (owner ruling 1, 3 Oct 2026): one module behind it is what makes
 * swapping it for Daybreak's a change to one file. And every read of it is per
 * person by construction, which holds only while every read goes through the
 * functions that make it so. A second reader, however careful, is a second
 * place where one person's words could reach another's prompt.
 *
 * Read from the tree rather than through a module graph, so it is always-run
 * (`lib/app/leaf-ci.ts`): the change it exists to catch is a NEW file that
 * reads the table, which nothing imports yet.
 *
 * What counts as touching the table: the Prisma delegate (`appMemoryEmbedding`,
 * by any receiver) and SQL naming the table after `FROM`, `JOIN`, `INTO`,
 * `UPDATE` or `DELETE FROM`. Naming the model or the table in a manifest
 * (`model: 'AppMemoryEmbedding'`, a drift probe's `table:`) is a declaration,
 * not a read, and is allowed anywhere.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const OWNER = 'lib/app/memory/memory-index.ts';
/** Everywhere code that runs against the database lives. Tests are excluded: they fake the client. */
const SCAN = ['lib', 'app', 'components', 'scripts', 'emails', 'hooks', 'prisma', 'proxy.ts'];
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

const DELEGATE = /\bappMemoryEmbedding\b/;
const SQL = /\b(?:FROM|JOIN|INTO|UPDATE)\s+"?app_memory_embedding\b/i;

function files(path: string): string[] {
  const full = join(ROOT, path);
  const stat = statSync(full, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return SOURCE.test(path) ? [path] : [];
  return readdirSync(full).flatMap((name) =>
    name === 'node_modules' || name === 'generated' ? [] : files(relative(ROOT, join(full, name)))
  );
}

function touches(source: string): boolean {
  return DELEGATE.test(source) || SQL.test(source);
}

describe('the memory index has one reader', () => {
  it('recognises both ways of touching the table, and not a manifest entry', () => {
    expect(touches('await prisma.appMemoryEmbedding.findMany()')).toBe(true);
    expect(touches('const { appMemoryEmbedding } = tx;')).toBe(true);
    expect(touches('SELECT * FROM app_memory_embedding e')).toBe(true);
    expect(touches('LEFT JOIN "app_memory_embedding" e ON')).toBe(true);
    expect(touches('delete from app_memory_embedding where')).toBe(true);
    expect(touches("{ model: 'AppMemoryEmbedding', section: 'memory' }")).toBe(false);
    expect(touches("table: 'app_memory_embedding',")).toBe(false);
    expect(touches('appMemoryEmbeddings AppMemoryEmbedding[]')).toBe(false);
  });

  it('finds the owner reading it, so the scan is not vacuous', () => {
    const scanned = SCAN.flatMap(files);
    expect(scanned).toContain(OWNER);
    expect(touches(readFileSync(join(ROOT, OWNER), 'utf8'))).toBe(true);
  });

  it('no other file reads or writes it', () => {
    const offenders = SCAN.flatMap(files)
      .filter((path) => path !== OWNER)
      .filter((path) => touches(readFileSync(join(ROOT, path), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
