/**
 * What importing a voice overlays file would do (Admin) — f-content-seeds t-92
 *
 * POST `{ file, removeAbsent? }` → the plan. Writes nothing. A stored item
 * the file leaves out is listed as kept unless `removeAbsent` is true.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { filePreviewRoute } from '@/lib/app/content/admin/file-routes';
import { previewOverlaysImport } from '@/lib/app/voice/overlays-admin';

export const POST = filePreviewRoute('voice overlays', previewOverlaysImport);
