/**
 * The migration that puts `suggest_resource` into a database that already
 * exists (f-resources t-93).
 *
 * ## Why this file reads SQL
 *
 * The tool is now described in three places: the class
 * (`SUGGEST_RESOURCE_DEFINITION`), the seed's literal
 * (`SUGGEST_RESOURCE_IMPL`, pinned to the class by
 * `tests/unit/prisma/seeds/app-lelanea/suggest-resource.test.ts`), and the
 * `INSERT` below, which is the only one dev, preview and production actually
 * ran. A migration is frozen once applied, so nothing refactors it along with
 * the code — and a definition that has drifted is a schema advertised to every
 * model and MCP client that no longer matches the handler. This file is what
 * makes the drift fail the build instead: it reads the migration off disk and
 * compares the JSON it inserts to the constant.
 *
 * If the definition legitimately changes, this test is expected to fail. The
 * answer is a NEW migration (and the seed's `update` branch, which re-applies
 * the code-owned fields on every run), not an edit to the applied one — see
 * `.context/app/database-changes.md`.
 *
 * ## And why it reads the guards
 *
 * The other half of the task is what the migration must NOT do: an admin's
 * renamed row and an operator's switched-off binding are theirs (`fp4`). The
 * cases below assert both statements are guarded by `NOT EXISTS` and that the
 * file contains no `UPDATE`, `DELETE` or `DROP` at all, which is the property
 * a reader would otherwise have to re-derive from the SQL every time.
 *
 * ## Not on the always-run list, deliberately
 *
 * It reads a file off disk, which is usually the shape that earns a place in
 * `leafAlwaysRunTests` — but the change this exists to catch is the DEFINITION
 * moving, and this file imports it, so a scoped run selects it from the same
 * module graph as every other reader. The other half of its inputs is an
 * applied migration, which is frozen: a branch editing it has already gone
 * wrong somewhere a reviewer can see.
 *
 * @see prisma/migrations/20260927100000_app_suggest_resource_capability/migration.sql
 * @see prisma/seeds/app-lelanea/014-suggest-resource.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { SUGGEST_RESOURCE_DEFINITION } from '@/lib/app/resources/suggest';
import { SUGGEST_RESOURCE_SLUG } from '@/lib/app/resources/suggestion';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { SUGGEST_RESOURCE_IMPL } from '@/prisma/seeds/app-lelanea/014-suggest-resource';

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260927100000_app_suggest_resource_capability/migration.sql'
);

const sql = readFileSync(MIGRATION, 'utf8');

/** The comment header, which carries the reasoning, is not SQL. */
const statements = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/**
 * The definition the migration inserts, read out of its dollar-quoted literal.
 * Dollar quoting is why this is a slice rather than a regex over escaped
 * quotes: the SQL holds the JSON exactly as the code writes it.
 */
function insertedDefinition(): unknown {
  const opened = statements.indexOf('$json$');
  const closed = statements.indexOf('$json$', opened + '$json$'.length);
  if (opened === -1 || closed === -1) {
    throw new Error('The migration no longer carries the definition as a $json$ literal');
  }
  return JSON.parse(statements.slice(opened + '$json$'.length, closed));
}

describe('the definition it inserts', () => {
  it('is the one the class advertises, and the one the seed writes', () => {
    expect(insertedDefinition()).toEqual(SUGGEST_RESOURCE_DEFINITION);
    expect(insertedDefinition()).toEqual(SUGGEST_RESOURCE_IMPL.functionDefinition);
  });

  it('is parsed as JSON by the database, not stored as text', () => {
    expect(statements).toContain('$json$::jsonb');
  });
});

describe('the row it inserts', () => {
  it('is the slug, handler and execution type the code resolves', () => {
    expect(statements).toContain(`'${SUGGEST_RESOURCE_SLUG}'`);
    expect(statements).toContain(`'${SUGGEST_RESOURCE_IMPL.executionHandler}'`);
    expect(statements).toContain(`'${SUGGEST_RESOURCE_IMPL.executionType}'`);
  });

  it('is written into the two tables the seed writes, and no others', () => {
    expect(statements.match(/INSERT INTO "(\w+)"/g)).toEqual([
      'INSERT INTO "ai_capability"',
      'INSERT INTO "ai_agent_capability"',
    ]);
  });
});

describe('the grant it inserts', () => {
  it('is to the guide, by the slug the code builds', () => {
    expect(VOICE_AGENT_SLUG).toBe('lelanea-guide');
    expect(statements).toContain(`a."slug" = '${VOICE_AGENT_SLUG}'`);
  });

  it('ignores a deleted agent, as every read path must', () => {
    expect(statements).toContain('a."deletedAt" IS NULL');
  });
});

describe('what it leaves alone', () => {
  it('guards both inserts on the row being absent', () => {
    // Two statements, two guards: one for the capability row, one for the
    // binding. A count, so a guard lost in a later edit is a failure rather
    // than a `toContain` that still passes on the surviving one.
    expect(statements.match(/NOT EXISTS/g)).toHaveLength(2);
  });

  it('never updates, deletes or drops anything', () => {
    // The population is non-empty — it inserts twice — so an empty match means
    // something (`fp6`).
    expect(statements.match(/INSERT INTO/g)).toHaveLength(2);
    expect(statements).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
  });
});
