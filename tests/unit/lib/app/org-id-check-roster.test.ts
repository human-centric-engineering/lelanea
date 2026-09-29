/**
 * The orgId CHECK roster matches the schema (t-115).
 *
 * Every `app_*` table with an `orgId` column refuses a row with no org, by a
 * CHECK Prisma cannot model. `APP_ORG_OWNED_TABLES` in
 * `lib/app/leaf-db-drift.ts` names the tables whose CHECK the drift check
 * probes, written out rather than derived. This pins it to the schema text, so
 * a new `app_*` model with `orgId` fails here until it joins the list, and the
 * drift check then fails until its migration adds the CHECK.
 *
 * Always-run (`lib/app/leaf-ci.ts`): it reads `prisma/schema` off disk, and a
 * branch that adds a model reaches it through no module graph.
 *
 * FORK NOTE: this reads Lelañea's own `lib/app/leaf-db-drift.ts` on purpose,
 * with no mock, because the list in it is what is being checked. It is ours,
 * not Daybreak's or Sunrise's, so no sync changes what it measures. A failure
 * means an `app_*` model with `orgId` and the list disagree: add the table to
 * `APP_ORG_OWNED_TABLES` (and its CHECK in a migration), never loosen this.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ORG_OWNED_TABLES } from '@/lib/app/leaf-db-drift';

const SCHEMA_DIR = path.join(process.cwd(), 'prisma', 'schema');

/** Every `app_*` table whose model declares an `orgId` column, from the schema text. */
function orgOwnedAppTables(): string[] {
  const text = readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith('.prisma'))
    .map((file) => readFileSync(path.join(SCHEMA_DIR, file), 'utf8'))
    .join('\n');
  return [...text.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)]
    .filter((model) => /^\s*orgId\s+String/m.test(model[1]))
    .map((model) => /@@map\("([^"]+)"\)/.exec(model[1])?.[1])
    .filter((table): table is string => table?.startsWith('app_') ?? false)
    .sort();
}

describe('APP_ORG_OWNED_TABLES', () => {
  it('names exactly the app_* tables that carry orgId', () => {
    const inSchema = orgOwnedAppTables();

    // A scan that found nothing would agree with an empty list.
    expect(inSchema.length).toBeGreaterThan(30);
    expect([...APP_ORG_OWNED_TABLES].sort()).toEqual(inSchema);
  });
});
