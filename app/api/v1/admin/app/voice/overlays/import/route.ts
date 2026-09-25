/**
 * Apply a voice overlays file (Admin) — f-content-seeds t-92
 *
 * POST `{ file, removeAbsent? }` → the plan that ran. Re-planned in the
 * service's transaction; refused 409 if that plan carries a refusal. Audited
 * with every key it created, updated, removed or kept.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { fileImportRoute } from '@/lib/app/content/admin/file-routes';
import { applyOverlaysImport } from '@/lib/app/voice/overlays-admin';

export const POST = fileImportRoute(
  {
    action: 'app_voice_overlays.import',
    entityId: 'app_voice_overlay_set',
    entityName: 'Voice overlays',
  },
  async (file, removeAbsent, editorId) => ({
    plan: await applyOverlaysImport(file, removeAbsent, editorId),
  })
);
