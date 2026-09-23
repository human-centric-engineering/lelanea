/**
 * The journey's text as seed material (f-content-seeds t-87).
 *
 * `content/lelanea_module_structure.json` is no longer read at request time.
 * Every surface reads `app_journey`, `app_journey_tier` and `app_journey_module`
 * through `@/lib/app/content/journey-store`, joined with the code roster. This
 * module is where the file is still imported, and its callers are the seed
 * (`prisma/seeds/app-lelanea/016-journey-structure.ts`) and tests. Nothing a
 * request reaches may import it; t-89 makes that a lint rule.
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
import {
  journeyStructureFileSchema,
  type JourneyModule,
  type JourneyStructureFile,
} from '@/lib/app/content/schemas';
import {
  storedPhasesSchema,
  storedPhaseTiersSchema,
  storedProducesSchema,
  type JourneyModuleRow,
  type JourneySeed,
} from '@/lib/app/content/journey-view';
import { JOURNEY_MODULES, JOURNEY_TIERS } from '@/lib/app/journey/roster';

// Re-exported so the seed unit and its tests keep importing the shape from
// beside the builder; it is DECLARED in the view (t-89), because the store
// reads these rows back and no runtime module may import this folder.
export type { JourneySeed };

/** The structure file, validated. Seeds and tests only. */
export function readJourneyStructureFile(): JourneyStructureFile {
  return journeyStructureFileSchema.parse(rawJourneyStructure);
}

/**
 * Throw unless the file's tiers and modules are exactly the roster's: the same
 * ids, the same numbers, the same tier for each module, the same tier order.
 */
export function assertRosterMatchesFile(file: JourneyStructureFile): void {
  const problems: string[] = [];
  const fileTiers = [...file.tiers].sort((a, b) => a.order - b.order);
  const rosterTiers = JOURNEY_TIERS.map((tier) => `${tier.id}@${tier.order}`).join(',');
  if (fileTiers.map((tier) => `${tier.id}@${tier.order}`).join(',') !== rosterTiers) {
    problems.push(`tiers differ: the roster has ${rosterTiers}`);
  }
  const fileModules = [...file.modules].sort((a, b) => a.number - b.number);
  const rosterModules = JOURNEY_MODULES.map((m) => `${m.id}#${m.number}:${m.tier}`).join(',');
  if (fileModules.map((m) => `${m.id}#${m.number}:${m.tier}`).join(',') !== rosterModules) {
    problems.push(`modules differ: the roster has ${rosterModules}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `The journey roster (lib/app/journey/roster.ts) and content/lelanea_module_structure.json ` +
        `disagree: ${problems.join('; ')}`
    );
  }
}

function toModuleRow(entry: JourneyModule): Omit<JourneyModuleRow, 'revision'> {
  return {
    id: entry.id,
    displayNumber: entry.displayNumber,
    title: entry.title,
    subtitle: entry.subtitle ?? null,
    chartTitle: entry.chartTitle ?? null,
    phases: storedPhasesSchema.parse(
      (entry.phases ?? []).map((phase) => ({
        number: phase.number,
        displayNumber: phase.displayNumber,
        title: phase.title,
        description: phase.description,
        contentRef: phase.contentRef ?? null,
        proposed: phase.proposed ?? false,
        phaseTier: phase.phaseTier ?? null,
        questionCount: phase.questionCount ?? null,
        personalized: phase.personalized ?? false,
        requiresAcknowledgement: phase.requiresAcknowledgement ?? false,
        produces: phase.produces ?? null,
      }))
    ),
    phaseTiers: storedPhaseTiersSchema.parse(
      entry.phaseTiers?.map((tier) => ({
        id: tier.id,
        label: tier.label,
        order: tier.order,
        phases: tier.phases,
      })) ?? null
    ),
    produces: storedProducesSchema.parse(entry.produces ?? null),
  };
}

/** The rows the seed writes, built from the file, in roster order. */
export function buildJourneySeed(
  file: JourneyStructureFile = readJourneyStructureFile()
): JourneySeed {
  assertRosterMatchesFile(file);
  const tiersById = new Map(file.tiers.map((tier) => [tier.id, tier]));
  const modulesById = new Map(file.modules.map((entry) => [entry.id, entry]));

  return {
    journey: {
      id: file.app.name,
      title: file.app.journeyTitle,
      subtitle: file.app.journeySubtitle,
      version: file.app.version,
      locale: file.app.locale,
    },
    // Non-null: `assertRosterMatchesFile` has just proved every roster id is in
    // the file.
    tiers: JOURNEY_TIERS.map((rosterTier) => {
      const tier = tiersById.get(rosterTier.id)!;
      return { id: tier.id, label: tier.label, intent: tier.intent };
    }),
    modules: JOURNEY_MODULES.map((rosterModule) => toModuleRow(modulesById.get(rosterModule.id)!)),
  };
}
