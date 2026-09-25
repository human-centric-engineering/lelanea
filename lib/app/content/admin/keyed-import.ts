/**
 * Planning a file import against stored rows, by key (f-content-seeds t-91).
 *
 * Generalised from the slot taxonomy's planner (`planTaxonomyUpload`, f-slots
 * t-71), which is now one of its callers. The mechanism is the slot planner's,
 * unchanged: a **pure** plan, which the preview route returns and the apply
 * route re-computes inside its transaction against the rows as they stand, so
 * "the preview matches what apply does" is a property of one function rather
 * than of two kept in step.
 *
 * ## What transferred, and what each caller still decides (`fp5`)
 *
 * The slot planner's justification for each rule was re-derived for content
 * rather than copied:
 *
 * - **Idempotent on unchanged fields.** Every write is driven by the caller's
 *   `diff`, so a second apply of the same file finds nothing different. That
 *   holds for any keyed collection with a revision chain: a revision records a
 *   change, and a file that changes nothing must not record one.
 * - **A retired row is never revived by a file.** The slot format cannot say
 *   "retired"; neither can the resources file. A retired key appearing in a
 *   file is indistinguishable from one that was never retired, so it is
 *   reported (`skippedRetired`) and left alone. Restoring is its own act.
 * - **What happens to a stored key the file does not mention is the caller's
 *   call**, because the reason differs. The slot taxonomy is a set an admin may
 *   upload part of (`merge`), so absence means "leave it". A content file keeps
 *   what it omits too, unless the admin asks for removal (t-100); then absence
 *   means "remove it", and the caller refuses the plan where a removal is
 *   guarded.
 *
 * What the caller supplies: how an incoming entry becomes a row's fields on a
 * create and on an update, and what a removal leaves (`null` for a delete, the
 * retired fields for a tombstone).
 */

/** One key's planned change. `before` is null on a create; `after` is null on a delete. */
export interface KeyedChange<F> {
  key: string;
  kind: 'create' | 'update' | 'remove';
  /** What the revision will record. Every field on a create. */
  changedFields: string[];
  before: F | null;
  after: F | null;
  /** The revision the change produces: 1 on a create, the stored one plus one otherwise. */
  revision: number;
}

export interface KeyedPlan<F> {
  creates: KeyedChange<F>[];
  updates: KeyedChange<F>[];
  removals: KeyedChange<F>[];
  /** In the file, stored, and identical. Nothing to do. */
  unchanged: string[];
  /** In the file, but retired here. Left exactly as it is. */
  skippedRetired: string[];
  /** Stored and live, and the file does not mention it. */
  absentFromFile: string[];
}

export interface StoredKeyed<F> {
  key: string;
  fields: F;
  revision: number;
  /** A tombstone. Never revived by a file, never removed again. */
  retired?: boolean;
}

export interface KeyedPlanInput<I, F> {
  /** The file's entries, in file order. Keys are unique (the file schema says so). */
  incoming: readonly { key: string; value: I }[];
  /** The stored rows, in the order the plan should report absences in. */
  stored: readonly StoredKeyed<F>[];
  /** Which fields differ, in a stable order. Empty means unchanged. */
  diff: (before: F, after: F) => string[];
  /** Every field a revision records, which is what a create reports. */
  allFields: readonly string[];
  toCreate: (value: I) => F;
  toUpdate: (before: F, value: I) => F;
  /**
   * What happens to a stored, live key the file omits. `keep` leaves it and
   * only reports it. Otherwise the function says what the row becomes: `null`
   * deletes it, a value is a tombstone.
   */
  onAbsent: 'keep' | ((before: F) => F | null);
}

/** Every change a plan would make, and nothing it would leave alone. */
export function keyedWrites<F>(plan: KeyedPlan<F>): KeyedChange<F>[] {
  return [...plan.creates, ...plan.updates, ...plan.removals];
}

/** Whether a plan would write anything at all. */
export function keyedPlanWritesNothing<F>(plan: KeyedPlan<F>): boolean {
  return keyedWrites(plan).length === 0;
}

/** Plan a file against stored rows. Pure. */
export function planKeyedImport<I, F>(input: KeyedPlanInput<I, F>): KeyedPlan<F> {
  const byKey = new Map(input.stored.map((row) => [row.key, row]));
  const inFile = new Set(input.incoming.map((entry) => entry.key));

  const plan: KeyedPlan<F> = {
    creates: [],
    updates: [],
    removals: [],
    unchanged: [],
    skippedRetired: [],
    absentFromFile: [],
  };

  for (const { key, value } of input.incoming) {
    const current = byKey.get(key);

    if (!current) {
      plan.creates.push({
        key,
        kind: 'create',
        changedFields: [...input.allFields],
        before: null,
        after: input.toCreate(value),
        revision: 1,
      });
      continue;
    }

    if (current.retired) {
      plan.skippedRetired.push(key);
      continue;
    }

    const after = input.toUpdate(current.fields, value);
    const changedFields = input.diff(current.fields, after);
    if (changedFields.length === 0) {
      plan.unchanged.push(key);
      continue;
    }
    plan.updates.push({
      key,
      kind: 'update',
      changedFields,
      before: current.fields,
      after,
      revision: current.revision + 1,
    });
  }

  for (const row of input.stored) {
    if (inFile.has(row.key) || row.retired) continue;
    plan.absentFromFile.push(row.key);
    if (input.onAbsent === 'keep') continue;

    const after = input.onAbsent(row.fields);
    plan.removals.push({
      key: row.key,
      kind: 'remove',
      changedFields: after === null ? [...input.allFields] : input.diff(row.fields, after),
      before: row.fields,
      after,
      revision: row.revision + 1,
    });
  }

  return plan;
}

/**
 * Which of `fields` differ between two values, compared as JSON.
 *
 * Structural rather than by reference, because the stored side comes out of a
 * JSON column and the incoming side out of a parsed file: two equal phase
 * lists are never the same object. Key order is normalised so that a file
 * written by hand with its keys in another order is not a change.
 */
export function changedFieldsOf<F extends object>(
  before: F,
  after: F,
  fields: readonly (keyof F & string)[]
): (keyof F & string)[] {
  return fields.filter((field) => stableJson(before[field]) !== stableJson(after[field]));
}

/** JSON with object keys sorted, so equal values serialise equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) =>
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)))
      : raw
  );
}
