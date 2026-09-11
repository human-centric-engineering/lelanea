/**
 * Framework ↔ Sunrise boundary check (f-bootstrap t-2, Appendix B / X6).
 *
 * Runs the three boundary mechanisms and fails (exit 1) if any is breached:
 *
 *   1. ESLint import boundary — lint the deliberate-violation fixture and assert
 *      the core → framework import rule still flags it. A green run proves the
 *      boundary genuinely bites (not that it was quietly deleted).
 *   2. Migration hygiene — no migration mixes `framework_*` and core DDL.
 *   3. Zero framework vocabulary — no framework-coined identifier in core code.
 *
 * Pure logic lives in `scripts/boundary/lib.ts` (unit-tested); this wrapper does
 * the filesystem + ESLint I/O. It needs no database, so CI runs it in the lint
 * job. Exits 0 when all three hold.
 *
 * Usage: `npm run framework:boundary` (namespaced under the framework tier, per
 * CUSTOMIZATION.md §7 — the leaf `app:*` and platform-unprefixed script names are
 * reserved for other tiers).
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { logger } from '@/lib/logging';
import {
  checkMigrationHygiene,
  scanForFrameworkVocab,
  isCoreSource,
  type MigrationFile,
  type SourceFile,
} from '@/scripts/boundary/lib';

const ROOT = process.cwd();
const FIXTURE = 'scripts/boundary/fixtures/core-imports-framework.ts';
// `npx` is `npx.cmd` on Windows; execFileSync (no shell) needs the exact name.
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// ── 1. ESLint import-boundary assertion ─────────────────────────────────────

interface EslintMessage {
  ruleId: string | null;
  message: string;
}
interface EslintResult {
  messages: EslintMessage[];
}

/**
 * Lint the fixture with `--no-ignore` (it is globally ignored so it never breaks
 * a normal lint) and assert the core → framework rule flags it. Returns true
 * when the boundary bit.
 */
function assertEslintBoundary(): boolean {
  let raw: string;
  try {
    // Exits 0 when clean — which for this fixture means the boundary is BROKEN.
    raw = execFileSync(NPX, ['eslint', '--no-ignore', '-f', 'json', FIXTURE], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    // Non-zero exit (lint errors present) is the healthy path; ESLint still
    // wrote its JSON report to stdout.
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout !== 'string' || stdout.length === 0) {
      logger.error('  FAIL  ESLint boundary: could not run eslint on the fixture', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    raw = stdout;
  }

  let results: EslintResult[];
  try {
    results = JSON.parse(raw) as EslintResult[];
  } catch {
    logger.error('  FAIL  ESLint boundary: unparseable eslint output');
    return false;
  }

  // Match either ruleId variant: the ban lives on base `no-restricted-imports`
  // today, but `lib/app/**` uses the `@typescript-eslint/` variant, so a future
  // unification of the framework ban onto that variant must not read as decay.
  const caught = results.some((r) =>
    r.messages.some(
      (m) =>
        (m.ruleId === 'no-restricted-imports' ||
          m.ruleId === '@typescript-eslint/no-restricted-imports') &&
        m.message.includes('@/lib/framework')
    )
  );

  if (caught) {
    logger.info('  OK    ESLint boundary: core → framework import is flagged');
    return true;
  }
  logger.error(
    '  FAIL  ESLint boundary: the deliberate core → framework import was NOT flagged — ' +
      'the framework-tier rule in eslint.config.mjs has decayed'
  );
  return false;
}

// ── filesystem walkers ──────────────────────────────────────────────────────

const IGNORED_DIRS = new Set(['node_modules', '.next', '.git']);

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out; // directory doesn't exist (e.g. reserved-but-empty surface)
  }
  for (const e of entries) {
    // Always forward-slash: `isCoreSource` and its callers match on `/`-joined
    // prefixes, but path.join yields `\` on Windows.
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      out.push(...walk(rel, exts));
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(rel);
    }
  }
  return out;
}

// ── 2. Migration hygiene ────────────────────────────────────────────────────

function readMigrations(): MigrationFile[] {
  const migrationsDir = 'prisma/migrations';
  const files: MigrationFile[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(path.join(ROOT, migrationsDir), { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sqlPath = path.join(ROOT, migrationsDir, e.name, 'migration.sql');
    try {
      // readFileSync throws (and is caught below) if there is no migration.sql
      // or it's a directory — no separate statSync guard needed.
      files.push({ name: e.name, sql: readFileSync(sqlPath, 'utf8') });
    } catch {
      // no migration.sql in this folder — skip
    }
  }
  return files;
}

function runMigrationHygiene(): boolean {
  const violations = checkMigrationHygiene(readMigrations());
  if (violations.length === 0) {
    logger.info('  OK    Migration hygiene: no framework_ / core DDL mixing');
    return true;
  }
  for (const v of violations) {
    logger.error(`  FAIL  Migration hygiene: ${v.migration} — ${v.reason}`, { tables: v.tables });
  }
  return false;
}

// ── 3. Zero framework vocabulary in core ────────────────────────────────────

function readCoreSources(): SourceFile[] {
  const roots = ['lib', 'app', 'components', 'prisma/schema'];
  const exts = ['.ts', '.tsx', '.prisma'];
  const files: SourceFile[] = [];
  for (const root of roots) {
    for (const rel of walk(root, exts)) {
      if (!isCoreSource(rel)) continue;
      files.push({ path: rel, content: readFileSync(path.join(ROOT, rel), 'utf8') });
    }
  }
  return files;
}

function runVocabScan(): boolean {
  const hits = scanForFrameworkVocab(readCoreSources());
  if (hits.length === 0) {
    logger.info('  OK    Framework vocabulary: none leaked into core code');
    return true;
  }
  for (const h of hits) {
    logger.error(`  FAIL  Framework vocabulary "${h.token}" in core file ${h.path}:${h.line}`);
  }
  return false;
}

// ── main ────────────────────────────────────────────────────────────────────

function main(): void {
  logger.info('Framework ↔ Sunrise boundary check (f-bootstrap t-2)...');
  const results = [assertEslintBoundary(), runMigrationHygiene(), runVocabScan()];
  const failed = results.filter((ok) => !ok).length;

  if (failed === 0) {
    logger.info('All 3 boundary checks passed.');
    process.exit(0);
  }
  logger.error(`${failed} of 3 boundary checks failed.`);
  process.exit(1);
}

main();
