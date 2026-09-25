/**
 * crisis resources as a file, in the seed's own shape (Admin) — f-content-seeds t-92
 *
 * GET — a JSON attachment the import and the seed will both take.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { fileExportRoute } from '@/lib/app/content/admin/file-routes';
import { exportCrisisFile, crisisExportFilename } from '@/lib/app/safety/resources-admin';

export const GET = fileExportRoute('crisis resources', exportCrisisFile, crisisExportFilename);
