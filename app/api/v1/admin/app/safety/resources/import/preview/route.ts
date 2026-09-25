/**
 * What importing a crisis resources file would do (Admin) — f-content-seeds t-92
 *
 * POST `{ file, removeAbsent? }` → the plan. Writes nothing. A stored item
 * the file leaves out is listed as kept unless `removeAbsent` is true.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { filePreviewRoute } from '@/lib/app/content/admin/file-routes';
import { previewCrisisImport } from '@/lib/app/safety/resources-admin';

export const POST = filePreviewRoute('crisis resources', previewCrisisImport);
