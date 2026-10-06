/**
 * The migration that seats the synopsis agent on a database that already
 * exists (f-journey-record t-146).
 *
 * ## Why this file reads SQL
 *
 * The agent's name, description and instructions live in two places: the
 * constants in `lib/app/journey-record/synopsis/agent.ts`, which the seed
 * writes, and the `INSERT` below, which is what dev, preview and production
 * actually ran. A migration is frozen once applied, so nothing refactors it with
 * the code. This reads it off disk and compares, so the copies cannot drift.
 *
 * If the instructions change, existing databases need them too: that is a NEW
 * migration (the seed reconciles them as well, but only where someone runs it),
 * never an edit to the applied one (`.context/app/database-changes.md`). So this
 * pins the newest migration that writes the agent, not one by name, as the
 * precedent does (`suggest-resource-capability.test.ts`).
 *
 * ## And why it reads the guards
 *
 * What the migration must not do matters as much (`fp4`): an agent an operator
 * changed or deleted, and a seat an operator bound elsewhere, are theirs. The
 * cases below assert both statements are guarded by `NOT EXISTS` and that the
 * file contains no `UPDATE`, `DELETE` or `DROP`.
 *
 * Applying it to the dev database, twice, is what proved the SQL itself runs:
 * the first run wrote the agent and the seat, and the second wrote nothing.
 *
 * @see prisma/migrations/20261016100100_app_synopsis_seat/migration.sql
 * @see prisma/seeds/app-lelanea/026-synopsis-seat.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SYNOPSIS_AGENT_DESCRIPTION,
  SYNOPSIS_AGENT_NAME,
  SYNOPSIS_AGENT_SLUG,
  SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS,
} from '@/lib/app/journey-record/synopsis/agent';
import { SYNOPSIS_SEAT } from '@/lib/app/agent/pins';
import { VOICE_AGENT_SLUG, VOICE_PROFILE_SLUG } from '@/lib/app/voice/fingerprint';

const MIGRATIONS = join(process.cwd(), 'prisma/migrations');

/** The newest migration that writes the synopsis agent. */
function newestEstablishingMigration(): { name: string; sql: string } {
  const found = readdirSync(MIGRATIONS)
    .sort()
    .map((name) => ({ name, path: join(MIGRATIONS, name, 'migration.sql') }))
    .filter((entry) => existsSync(entry.path))
    .map((entry) => ({ name: entry.name, sql: readFileSync(entry.path, 'utf8') }))
    .filter(
      (entry) =>
        entry.sql.includes('INSERT INTO "ai_agent"') &&
        entry.sql.includes(`'${SYNOPSIS_AGENT_SLUG}'`)
    );
  const newest = found.at(-1);
  if (!newest) throw new Error('No migration writes the synopsis agent');
  return newest;
}

/** The text between a pair of dollar quotes with this tag. */
function dollarQuoted(sql: string, tag: string): string {
  const match = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(sql);
  if (!match) throw new Error(`No $${tag}$ block in the migration`);
  return match[1];
}

/** The SQL without its comments, so a word in the prose cannot pass or fail a check. */
function statements(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

describe('the synopsis seat migration', () => {
  const { sql } = newestEstablishingMigration();

  it('writes the instructions the code holds, word for word', () => {
    expect(dollarQuoted(sql, 'instructions')).toBe(SYNOPSIS_AGENT_SYSTEM_INSTRUCTIONS);
  });

  it('writes the name and description the seed writes', () => {
    expect(dollarQuoted(sql, 'desc')).toBe(SYNOPSIS_AGENT_DESCRIPTION);
    expect(statements(sql)).toContain(`'${SYNOPSIS_AGENT_NAME}'`);
  });

  it('wears her voice profile, in her guide’s org, restricted and with no model of its own', () => {
    const body = statements(sql);
    expect(body).toContain(`p."slug" = '${VOICE_PROFILE_SLUG}'`);
    expect(body).toContain(`g."slug" = '${VOICE_AGENT_SLUG}'`);
    expect(body).toContain("'restricted'");
    expect(body).toMatch(/'',\s*'',\s*true,\s*true,/);
  });

  it('binds the synopsis seat', () => {
    expect(statements(sql)).toContain(`'${SYNOPSIS_SEAT}'`);
  });

  it('only inserts where nothing is there, and never updates, deletes or drops', () => {
    const body = statements(sql);
    expect(body.match(/INSERT INTO/g)).toHaveLength(2);
    expect(body.match(/AND NOT EXISTS \(/g)).toHaveLength(2);
    expect(body).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/);
  });

  it('never seats a deleted agent', () => {
    const seat = statements(sql).slice(
      statements(sql).indexOf('INSERT INTO "framework_facilitation_agent"')
    );
    expect(seat).toContain('a."deletedAt" IS NULL');
  });
});
