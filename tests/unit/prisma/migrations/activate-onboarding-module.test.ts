/**
 * The migration that activates onboarding on databases that already exist
 * (§15 t-102).
 *
 * A migration is frozen once applied, so nothing refactors it along with the
 * code. This reads it off disk and pins the value it shares with code, the
 * module slug, and the guard that makes it leave an operator's choice alone.
 * That `active` is what Daybreak's engine treats as live is proven where it
 * matters, by `npm run smoke:app-onboarding` entering the node on the real
 * database (this file may not import the framework tier). If either value legitimately
 * changes, the answer is a new migration, never an edit to this one
 * (`.context/app/database-changes.md`).
 *
 * @see prisma/migrations/20261005100000_app_activate_onboarding_module/migration.sql
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

import { ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';

const SQL = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20261005100000_app_activate_onboarding_module/migration.sql'
  ),
  'utf8'
);
/** The statements, without the header comment. */
const statements = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('20261005100000_app_activate_onboarding_module', () => {
  it('moves the onboarding module, and only it, from draft to active', () => {
    expect(statements).toMatch(/UPDATE\s+"framework_module"/);
    expect(statements).toContain(`SET "status" = 'active'`);
    expect(statements).toContain(`"slug" = '${ONBOARDING_NODE_KEY}'`);
    expect(statements).toContain(`AND "status" = 'draft'`);
    expect(statements.match(/UPDATE/g)).toHaveLength(1);
  });

  it('inserts, deletes and drops nothing', () => {
    expect(statements).not.toMatch(/\b(INSERT|DELETE|DROP|ALTER)\b/i);
  });
});
