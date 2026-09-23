/**
 * The crisis copy reaches every environment, because nothing catches it if it
 * does not.
 *
 * t-88 removed the bundled-file fallback from the crisis path. That makes this
 * migration load-bearing in a way its siblings are not: before it, an
 * environment that had migrated `20260923100000_app_crisis_resources` (which
 * creates the tables and inserts nothing) and had never been asked to run the
 * seeder served the bundled file on every crisis turn and nobody noticed. With
 * the fallback gone it would serve NOTHING to a person in danger, with the app
 * otherwise healthy.
 *
 * So these cases pin the migration against what seed 010 writes, and pin the
 * two properties that make it safe to re-run.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads Lelañea's own crisis material
 * ---------------------------------------------------------------------------
 * Upstream there is no `lelanea_crisis_resources.json`, so this file fails at
 * import. That is the seam being unfilled, not a defect.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { getCrisisResources } from '@/lib/app/content/seed-input/crisis-resources';

const MIGRATION = 'prisma/migrations/20260929100200_app_crisis_resources_data/migration.sql';

function migrationSql(): string {
  return readFileSync(path.join(process.cwd(), MIGRATION), 'utf8');
}

/** The literal the migration embeds, parsed back out. */
function embedded(): {
  copy: Record<string, string>;
  status: string;
  regions: { region: string; emergencyNumber: string; services: unknown[] }[];
} {
  const match = /\$t88crisis\$([\s\S]*?)\$t88crisis\$/.exec(migrationSql());
  expect(match, 'the migration no longer embeds the crisis JSON').not.toBeNull();
  return JSON.parse(match![1]) as ReturnType<typeof embedded>;
}

describe('the crisis data migration', () => {
  it('writes exactly what seed 010 writes, copy for copy', () => {
    const file = getCrisisResources();

    // Mirrors `prisma/seeds/app-lelanea/010-crisis-resources.ts`'s projection.
    expect(embedded().copy).toEqual({
      ...file.copy,
      internationalName: file.international.name,
      internationalContact: file.international.contact,
      internationalUrl: file.international.url,
      internationalHours: file.international.hours,
    });
  });

  it('carries every region the file lists, with its number and services', () => {
    const file = getCrisisResources();
    const rows = embedded().regions;

    // fp6: non-empty, so the comparison below is not vacuously green.
    expect(file.regions.length).toBeGreaterThan(0);
    expect(rows).toEqual(
      file.regions.map((r) => ({
        region: r.region,
        emergencyNumber: r.emergencyNumber,
        services: r.services.map((s) => ({ ...s })),
      }))
    );
    for (const row of rows) {
      // The two conditions `contentFromRows` throws on. A row the migration
      // wrote must never be one the read then refuses to serve.
      expect(row.region).toMatch(/^[A-Z]{2}$/);
      expect(row.emergencyNumber.trim()).not.toBe('');
      expect(row.services.length).toBeGreaterThan(0);
    }
  });

  it('carries the provenance status the file declares, rather than assuming one', () => {
    expect(embedded().status).toBe(getCrisisResources().resources.provenance.status);
  });

  it('inserts only into empty tables, so an admin edit survives a re-deploy', () => {
    const sql = migrationSql();

    // Operator-owned (`fp4`). Without these guards a re-deploy would undo an
    // admin's corrected helpline, and would resurrect a region they removed on
    // purpose — the removal being deliberate is documented on the store.
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM "app_crisis_copy")');
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM "app_crisis_region")');
  });

  it('does not sign the words off on her behalf', () => {
    // A migration cannot grant a sign-off. The words stay draft until someone
    // says otherwise through the admin.
    expect(migrationSql()).not.toContain("'signed_off'");
  });
});
