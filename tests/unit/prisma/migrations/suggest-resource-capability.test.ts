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
 * If the definition legitimately changes, the answer is a NEW migration (and
 * the seed's `update` branch, which re-applies the code-owned fields on every
 * run), never an edit to the applied one — see
 * `.context/app/database-changes.md`. So this file does not name a migration:
 * it finds the MOST RECENT one that establishes this row and pins that. Adding
 * the new migration is what makes it pass again, which is the point — pinning
 * the frozen file by name would have left a test that a new migration could not
 * satisfy, and the only ways out of that are deleting the test or editing an
 * applied migration and breaking its checksum on every database that has it.
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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { SUGGEST_RESOURCE_DEFINITION } from '@/lib/app/resources/suggest';
import { SUGGEST_RESOURCE_SLUG } from '@/lib/app/resources/suggestion';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { SUGGEST_RESOURCE_IMPL } from '@/prisma/seeds/app-lelanea/014-suggest-resource';

const MIGRATIONS = join(process.cwd(), 'prisma/migrations');
const SEED = join(process.cwd(), 'prisma/seeds/app-lelanea/014-suggest-resource.ts');

/**
 * The newest migration that inserts this capability row. Directory names are
 * timestamp-prefixed, so sorting them is chronological; a later migration that
 * revises the definition becomes the pinned one by existing.
 */
function newestEstablishingMigration(): { name: string; sql: string } {
  const found = readdirSync(MIGRATIONS)
    .sort()
    .map((name) => ({ name, path: join(MIGRATIONS, name, 'migration.sql') }))
    .filter((entry) => existsSync(entry.path))
    .map((entry) => ({ name: entry.name, sql: readFileSync(entry.path, 'utf8') }))
    .filter(
      (entry) => entry.sql.includes('INSERT INTO "ai_capability"') && entry.sql.includes('$json$')
    );
  const newest = found.at(-1);
  if (!newest) {
    throw new Error('No migration inserts the suggest_resource capability row');
  }
  return newest;
}

const migration = newestEstablishingMigration();
const sql = migration.sql;
const seedSource = readFileSync(SEED, 'utf8');

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

/** The statements with the dollar-quoted definition cut out of them. */
function sqlOutsideTheLiteral(): string {
  const opened = statements.indexOf('$json$');
  const closed = statements.indexOf('$json$', opened + '$json$'.length);
  return statements.slice(0, opened) + statements.slice(closed + '$json$'.length);
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

  it('gets a cuid-shaped id, because the admin API validates one', () => {
    // `ai_capability.id` is a path parameter, checked with `z.cuid()`
    // (`/^[cC][0-9a-z]{6,}$/`) before the route touches the database. A bare
    // `gen_random_uuid()::text` fails it, and the row would exist and be
    // unmanageable — 400 on rename, rate-limit, quarantine, delete and on
    // every change to the grant.
    expect(statements).not.toMatch(/^\s*gen_random_uuid\(\)::text,?$/m);
    expect(
      statements.match(/'c' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/g)
    ).toHaveLength(2);
  });

  it('is written into the two tables the seed writes, and no others', () => {
    expect(statements.match(/INSERT INTO "(\w+)"/g)).toEqual([
      'INSERT INTO "ai_capability"',
      'INSERT INTO "ai_agent_capability"',
    ]);
  });
});

/**
 * The five OPERATOR-OWNED literals — the ones the seed writes once and never
 * re-applies. On a fresh database this migration now writes them FIRST
 * (`prisma migrate reset` runs migrations before the seed), so seed 014's
 * `upsert` takes its `update` branch, which carries only the code-owned half.
 * Its `create` branch is therefore dead on a fresh database, and editing it
 * alone would change nothing anywhere — the trap this block exists to spring.
 */
describe('the operator-owned half the seed no longer reaches', () => {
  it.each([
    ['name', "'Suggest a resource'"],
    ['category', "'app'"],
  ])('says the same %s as the seed', (_field, literal) => {
    expect(statements).toContain(literal);
    expect(seedSource).toContain(literal);
  });

  it('says the same rateLimit as the seed', () => {
    // Anchored, not `toContain('30')`: an unquoted number has no delimiters of
    // its own, so a bare substring is still satisfied by 300 or 130 and the two
    // literals would drift apart under a passing test.
    expect(statements).toMatch(/\n\s*30,\n/);
    expect(seedSource).toMatch(/rateLimit:\s*30,/);
  });

  it('says the same description as the seed, character for character', () => {
    // Pulled out of the SQL rather than restated here: a copy in this file
    // would be a fourth place to drift.
    const match = /^\s*'(Hands the person[^']*)',$/m.exec(statements);
    if (!match) throw new Error('The migration no longer inserts a description literal');
    expect(seedSource).toContain(match[1]);
  });

  it('is active, as the seed creates it', () => {
    expect(statements).toMatch(/\n\s*true,\n\s*true\n/);
    expect(seedSource).toContain('isActive: true');
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
    // Outside the `$json$` literal only. The prose inside it is the tool
    // description the model reads, and a future wording of it ("never delete
    // anything") would fail this case for a reason that has nothing to do with
    // what the migration writes.
    expect(sqlOutsideTheLiteral()).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
  });
});
