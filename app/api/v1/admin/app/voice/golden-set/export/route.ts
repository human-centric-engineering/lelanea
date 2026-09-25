/**
 * golden set as a file, in the seed's own shape (Admin) — f-content-seeds t-92
 *
 * GET — a JSON attachment the import and the seed will both take.
 *
 * @see lib/app/content/admin/file-routes.ts
 */

import { fileExportRoute } from '@/lib/app/content/admin/file-routes';
import { exportGoldenSetFile, goldenSetExportFilename } from '@/lib/app/voice/golden-set-editor';

export const GET = fileExportRoute('golden set', exportGoldenSetFile, goldenSetExportFilename);
