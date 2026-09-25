/**
 * Apply a golden set file (Admin) — f-content-seeds t-92
 *
 * POST `{ file, removeAbsent? }` → the plan that ran. Re-planned in the
 * service's transaction; refused 409 if that plan carries a refusal. Audited
 * with every key it created, updated, removed or kept.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { fileImportRoute } from '@/lib/app/content/admin/file-routes';
import { applyGoldenSetImport } from '@/lib/app/voice/golden-set-editor';

export const POST = fileImportRoute(
  {
    action: 'app_voice_golden_set.import',
    entityId: 'app_voice_golden_set',
    entityName: 'Voice golden set',
  },
  async (file, removeAbsent, editorId) => ({
    plan: await applyGoldenSetImport(file, removeAbsent, editorId),
  })
);
