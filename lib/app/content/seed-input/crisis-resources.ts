/**
 * The crisis resources as drafted: where a person in danger is pointed, by
 * region (f-safety t-58; product description §12).
 *
 * **Seed input, and nothing else.** The turn path reads `app_crisis_resource`
 * through `lib/app/safety/resources-store.ts` and throws when the tables cannot
 * answer — t-88 removed the fallback to this file on the owner's ruling
 * (2026-09-22), because a floor that quietly answers from a stale bundle is
 * worse than a crisis path that fails loudly. So an edit here reaches a
 * database that has never been seeded, and nothing else: changing what a person
 * in danger is shown is an admin edit or a migration
 * (`.context/app/database-changes.md`).
 *
 * Its callers are `prisma/seeds/app-lelanea/010-crisis-resources.ts` and tests.
 * Nothing under `app/`, `components/` or the rest of `lib/` may reach this
 * module — `tests/unit/lib/app/content/runtime-import-graph.test.ts` fails on
 * the path, naming it.
 *
 * **It ships as a draft.** `provenance.status` is `draft` and the accessor
 * returns it, so every surface that shows the resource can show that it is
 * awaiting sign-off. The schema admits nothing but `draft` and `signed_off`.
 *
 * @see lib/app/safety/resources-store.ts — what the turn path actually reads
 * @see lib/app/safety/resource.ts — which entry a request gets
 * @see .context/app/safety.md
 */

import rawCrisisResources from '@/seed-data/drafted/lelanea_crisis_resources.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';
import {
  crisisResourcesFileSchema,
  type CrisisResourcesFile,
} from '@/lib/validations/app-crisis-resources';

// The schema moved to `lib/validations/app-crisis-resources.ts` in t-92, because
// the admin import reads the same file shape and is reached by a request.
// Re-exported so the seed and its tests keep importing it from here.
export { crisisResourcesFileSchema, type CrisisResourcesFile };

let parsed: CrisisResourcesFile | null = null;

/** The whole file, validated and frozen. Throws if the file is malformed. */
export function getCrisisResources(): CrisisResourcesFile {
  parsed ??= deepFreezeParsed(crisisResourcesFileSchema.parse(rawCrisisResources));
  return parsed;
}
