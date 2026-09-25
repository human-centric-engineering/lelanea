/**
 * Apply a crisis resources file (Admin) — f-content-seeds t-92
 *
 * POST `{ file, removeAbsent? }` → the plan that ran. Re-planned in the
 * service's transaction; refused 409 if that plan carries a refusal. Audited
 * with every key it created, updated, removed or kept.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { fileImportRoute } from '@/lib/app/content/admin/file-routes';
import { applyCrisisImport } from '@/lib/app/safety/resources-admin';

export const POST = fileImportRoute(
  {
    action: 'app_crisis_resources.import',
    entityId: 'app_crisis_copy',
    entityName: 'Crisis resource — imported from a file',
  },
  async (file, removeAbsent) => {
    // Every row it writes is a draft; the file's provenance is never read.
    const { plan, removed } = await applyCrisisImport(file, removeAbsent);
    return { plan, audit: { removedRegions: removed } };
  }
);
