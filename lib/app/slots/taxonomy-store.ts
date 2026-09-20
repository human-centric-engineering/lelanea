/**
 * The authored slot taxonomy, read from the tables an admin edits (f-slots t-70).
 *
 * `app_slot_definition` holds the current wording of every global slot;
 * `app_slot_definition_revision` holds one row per version, a full snapshot
 * rather than a diff. This module is the only reader of both, and — until the
 * editor lands (t-71) — the seed is the only writer.
 *
 * ## The provider, and why it has no fallback
 *
 * {@link loadGlobalSlotDefinitions} is registered from
 * `lib/app/leaf-bootstrap.ts` as Daybreak's global slot provider, and is the
 * seam's first production caller. The framework sync calls it, stamps
 * `scope = global` on what it returns, and reconciles that into
 * `framework_slot_definition` (`lib/framework/data-slots/sync.ts`).
 *
 * **There is deliberately no fallback to the bundled file.** The crisis
 * resource has one because a crisis turn must never depend on a database read
 * succeeding (`lib/app/safety/resources-store.ts`); a slot definition is not
 * that. Falling back here would be actively wrong in the case that matters: on
 * a database where an admin has RETIRED a slot, a boot that failed to read the
 * table would re-supply the retired slug from the file and the sync would
 * dutifully reactivate its projection. An unseeded database therefore has no
 * global slots, which is the truth, and the seed is what changes that.
 *
 * The seam is safe on empty for the same reason (its own `fp4` note): a
 * provider returning nothing is read as a fluke, never as "retire them all",
 * so the pass writes no row.
 *
 * ## A stored row that fails validation is dropped, not served
 *
 * The classifier columns are free-form `String` (mirroring the framework's own
 * X1 convention), so a hand edit can put an unrecognised value in one. Such a
 * row is logged and left out rather than passed to the sync, where it would
 * reach `framework_slot_definition` and from there the capture prompt. One bad
 * row does not take the rest of the taxonomy with it.
 *
 * @see lib/app/content/slot-taxonomy.ts — the bundled file the seed loads
 * @see .context/app/slots.md
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import type { SlotDefinitionInput } from '@/lib/framework/data-slots';
import {
  SLOT_VISIBILITY,
  SLOT_MODE,
  SLOT_DATA_TYPE,
  SLOT_SENSITIVITY,
} from '@/lib/framework/data-slots';

/**
 * The definition fields a revision snapshots — the whole authored surface,
 * minus the slug (the identity, which never changes) and the version.
 *
 * Derived rather than hand-listed so a new authored column is added in one
 * place and flows to the snapshot, the diff and the store's reads. Same
 * discipline as the framework sync's `ResolvedSlotDefinition`.
 */
export const SLOT_DEFINITION_FIELDS = [
  'group',
  'description',
  'visibility',
  'mode',
  'dataType',
  'sensitivity',
  'priorityWeight',
  'isActive',
] as const;

export type SlotDefinitionField = (typeof SLOT_DEFINITION_FIELDS)[number];

/** The authored fields of one slot, as stored. Classifiers still free-form. */
export interface StoredSlotDefinitionFields {
  group: string;
  description: string;
  visibility: string;
  mode: string;
  dataType: string;
  sensitivity: string;
  priorityWeight: number;
  isActive: boolean;
}

/** One stored definition, with its identity and current version. */
export interface StoredSlotDefinition extends StoredSlotDefinitionFields {
  slug: string;
  version: number;
}

function isKnown<T extends Record<string, string>>(
  vocabulary: T,
  value: string
): value is T[keyof T] {
  return Object.values(vocabulary).includes(value);
}

/**
 * Narrow a stored row's free-form classifiers to the framework's vocabulary, or
 * return `null` naming the first that is not recognised.
 */
function toSlotDefinitionInput(
  row: StoredSlotDefinition
): { input: SlotDefinitionInput } | { unknownField: SlotDefinitionField; value: string } {
  if (!isKnown(SLOT_VISIBILITY, row.visibility)) {
    return { unknownField: 'visibility', value: row.visibility };
  }
  if (!isKnown(SLOT_MODE, row.mode)) {
    return { unknownField: 'mode', value: row.mode };
  }
  if (!isKnown(SLOT_DATA_TYPE, row.dataType)) {
    return { unknownField: 'dataType', value: row.dataType };
  }
  if (!isKnown(SLOT_SENSITIVITY, row.sensitivity)) {
    return { unknownField: 'sensitivity', value: row.sensitivity };
  }
  return {
    input: {
      slug: row.slug,
      group: row.group,
      description: row.description,
      visibility: row.visibility,
      mode: row.mode,
      dataType: row.dataType,
      sensitivity: row.sensitivity,
      priorityWeight: row.priorityWeight,
    },
  };
}

const DEFINITION_SELECT = {
  slug: true,
  version: true,
  group: true,
  description: true,
  visibility: true,
  mode: true,
  dataType: true,
  sensitivity: true,
  priorityWeight: true,
  isActive: true,
} satisfies Prisma.AppSlotDefinitionSelect;

/**
 * Every stored definition, retired ones included, in a stable order.
 *
 * The editor and the history view read this; the provider below reads only the
 * active ones. Ordered by group then slug so two calls render identically.
 */
export async function listSlotDefinitions(): Promise<StoredSlotDefinition[]> {
  return prisma.appSlotDefinition.findMany({
    select: DEFINITION_SELECT,
    orderBy: [{ group: 'asc' }, { slug: 'asc' }],
  });
}

/**
 * The provider Daybreak's global slot sync calls. Active definitions only — a
 * retired row is withheld, which is what makes the sync deactivate its
 * projection (its deactivate pass is scoped to `global` rows, so it touches no
 * module's slot).
 *
 * Throws nothing of its own: the sync logs a provider fault at boot and
 * rethrows it on an on-demand re-sync, which is the behaviour the caller who
 * asked for the re-sync needs.
 */
export async function loadGlobalSlotDefinitions(): Promise<SlotDefinitionInput[]> {
  const rows = await prisma.appSlotDefinition.findMany({
    where: { isActive: true },
    select: DEFINITION_SELECT,
    orderBy: [{ group: 'asc' }, { slug: 'asc' }],
  });

  const definitions: SlotDefinitionInput[] = [];
  for (const row of rows) {
    const result = toSlotDefinitionInput(row);
    if ('unknownField' in result) {
      logger.error(
        'loadGlobalSlotDefinitions: stored slot definition has an unrecognised classifier — withheld from the framework sync',
        { slug: row.slug, field: result.unknownField, value: result.value }
      );
      continue;
    }
    definitions.push(result.input);
  }

  return definitions;
}

/**
 * Which of the snapshot fields differ between two versions of a definition.
 *
 * Exported because the seed and the editor both need it, and because it is what
 * an "edit that changed nothing" test asserts on: an empty result means no
 * revision is written and no version is bumped.
 */
export function changedDefinitionFields(
  before: StoredSlotDefinitionFields,
  after: StoredSlotDefinitionFields
): SlotDefinitionField[] {
  return SLOT_DEFINITION_FIELDS.filter((field) => before[field] !== after[field]);
}
