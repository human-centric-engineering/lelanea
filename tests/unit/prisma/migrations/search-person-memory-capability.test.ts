/**
 * `20261009100000_app_search_person_memory_capability` (f-memory t-130):
 * the `search_person_memory` row and its grant on every existing database. The shape and
 * the reasons are t-93's (`suggest-resource-capability.test.ts`); this pins
 * the three copies of the definition together and the operator-owned literals
 * to the seed's.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  SEARCH_PERSON_MEMORY_DEFINITION,
  SEARCH_PERSON_MEMORY_SLUG,
} from '@/lib/app/memory/search-capability';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { SEARCH_PERSON_MEMORY_IMPL } from '@/prisma/seeds/app-lelanea/024-search-person-memory';

const sql = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20261009100000_app_search_person_memory_capability/migration.sql'
  ),
  'utf8'
);
const seedSource = readFileSync(
  join(process.cwd(), 'prisma/seeds/app-lelanea/024-search-person-memory.ts'),
  'utf8'
);

/** The comment header carries the reasoning; it is not SQL. */
const statements = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

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
    expect(insertedDefinition()).toEqual(SEARCH_PERSON_MEMORY_DEFINITION);
    expect(insertedDefinition()).toEqual(SEARCH_PERSON_MEMORY_IMPL.functionDefinition);
    expect(statements).toContain('$json$::jsonb');
  });
});

describe('the row it inserts', () => {
  it('is the slug, handler and execution type the code resolves', () => {
    expect(statements).toContain(`'${SEARCH_PERSON_MEMORY_SLUG}'`);
    expect(statements).toContain(`'${SEARCH_PERSON_MEMORY_IMPL.executionHandler}'`);
    expect(statements).toContain(`'${SEARCH_PERSON_MEMORY_IMPL.executionType}'`);
  });

  it('gets cuid-shaped ids, because the admin API validates them', () => {
    expect(
      statements.match(/'c' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/g)
    ).toHaveLength(2);
  });

  it('writes the two tables the seed writes, and no others', () => {
    expect(statements.match(/INSERT INTO "(\w+)"/g)).toEqual([
      'INSERT INTO "ai_capability"',
      'INSERT INTO "ai_agent_capability"',
    ]);
  });

  it.each([
    ['name', "'Search what the person said before'"],
    ['category', "'app'"],
  ])('says the same %s as the seed', (_field, literal) => {
    expect(statements).toContain(literal);
    expect(seedSource).toContain(literal);
  });

  it('says the same rateLimit and description as the seed', () => {
    expect(statements).toMatch(/\n\s*20,\n/);
    expect(seedSource).toMatch(/rateLimit:\s*20,/);
    const match = /^\s*'(Finds, by meaning[^']*)',$/m.exec(statements);
    if (!match) throw new Error('The migration no longer inserts a description literal');
    expect(seedSource).toContain(match[1]);
  });
});

describe('the grant it inserts', () => {
  it('is to the guide, not a deleted one, under the guide’s org', () => {
    expect(statements).toContain(`a."slug" = '${VOICE_AGENT_SLUG}'`);
    expect(statements).toContain('a."deletedAt" IS NULL');
    expect(statements).toContain('a."orgId"');
  });
});

describe('what it leaves alone', () => {
  it('guards both inserts on the row being absent, and never updates or deletes', () => {
    expect(statements.match(/NOT EXISTS/g)).toHaveLength(2);
    expect(statements).not.toMatch(/\b(UPDATE|DELETE|DROP)\b/);
  });
});
