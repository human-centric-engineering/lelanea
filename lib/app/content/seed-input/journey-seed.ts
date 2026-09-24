/**
 * The journey's text as seed material (f-content-seeds t-87).
 *
 * `content/lelanea_module_structure.json` is no longer read at request time.
 * Every surface reads `app_journey`, `app_journey_tier` and `app_journey_module`
 * through `@/lib/app/content/journey-store`, joined with the code roster. This
 * module is where the file is still imported, and its callers are the seed
 * (`prisma/seeds/app-lelanea/016-journey-structure.ts`) and tests. Nothing a request
 * reaches may import it, or this folder at all — t-89 made that a lint rule
 * plus a graph test (`tests/unit/lib/app/content/runtime-import-graph.test.ts`).
 *
 * **What is seeded is what was served.** Each phase is projected field by field
 * exactly as `getJourneyStructure()` projected it from the file before t-87, so
 * the maintainers' working notes (`notes`, `contentNote`, `appBehavior`, the
 * content file names) are never written to a row, let alone served.
 *
 * **The file and the roster must agree.** The file still carries each module's
 * number and tier, and so does the roster. {@link buildJourneySeed} throws if
 * they differ, so the roster cannot quietly drift from the words it is joined
 * with before the first row is written.
 */

import rawJourneyStructure from '@/content/lelanea_module_structure.json';
import { journeyStructureFileSchema, type JourneyStructureFile } from '@/lib/app/content/schemas';
import type { JourneySeed } from '@/lib/app/content/journey-view';
import { assertRosterMatchesFile, journeySeedFromFile } from '@/lib/app/content/content-files';

// Re-exported so the seed unit and its tests keep importing the shape from
// beside the builder; it is DECLARED in the view (t-89), because the store
// reads these rows back and no runtime module may import this folder.
export type { JourneySeed };

/** The structure file, validated. Seeds and tests only. */
export function readJourneyStructureFile(): JourneyStructureFile {
  return journeyStructureFileSchema.parse(rawJourneyStructure);
}

/** The rows the seed writes, built from the file, in roster order. See `journeySeedFromFile`. */
export function buildJourneySeed(
  file: JourneyStructureFile = readJourneyStructureFile()
): JourneySeed {
  return journeySeedFromFile(file);
}

/** Re-exported for the tests that pin the roster against her file. */
export { assertRosterMatchesFile };
