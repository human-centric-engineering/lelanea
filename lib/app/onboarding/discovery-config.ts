/**
 * The discovery questions' setting on their module: the Core Set switch
 * (f-onboarding t-101).
 *
 * It is the module's own config, not a column of ours: Daybreak's `configSchema`
 * on the module that asks the questions (`lib/app/modules/definitions.ts`).
 * Daybreak gives it a form on that module's Config tab, validates every save
 * against this schema, and keeps every version on its Versions tab. We read it
 * through Daybreak's config reader and never write it ourselves
 * (`.context/app/building-with-daybreak.md`).
 *
 * **Pure: no database, no server import.** `lib/app/modules/definitions.ts`
 * imports this, and client components reach that file (`moduleSlugFromId`).
 * The reader is `discovery-config-store.ts`, which is server-only. Guarded by
 * `tests/unit/lib/app/modules/client-safe.test.ts`.
 */

import { z } from 'zod';

/**
 * The module the questions belong to when the set cannot be read. The set
 * names its own module (`AppQuestionSet.moduleId`), and that is the one used
 * whenever it is known; her file puts them in Onboarding.
 */
export const DISCOVERY_DEFAULT_MODULE_ID = 'module_00_onboarding';

/**
 * The switch's field, as a shape: the module's config is this beside the
 * register every module carries (`lib/app/modules/definitions.ts`, t-125).
 */
export const discoveryConfigShape = {
  coreSetOnly: z
    .boolean()
    .default(false)
    .describe(
      'Ask only the Core Set: the discovery questions weighted 100. When off, every question is asked. If it is on and no question is weighted 100, every question is asked.'
    ),
};

/**
 * The switch as this module reads it. Not strict, unlike the module's own
 * schema: the stored config also holds the module's register, which is not
 * this reader's, and a strict parse would refuse every config that has one.
 * The module's schema is what refuses an unknown key, on every save.
 */
export const discoveryConfigSchema = z.object(discoveryConfigShape);

export type DiscoveryConfig = z.infer<typeof discoveryConfigSchema>;
