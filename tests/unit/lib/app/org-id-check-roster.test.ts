/**
 * The orgId CHECK roster matches the schema (t-115).
 *
 * Every `app_*` table with an `orgId` column refuses a row with no org, by a
 * CHECK Prisma cannot model. `APP_ORG_OWNED_TABLES` in
 * `lib/app/leaf-db-drift.ts` names the tables whose CHECK the drift check
 * probes, written out rather than derived. This pins it to Sunrise's
 * tenant-owned roster, so a new `app_*` model with `orgId` fails here until it
 * joins the list, and the drift check then fails until its migration adds the
 * CHECK.
 *
 * Always-run (`lib/app/leaf-ci.ts`): the roster comes from the generated
 * client, and a branch that adds a model reaches this through no module graph.
 *
 * FORK NOTE: this reads Lelañea's own `lib/app/leaf-db-drift.ts` on purpose,
 * with no mock, because the list in it is what is being checked. It is ours,
 * not Daybreak's or Sunrise's, so no sync changes what it measures. A failure
 * means an `app_*` model with `orgId` and the list disagree: add the table to
 * `APP_ORG_OWNED_TABLES` (and its CHECK in a migration), never loosen this.
 */

import { describe, expect, it } from 'vitest';
import { APP_ORG_OWNED_TABLES } from '@/lib/app/leaf-db-drift';
import { tenantOwnedModels } from '@/lib/tenancy/classification';

/**
 * A real generated client on a pool that never connects, as in
 * `tests/unit/lib/tenancy/model-classification.test.ts`: its runtime data
 * model is what Sunrise's own classification reads, so this test and the
 * row-isolation policies agree on which tables are tenant-owned.
 */
async function orgOwnedAppTables(): Promise<string[]> {
  const { Pool } = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('@prisma/client');
  const pool = new Pool({ connectionString: 'postgresql://never:connects@127.0.0.1:1/never' });
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  // Ours by model name as well as by table: a leaf model with no @@map has a
  // table named after the model (`AppNewThing`), and must not slip past.
  return [...tenantOwnedModels(client)]
    .filter(([model, table]) => model.startsWith('App') || table.startsWith('app_'))
    .map(([, table]) => table)
    .sort();
}

describe('APP_ORG_OWNED_TABLES', () => {
  it('names exactly the tenant-owned app_* tables', async () => {
    const tenantOwned = await orgOwnedAppTables();

    // A roster that found nothing would agree with an empty list.
    expect(tenantOwned.length).toBeGreaterThan(30);
    expect([...APP_ORG_OWNED_TABLES].sort()).toEqual(tenantOwned);
  });
});
