/**
 * Guiding and teaching: the two registers, and which one a turn is steered to
 * (f-registers §12, t-125; product description §3.14).
 *
 * **Guiding** holds space: gentle, empathetic, unhurried. **Teaching** pushes
 * past the comfortable answer: direct, probing, challenging. The moment sets
 * the register and the person sets the leanings (§3.4).
 *
 * ## Who decides (owner rulings, 2 Oct 2026, journalled on f-registers)
 *
 * - **The module sets the default.** Each module carries a `register` in its
 *   own config (Daybreak's `configSchema`), editable in Framework → Modules →
 *   the module. Values starts at `teaching`, because §3.14's examples of
 *   teaching ("Do these values restrict you?") are Values' own content; every
 *   other module starts at `guiding`. A default in code is only where a module
 *   starts: the stored config is what is read.
 * - **The AI moves off it within a turn** when the moment calls for it. That
 *   is the overlays' authored instruction, not this module's: each register's
 *   overlay says when to set it down for the other.
 * - **Something hard always comes first.** A crisis on the person's
 *   conversation in the last {@link SAFETY_HOLD_HOURS} hours holds the register
 *   at `guiding`, whatever the module says. This is the one deterministic
 *   bound: teaching is never steered onto someone who has just been shown a
 *   crisis line.
 *
 * Not a facilitation policy kind: Daybreak's kinds are a fixed vocabulary
 * behind a migration CHECK, so a `register` kind would mean editing Daybreak.
 * Module config is the element that fits, and it is where Daybreak's own
 * worked example puts `tone: gentle | direct`.
 *
 * **Pure: no database, no server import.** `lib/app/modules/definitions.ts`
 * imports the config field from here, and client components reach that file.
 * The reads are `register-store.ts`, which is server-only.
 *
 * @see lib/app/voice/register-store.ts — the reads
 * @see .context/app/voice.md — "Guiding and teaching"
 */

import { z } from 'zod';

/** The two registers, in the order an admin is offered them. */
export const REGISTERS = ['guiding', 'teaching'] as const;
export type Register = (typeof REGISTERS)[number];

/** Where nothing else is known: the safe direction. */
export const DEFAULT_REGISTER: Register = 'guiding';

/** Why a turn was steered to its register. */
export const REGISTER_SOURCES = ['module', 'safety'] as const;
export type RegisterSource = (typeof REGISTER_SOURCES)[number];

/**
 * How long a crisis holds the register at guiding. A day: long enough to
 * cover the rest of the sitting it happened in, short enough that one hard
 * evening does not soften every conversation after it.
 */
export const SAFETY_HOLD_HOURS = 24;

/**
 * The modules that start somewhere other than {@link DEFAULT_REGISTER}, by
 * slug. Where a module starts, not what it is: an admin changes it in the
 * module's area, and the stored config wins.
 */
const MODULE_DEFAULTS: ReadonlyMap<string, Register> = new Map([['values', 'teaching']]);

/** The register a module starts at, before anyone has changed it. */
export function moduleDefaultRegister(moduleSlug: string): Register {
  return MODULE_DEFAULTS.get(moduleSlug) ?? DEFAULT_REGISTER;
}

export const registerSchema = z.enum(REGISTERS);

/**
 * The `register` field of a module's config, defaulting to where that module
 * starts. Its description is what the admin reads beside the field.
 */
export function registerConfigField(
  moduleSlug: string
): z.ZodDefault<z.ZodEnum<{ guiding: 'guiding'; teaching: 'teaching' }>> {
  return registerSchema
    .default(moduleDefaultRegister(moduleSlug))
    .describe(
      'Where the AI starts in this module. Guiding holds space: gentle, unhurried. Teaching pushes past the comfortable answer: direct and probing. The AI still moves to guiding when something painful comes up.'
    );
}

/** What selection reads. */
export interface RegisterInputs {
  /** The person's current module's register, or null when there is no module. */
  moduleRegister: Register | null;
  /** A crisis on their conversation within {@link SAFETY_HOLD_HOURS}. */
  recentCrisis: boolean;
}

/** The register a turn is steered to, and why. */
export interface RegisterChoice {
  register: Register;
  source: RegisterSource;
}

/**
 * The register for a turn. Pure, so the precedence is a table test:
 * a recent crisis beats the module; the module beats the default.
 */
export function selectRegister(inputs: RegisterInputs): RegisterChoice {
  if (inputs.recentCrisis) return { register: 'guiding', source: 'safety' };
  return { register: inputs.moduleRegister ?? DEFAULT_REGISTER, source: 'module' };
}

/** A stored register value, or null when it is not one. Lenient by design: a row is read, not trusted. */
export function parseRegister(value: unknown): Register | null {
  const parsed = registerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A stored register source, or null when it is not one. */
export function parseRegisterSource(value: unknown): RegisterSource | null {
  const parsed = z.enum(REGISTER_SOURCES).safeParse(value);
  return parsed.success ? parsed.data : null;
}
