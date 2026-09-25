/**
 * What importing a golden set file would do (Admin) — f-content-seeds t-92
 *
 * POST `{ file, removeAbsent? }` → the plan. Writes nothing. A stored item
 * the file leaves out is listed as kept unless `removeAbsent` is true.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { filePreviewRoute } from '@/lib/app/content/admin/file-routes';
import { previewGoldenSetImport } from '@/lib/app/voice/golden-set-editor';

export const POST = filePreviewRoute('golden set', previewGoldenSetImport);
