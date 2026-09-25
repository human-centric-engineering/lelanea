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
 */

import { z } from 'zod';

import { logger } from '@/lib/logging';
import { getModuleConfigForm } from '@/lib/framework/modules/config';

/**
 * The module the questions belong to when the set cannot be read. The set
 * names its own module (`AppQuestionSet.moduleId`), and that is the one used
 * whenever it is known; her file puts them in Onboarding.
 */
export const DISCOVERY_DEFAULT_MODULE_ID = 'module_00_onboarding';

/**
 * Strict, like every module schema here: an unknown key is refused rather than
 * stored beside the real one and read as saved.
 */
export const discoveryConfigSchema = z.strictObject({
  coreSetOnly: z
    .boolean()
    .default(false)
    .describe(
      'Ask only the Core Set: the discovery questions weighted 100. When off, every question is asked. If it is on and no question is weighted 100, every question is asked.'
    ),
});

export type DiscoveryConfig = z.infer<typeof discoveryConfigSchema>;

const DEFAULT_CONFIG: DiscoveryConfig = { coreSetOnly: false };

/**
 * The switch as the module stores it. Every question is asked when it cannot
 * be read, which is the default and the safe direction: a person asked too
 * much is better than one whose onboarding asks nothing. Logged, so the
 * fallback is never silent.
 */
export async function readDiscoveryConfig(moduleSlug: string): Promise<DiscoveryConfig> {
  try {
    const form = await getModuleConfigForm(moduleSlug);
    const parsed = discoveryConfigSchema.safeParse(form.values ?? {});
    if (parsed.success) return parsed.data;
    logger.error('readDiscoveryConfig: stored module config is invalid; asking every question', {
      moduleSlug,
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  } catch (err) {
    logger.error('readDiscoveryConfig: module config could not be read; asking every question', {
      moduleSlug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return DEFAULT_CONFIG;
}
