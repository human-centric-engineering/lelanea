/**
 * Reads the Core Set switch from the module that owns the discovery questions
 * (f-onboarding t-101). Server-only: it goes through Daybreak's config reader,
 * which reads the database. The schema it parses with is the pure half,
 * `discovery-config.ts`.
 */

import { logger } from '@/lib/logging';
import { getModuleConfigForm } from '@/lib/framework/modules/config';
import { discoveryConfigSchema, type DiscoveryConfig } from '@/lib/app/onboarding/discovery-config';

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
