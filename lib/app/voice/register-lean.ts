/**
 * A person's lean: "be gentle with me today" (f-registers t-126).
 *
 * Owner ruling, 2 Oct 2026 (journalled on f-registers): a person can ask for
 * a register, as a bounded lean. It moves the default for now. It never forces
 * teaching on someone who is struggling: a crisis beats it
 * (`selectRegister`), and the overlays tell the AI to set teaching down when
 * pain shows, whatever was asked.
 *
 * ## Where it lives: the module's own node ledger
 *
 * On the person's current module node, under one flat key of the node's
 * `progress` payload, written through Daybreak's `recordNodeProgress` — the
 * seam the framework set aside for module-owned per-person state. It is
 * exported and erased with the journey, with nothing of ours to add. Moving to
 * another module leaves it behind, which is what "for now" means here.
 *
 * Not a data slot, which the plan named first and this rejected: a global
 * slot is a row of the admin-edited taxonomy, so it would be renamable and
 * deletable by an admin, listed in the vocabulary the AI captures into (and
 * so writable through `fill_slot` unless reserved), and kept as a permanent
 * fact about the person. A lean is none of those. It is a request about how to
 * be met for a while.
 *
 * ## For a while: {@link LEAN_HOLD_HOURS}
 *
 * The facilitator conversation does not end; it is resumed. So "for this
 * conversation" is read as a sitting: a lean holds for twelve hours after it
 * was asked, then lapses on its own. A person who wants it longer asks again.
 * "Never mind" clears it at once (a JSON `null`: `jsonb ||` cannot delete, so
 * the ledger keeps a tombstone, read as no lean).
 *
 * @see lib/app/voice/register.ts — the precedence
 * @see lib/app/voice/register-capability.ts — the tool that writes it
 */

import { z } from 'zod';

import { recordNodeProgress } from '@/lib/framework/facilitation/journey/progress';
import { JOURNEY_MAP_SLUG } from '@/lib/app/journey/map-definition';
import { isRecord } from '@/lib/utils';
import { registerSchema, type Register } from '@/lib/app/voice/register';

/** The key on the node's `progress` payload. Flat, as the seam's merge is shallow. */
export const LEAN_PROGRESS_KEY = 'registerLean';

/** How long a lean holds after it was asked. */
export const LEAN_HOLD_HOURS = 12;

const storedLeanSchema = z.object({ register: registerSchema, askedAt: z.iso.datetime() });

/** A lean, as stored. A type alias, so it is a JSON object to the seam. */
export type RegisterLean = {
  register: Register;
  /** ISO. */
  askedAt: string;
};

/**
 * The lean still in force on a node's `progress`, or null: none asked, cleared,
 * lapsed, or not a shape this can read. Pure.
 */
export function leanInForce(progress: unknown, now: Date): Register | null {
  if (!isRecord(progress)) return null;
  const parsed = storedLeanSchema.safeParse(progress[LEAN_PROGRESS_KEY]);
  if (!parsed.success) return null;
  const asked = new Date(parsed.data.askedAt).getTime();
  const age = now.getTime() - asked;
  // A lean asked in the future is a clock the record cannot trust: none.
  if (age < 0 || age > LEAN_HOLD_HOURS * 60 * 60 * 1000) return null;
  return parsed.data.register;
}

/** When a lean asked at `askedAt` lapses. */
export function leanLapsesAt(askedAt: Date): Date {
  return new Date(askedAt.getTime() + LEAN_HOLD_HOURS * 60 * 60 * 1000);
}

/** What writing a lean did. */
export type RecordLeanOutcome = 'recorded' | 'no_module';

/**
 * Write (or, with `null`, clear) the person's lean on `moduleSlug`'s node.
 * The person's own ledger, written as them. `no_module` when the node was
 * never entered or there is no journey: the seam refuses to invent the row.
 * Throws on a failed write, for the caller to answer.
 */
export async function recordRegisterLean(
  userId: string,
  moduleSlug: string,
  register: Register | null,
  now: Date = new Date()
): Promise<RecordLeanOutcome> {
  const lean: RegisterLean | null =
    register === null ? null : { register, askedAt: now.toISOString() };
  const result = await recordNodeProgress(
    { userId },
    { userId, graphSlug: JOURNEY_MAP_SLUG },
    moduleSlug,
    { [LEAN_PROGRESS_KEY]: lean }
  );
  return result.ok ? 'recorded' : 'no_module';
}
