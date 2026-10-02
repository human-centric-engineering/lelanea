/**
 * The reads behind a turn's register (f-registers t-125): where the person is
 * on their journey, what that module's config says, and whether something
 * hard happened recently. The rules are `register.ts`; this is the database
 * half, and it is server-only.
 *
 * ## Decided once, at the claim
 *
 * A turn's register is decided when the turn seam claims it, before the model
 * is called (`lib/app/agent/turns.ts`), and written on the turn row. The
 * context contributor then reads it back from that row
 * ({@link registerForPrompt}) rather than deciding again, so what the prompt
 * was steered to and what the account says are one value, never two reads
 * that happened to agree.
 *
 * Deciding at the claim is also what lets a soft crisis count on the turn it
 * happens in. The seam knows it has just shown the resource; the safety record
 * is written only after the turn runs (a refused retry must not write a second
 * one), so a read of the records would miss it.
 *
 * The context block is cached per person for up to a minute (`buildContext`).
 * The seam drops it when a turn's register differs from the last turn's, so a
 * change reaches the very next prompt.
 *
 * ## Failing towards guiding
 *
 * Every read is guarded and logged. A module whose config cannot be read is
 * read as its starting register, and a crisis check that fails is read as a
 * crisis: when this cannot tell, it steers gently, because teaching someone
 * who is struggling costs more than guiding someone who is not.
 *
 * @see lib/app/voice/register.ts — the rules
 */

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { getModuleConfigForm } from '@/lib/framework/modules/config';
import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import { readJourneyNodeStates } from '@/lib/app/onboarding/first-run-store';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { isRecord } from '@/lib/utils';
import {
  moduleDefaultRegister,
  parseRegister,
  SAFETY_HOLD_HOURS,
  selectRegister,
  type Register,
  type RegisterChoice,
} from '@/lib/app/voice/register';

/**
 * The module the person is in now: the active node they were most recently in.
 * A node's key is its module's slug on our map (`map-definition.ts`). Null with
 * no journey, or no node active.
 */
export async function readCurrentModuleSlug(userId: string): Promise<string | null> {
  const active = (await readJourneyNodeStates(userId)).filter(
    (state) => state.status === NODE_STATE_STATUS.active
  );
  const when = (state: (typeof active)[number]) =>
    (state.lastActiveAt ?? state.firstEnteredAt)?.getTime() ?? 0;
  active.sort((a, b) => when(b) - when(a));
  return active[0]?.nodeKey ?? null;
}

/** The module's register as its config stores it, or where it starts. */
async function readModuleRegister(moduleSlug: string): Promise<Register> {
  try {
    const form = await getModuleConfigForm(moduleSlug);
    const stored = isRecord(form.values) ? parseRegister(form.values.register) : null;
    return stored ?? moduleDefaultRegister(moduleSlug);
  } catch (err) {
    logger.error('resolveRegister: module config could not be read; using its starting register', {
      moduleSlug,
      error: err instanceof Error ? err.message : String(err),
    });
    return moduleDefaultRegister(moduleSlug);
  }
}

/** Whether a crisis was recorded for the person within the hold. A failed read is a yes. */
async function hadRecentCrisis(userId: string, now: Date): Promise<boolean> {
  try {
    const since = new Date(now.getTime() - SAFETY_HOLD_HOURS * 60 * 60 * 1000);
    const crisis = await prisma.appSafetyEvent.findFirst({
      where: { userId, kind: 'crisis', createdAt: { gte: since } },
      select: { id: true },
    });
    return crisis !== null;
  } catch (err) {
    logger.error('resolveRegister: the crisis check failed; steering to guiding', {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/** A register, why, and the module it came from (null when there was none). */
export interface ResolvedRegister extends RegisterChoice {
  moduleSlug: string | null;
}

/** What the claim knows that the rows may not yet say. */
export interface ResolveRegisterOptions {
  /** The turn is showing a crisis resource now (a soft crisis, recorded after it runs). */
  crisisNow?: boolean;
  now?: Date;
}

/** Whether `seat` has a register at all. */
export function hasRegister(seat: string): boolean {
  return seat === CONVERSATION_SEAT;
}

/**
 * The register for a turn on `seat`, or null for a seat that has none. Never
 * throws.
 *
 * Only the facilitator seat has one. The onboarding seat is one moment, the
 * first meeting, and keeps that overlay; a register there would be a second
 * answer to the question the seat already answers.
 */
export async function resolveRegister(
  userId: string,
  seat: string,
  options: ResolveRegisterOptions = {}
): Promise<ResolvedRegister | null> {
  if (!hasRegister(seat) || userId === '') return null;
  const now = options.now ?? new Date();

  let moduleSlug: string | null = null;
  try {
    moduleSlug = await readCurrentModuleSlug(userId);
  } catch (err) {
    logger.error('resolveRegister: the journey could not be read; using the default register', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const [moduleRegister, recentCrisis] = await Promise.all([
    moduleSlug === null ? Promise.resolve(null) : readModuleRegister(moduleSlug),
    options.crisisNow === true ? Promise.resolve(true) : hadRecentCrisis(userId, now),
  ]);
  return { ...selectRegister({ moduleRegister, recentCrisis }), moduleSlug };
}

/**
 * The register the prompt is given: the one the turn now running on the seat
 * was claimed with. Every turn a person takes on a facilitation seat passes
 * the turn seam, which claims it before the model is called, so that row is
 * this turn's. With no such row (a turn that reached the agent some other
 * way, or a claim written before registers existed) it is decided here, the
 * same way. Never throws; null for a seat with no register.
 */
export async function registerForPrompt(userId: string, seat: string): Promise<Register | null> {
  if (!hasRegister(seat) || userId === '') return null;
  try {
    const running = await prisma.appTurn.findFirst({
      where: { userId, seat, status: 'running' },
      orderBy: { startedAt: 'desc' },
      select: { register: true },
    });
    const claimed = parseRegister(running?.register);
    if (claimed !== null) return claimed;
  } catch (err) {
    logger.error('registerForPrompt: the turn row could not be read; deciding again', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return (await resolveRegister(userId, seat))?.register ?? null;
}
