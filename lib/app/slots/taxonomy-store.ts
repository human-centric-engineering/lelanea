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
 * **There is deliberately no fallback to the bundled file.** Nothing in the
 * app has one any more — t-88 removed the last of them, from the crisis
 * resource (`lib/app/safety/resources-store.ts`), for the same reason this
 * module never had one: a second copy of authored content is the copy nobody
 * signs off, and it answers in place of the rows an admin just corrected.
 * Falling back here would be actively wrong in the case that matters: on
 * a database where an admin has RETIRED a slot, a boot that failed to read the
 * table would re-supply the retired slug from the file and the sync would
 * dutifully reactivate its projection. An unseeded database therefore has no
 * global slots, which is the truth, and the seed is what changes that.
 *
 * ## What the sync does with what we hand it — do not re-derive this
 *
 * Three behaviours of Daybreak's global pass decide what this module must do,
 * and all three are pinned, executably, in
 * `tests/integration/lib/framework/data-slots/global-slots.test.ts`:
 *
 * - *"a slug the provider drops is deactivated"* — omission is how a slot is
 *   retired.
 * - *"an empty provider on a fluke boot leaves every global row active"* —
 *   omitting **everything** is read as a fluke and retires nothing.
 * - *"re-syncing after an edit writes the edit, and re-syncing again writes
 *   nothing"* — the pass is idempotent.
 *
 * **Cite those cases; do not restate them from `sync.ts`.** Three earlier
 * comments in this feature described that contract in prose, each re-read from
 * the implementation, and `/code-review` found all three wrong — including one
 * that had just been "corrected" in the round before. The test is the statement
 * of record: it fails if Daybreak changes the behaviour, which prose cannot.
 * That matters here more than usual, because this seam is carried ahead of
 * Daybreak (`.context/app/divergences.md` Row 22) and its upstream version may
 * not behave identically.
 *
 * ## A stored row that fails validation is dropped, not served
 *
 * The classifier columns are free-form `String` (mirroring the framework's own
 * X1 convention), so a hand edit can put an unrecognised value in one. Such a
 * row is logged and left out rather than passed to the sync, where it would
 * reach `framework_slot_definition` and from there the capture prompt. One bad
 * row does not take the rest of the taxonomy with it.
 *
 * What withholding COSTS follows from the first two cases above, and the two
 * outcomes are opposites — which is the whole reason the log distinguishes
 * them. See {@link loadGlobalSlotDefinitions}.
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
 * One list rather than three, so a new authored column is added in one place
 * and flows to the snapshot, the diff and the seed's v1 `changedFields`. Same
 * discipline as the framework sync's `ResolvedSlotDefinition` — and pinned
 * against the model itself in this module's test, because a constant that
 * merely *looks* derived drifts the moment someone adds a column.
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

/**
 * One stored definition, as the provider reads it.
 *
 * No `version`: nothing here reads it. The editor (t-71) will, and it can widen
 * this and {@link DEFINITION_SELECT} together — a select that fetches a column
 * no caller reads is how a type and a query start disagreeing.
 */
export interface StoredSlotDefinition extends StoredSlotDefinitionFields {
  slug: string;
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
  const withheld: string[] = [];
  for (const row of rows) {
    const result = toSlotDefinitionInput(row);
    if ('unknownField' in result) {
      withheld.push(row.slug);
      logger.error(
        'loadGlobalSlotDefinitions: stored slot definition has an unrecognised classifier — withheld from the framework sync',
        { slug: row.slug, field: result.unknownField, value: result.value }
      );
      continue;
    }
    definitions.push(result.input);
  }

  // Which of the sync's two omission behaviours we have just triggered — see
  // the file header, which names the test case for each rather than restating
  // it. Some survived: "a slug the provider drops is deactivated", so each
  // withheld slot stops being asked. None survived: "an empty provider on a
  // fluke boot leaves every global row active", so nothing is retired and the
  // stale projections stay live.
  //
  // Opposite outcomes, and only the second fails OPEN — so it is the one that
  // gets its own line rather than being left to the reader to infer from N
  // per-row errors.
  if (withheld.length > 0 && definitions.length === 0) {
    logger.error(
      'loadGlobalSlotDefinitions: EVERY active definition was withheld — the framework sync treats an empty provider as a fluke, so no projection is deactivated and the stale ones stay live. Correct the classifiers; the taxonomy is not being reconciled.',
      { withheld }
    );
  }

  return definitions;
}

/**
 * Which of the snapshot fields differ between two versions of a definition.
 *
 * **The editor (t-71) is the caller.** It is here rather than there because it
 * is the executable form of the change rule `.context/app/slots.md` states — an
 * edit that changes nothing writes no revision and bumps no version — and
 * because it is the reason {@link SLOT_DEFINITION_FIELDS} has to stay in step
 * with the model, which the seed already depends on for a v1 row's
 * `changedFields`.
 */
export function changedDefinitionFields(
  before: StoredSlotDefinitionFields,
  after: StoredSlotDefinitionFields
): SlotDefinitionField[] {
  return SLOT_DEFINITION_FIELDS.filter((field) => before[field] !== after[field]);
}
