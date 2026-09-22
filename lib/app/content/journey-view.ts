/**
 * How the stored journey is served (f-content-seeds t-87).
 *
 * The shapes every surface and the API receive, and the one projection that
 * builds them: the code roster (structure) joined with the rows (text). Pure,
 * with no database import, so the store, the seed's tests and the fake store in
 * `tests/helpers/app/content-stores.ts` all build the journey the same way.
 *
 * **Who owns what.** The roster (`lib/app/journey/roster.ts`) decides which
 * tiers and modules exist, each module's `number` and `tier`, and each tier's
 * `order` and module list. The rows decide every word: labels, intents,
 * titles, subtitles, display numbers and phases. A roster module with no row
 * throws, because a place with no name is not something to render. A row the
 * roster does not know is ignored: the roster is what says a module exists.
 *
 * **Validated on the way out.** `phases`, `phaseTiers` and `produces` are JSON
 * columns, and a row that fails its schema throws rather than rendering.
 *
 * @see lib/app/content/journey-store.ts — the reads and writes
 */

import { z } from 'zod';
import {
  moduleTierSchema,
  phaseTierSchema,
  producesSchema,
  type ModuleTier,
  type PhaseTier,
  type Produces,
} from '@/lib/app/content/schemas';
import type { ContentCollectionMeta } from '@/lib/app/content/document-view';
import { JOURNEY_MODULES, JOURNEY_TIERS } from '@/lib/app/journey/roster';

// ============================================================================
// Served shapes
// ============================================================================

/**
 * Immutable all the way down, not just at the outermost array. See
 * `lib/app/content/index.ts`, which re-exports it.
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** One tier of the journey, as served. */
export interface JourneyTierView {
  id: ModuleTier;
  label: string;
  /** The roster's. */
  order: number;
  /** Module ids in this tier, in order. The roster's. */
  modules: readonly string[];
  /** Authored prose: what this tier is for. */
  intent: string;
  /** Counts every write to the tier's text. */
  revision: number;
}

/** A module's internal phase grouping, as served. */
export interface JourneyPhaseTier {
  id: PhaseTier;
  label: string;
  order: number;
  /** Phase numbers in this grouping. */
  phases: readonly number[];
}

/**
 * One phase of a module, as served.
 *
 * `contentRef` survives the projection because it is a *link* — it names the
 * foundational document this phase shows, which a client turns straight into a
 * `/documents/:id` request. `proposed` survives because dropping it would be
 * the dishonest choice: a public reader would see a phase that is only a
 * proposal rendered exactly like one that is built.
 */
export interface JourneyPhase {
  number: number;
  displayNumber: string;
  title: string;
  description: string;
  /** The document or question set this phase shows, where there is one. */
  contentRef: string | null;
  /** `true` where the phase is a proposal rather than authored material. */
  proposed: boolean;
  phaseTier: PhaseTier | null;
  questionCount: number | null;
  personalized: boolean;
  requiresAcknowledgement: boolean;
  produces: DeepReadonly<Produces> | null;
}

/** One module of the journey, as served. */
export interface JourneyModuleView {
  id: string;
  /** The roster's. */
  number: number;
  displayNumber: string;
  title: string;
  subtitle: string | null;
  chartTitle: string | null;
  /** The roster's. */
  tier: ModuleTier;
  phases: readonly JourneyPhase[];
  phaseTiers: readonly JourneyPhaseTier[] | null;
  produces: DeepReadonly<Produces> | null;
  /** Counts every write to the module's text. */
  revision: number;
}

/** The seventeen-module journey: its tiers, its modules, and their phases. */
export interface JourneyStructure {
  collection: ContentCollectionMeta & { subtitle: string };
  tiers: readonly JourneyTierView[];
  modules: readonly JourneyModuleView[];
}

// ============================================================================
// Stored JSON
// ============================================================================

/** One phase as stored: exactly the served shape, every field present. */
export const storedPhaseSchema = z.strictObject({
  number: z.number().int().positive(),
  displayNumber: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  contentRef: z.string().min(1).nullable(),
  proposed: z.boolean(),
  phaseTier: phaseTierSchema.nullable(),
  questionCount: z.number().int().nonnegative().nullable(),
  personalized: z.boolean(),
  requiresAcknowledgement: z.boolean(),
  produces: producesSchema.nullable(),
});

export const storedPhasesSchema = z.array(storedPhaseSchema).superRefine((phases, ctx) => {
  const numbers = phases.map((phase) => phase.number);
  if (new Set(numbers).size !== numbers.length) {
    ctx.addIssue({ code: 'custom', message: 'a phase number is repeated' });
  }
});

export const storedPhaseTiersSchema = z
  .array(
    z.strictObject({
      id: phaseTierSchema,
      label: z.string().min(1),
      order: z.number().int().positive(),
      phases: z.array(z.number().int().positive()).min(1),
    })
  )
  .nullable();

export const storedProducesSchema = producesSchema.nullable();

export type StoredPhase = z.infer<typeof storedPhaseSchema>;

// ============================================================================
// Rows
// ============================================================================

/**
 * The columns a view is built from. Structural rather than the Prisma payload
 * types, so a test can build them from the seed without a client.
 */
export interface JourneyRow {
  id: string;
  title: string;
  subtitle: string;
  version: string;
  locale: string;
}

export interface JourneyTierRow {
  id: string;
  label: string;
  intent: string;
  revision: number;
}

export interface JourneyModuleRow {
  id: string;
  displayNumber: string;
  title: string;
  subtitle: string | null;
  chartTitle: string | null;
  phases: unknown;
  phaseTiers: unknown;
  produces: unknown;
  revision: number;
}

// ============================================================================
// Projection
// ============================================================================

/**
 * Validate a module row's JSON columns, and that its phase tiers name only
 * phases it has.
 *
 * @throws naming the module and what failed.
 */
export function parseModuleJson(
  row: Pick<JourneyModuleRow, 'id' | 'phases' | 'phaseTiers' | 'produces'>
): {
  phases: StoredPhase[];
  phaseTiers: z.infer<typeof storedPhaseTiersSchema>;
  produces: z.infer<typeof storedProducesSchema>;
} {
  const phases = storedPhasesSchema.safeParse(row.phases);
  const phaseTiers = storedPhaseTiersSchema.safeParse(row.phaseTiers);
  const produces = storedProducesSchema.safeParse(row.produces);
  if (!phases.success || !phaseTiers.success || !produces.success) {
    throw new Error(
      `Journey module "${row.id}" failed validation: ` +
        [
          phases.success ? '' : `phases ${phases.error.message}`,
          phaseTiers.success ? '' : `phaseTiers ${phaseTiers.error.message}`,
          produces.success ? '' : `produces ${produces.error.message}`,
        ]
          .filter(Boolean)
          .join('; ')
    );
  }
  const known = new Set(phases.data.map((phase) => phase.number));
  for (const tier of phaseTiers.data ?? []) {
    const missing = tier.phases.find((number) => !known.has(number));
    if (missing !== undefined) {
      throw new Error(
        `Journey module "${row.id}": phase tier "${tier.id}" names phase ${missing}, which it does not have`
      );
    }
  }
  return { phases: phases.data, phaseTiers: phaseTiers.data, produces: produces.data };
}

/**
 * The journey as served: the roster, in its order, with each tier's and each
 * module's text from its row.
 *
 * @throws when a roster tier or module has no row, or a module row fails
 * validation. See the module docblock.
 */
export function toJourneyStructure(
  journey: JourneyRow,
  tierRows: readonly JourneyTierRow[],
  moduleRows: readonly JourneyModuleRow[]
): JourneyStructure {
  const tiersById = new Map(tierRows.map((row) => [row.id, row]));
  const modulesById = new Map(moduleRows.map((row) => [row.id, row]));

  const tiers = JOURNEY_TIERS.map((rosterTier): JourneyTierView => {
    const row = tiersById.get(rosterTier.id);
    if (!row) throw new Error(`Journey tier "${rosterTier.id}" is in the roster but has no row`);
    return {
      id: moduleTierSchema.parse(rosterTier.id),
      label: row.label,
      order: rosterTier.order,
      modules: JOURNEY_MODULES.filter((m) => m.tier === rosterTier.id).map((m) => m.id),
      intent: row.intent,
      revision: row.revision,
    };
  });

  const modules = JOURNEY_MODULES.map((rosterModule): JourneyModuleView => {
    const row = modulesById.get(rosterModule.id);
    if (!row) {
      throw new Error(`Journey module "${rosterModule.id}" is in the roster but has no row`);
    }
    const { phases, phaseTiers, produces } = parseModuleJson(row);
    return {
      id: row.id,
      number: rosterModule.number,
      displayNumber: row.displayNumber,
      title: row.title,
      subtitle: row.subtitle,
      chartTitle: row.chartTitle,
      tier: rosterModule.tier,
      phases,
      phaseTiers,
      produces,
      revision: row.revision,
    };
  });

  return {
    collection: {
      id: journey.id,
      title: journey.title,
      subtitle: journey.subtitle,
      version: journey.version,
      locale: journey.locale,
    },
    tiers,
    modules,
  };
}
