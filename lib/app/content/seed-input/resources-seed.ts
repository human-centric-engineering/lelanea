/**
 * The resource library as seed material (f-content-seeds t-87).
 *
 * `seed-data/drafted/lelanea_resources.json` is no longer read at request time.
 * The drawer, the library route, the offering in the voice block, the
 * `suggest_resource` capability and chip resolution all read
 * `app_resource_collection`, `app_resource` and `app_resource_words` through
 * `@/lib/app/content/resource-store`. This module is where the file is still
 * imported; its callers are the seed
 * (`prisma/seeds/app-lelanea/018-resources.ts`) and tests. Nothing a request
 * reaches may import it, or this folder at all (t-89).
 *
 * The file is validated against the roster's module ids and the documents
 * file's ids, as it was at runtime before. `resources.notes` are working notes
 * about the words and are not written to a row.
 */

import rawResources from '@/seed-data/drafted/lelanea_resources.json';
import { buildResourcesFileSchema, type ResourcesFile } from '@/lib/app/content/resources';
import type { ResourcesSeed } from '@/lib/app/content/resource-view';
import { resourcesSeedFromFile } from '@/lib/app/content/content-files';
import { readFoundationalDocumentsFile } from '@/lib/app/content/seed-input/foundational-seed';
import { JOURNEY_MODULES } from '@/lib/app/journey/roster';

// Re-exported so the seed unit and its tests keep importing the shape from
// beside the builder; it is DECLARED in the view (t-89), because the store
// reads these rows back and no runtime module may import this folder.
export type { ResourcesSeed };

/** The resources file, validated against the roster and the documents file. Seeds and tests only. */
export function readResourcesFile(): ResourcesFile {
  const schema = buildResourcesFileSchema({
    moduleIds: new Set(JOURNEY_MODULES.map((module) => module.id)),
    documentIds: new Set(readFoundationalDocumentsFile().documents.map((d) => d.id)),
  });
  return schema.parse(rawResources);
}

/** The rows the seed writes, built from the file. See `resourcesSeedFromFile`. */
export function buildResourcesSeed(file: ResourcesFile = readResourcesFile()): ResourcesSeed {
  return resourcesSeedFromFile(file);
}
