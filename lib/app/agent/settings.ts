/**
 * The agent's deadlines and spending ceilings — where they are stored, and how
 * every later reader gets them.
 *
 * Owner ruling at claim (§08 t-53): no first words within 8 seconds and the app
 * speaks up; a turn ends at 60 seconds; $5 per person per month to start — all
 * of it changeable by an admin, ceilings per person. Sunrise has per-agent,
 * global and per-turn caps and no per-user concept, so the store is ours.
 *
 * ## This module enforces nothing
 *
 * It stores and resolves. §08 t-55 applies the two deadlines to a turn,
 * f-safety decides what happens when someone reaches their ceiling, and f-budget
 * shows them where they stand. Until those land, what proves the write is the
 * admin page reading it back and this module's tests (`HB9`).
 *
 * ## Read per request, never at module scope
 *
 * Every resolver goes to the database on every call (`B9`). A value captured
 * when the module loaded would make a change in the admin take effect at the
 * next deploy — the exact shape the ruling rejected — and on a serverless host
 * would take effect in some instances and not others. Two indexed primary-key
 * reads per turn is the price, and it is small beside the model call.
 *
 * ## Who writes what (`fp4`)
 *
 * - **The singleton** is created once, by the migration that creates its table,
 *   with the constants below. Nothing automated writes it again; the admin
 *   surface is the only writer from then on. {@link DEFAULT_AGENT_SETTINGS} is
 *   therefore not "the settings" — it is what a resolver answers if the row is
 *   somehow missing, and a test holds the migration's values equal to it.
 * - **An override** exists only while an admin wants one. No row means the
 *   default applies; clearing one deletes it. Zero is a real override, not a
 *   cleared one.
 *
 * @see .context/app/agent.md — the settings and who enforces each
 */

import type { AppUserBudget, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import type { AgentSettingsUpdate, UserBudgetQuery } from '@/lib/validations/app-agent-settings';

/** The singleton's key. */
export const AGENT_SETTINGS_SLUG = 'global';

/**
 * The owner's ruled defaults — what the migration writes into a new database,
 * and what the resolvers answer if the row is missing.
 */
export const DEFAULT_AGENT_SETTINGS = {
  firstWordsDeadlineMs: 8_000,
  turnDeadlineMs: 60_000,
  defaultMonthlyCeilingUsd: 5,
} as const;

export interface AgentSettings {
  firstWordsDeadlineMs: number;
  turnDeadlineMs: number;
  defaultMonthlyCeilingUsd: number;
  /**
   * When an admin (or the migration) last wrote the row. `null` means the row
   * does not exist and these are the code defaults — which the admin page says,
   * rather than presenting a fallback as a stored answer.
   */
  updatedAt: Date | null;
}

/** The singleton as it stands. One primary-key read, every call. */
export async function getAgentSettings(): Promise<AgentSettings> {
  const row = await prisma.appAgentSettings.findUnique({
    where: { slug: AGENT_SETTINGS_SLUG },
    select: {
      firstWordsDeadlineMs: true,
      turnDeadlineMs: true,
      defaultMonthlyCeilingUsd: true,
      updatedAt: true,
    },
  });

  if (!row) {
    // The migration creates it, so a missing row means someone deleted it by
    // hand. Answer with the ruling rather than failing every turn, and say so:
    // saving the admin page puts the row back.
    logger.warn('Agent settings row missing — using the ruled defaults', {
      slug: AGENT_SETTINGS_SLUG,
    });
    return { ...DEFAULT_AGENT_SETTINGS, updatedAt: null };
  }

  return row;
}

/** The two deadlines a turn runs under, in milliseconds. */
export async function getAgentDeadlines(): Promise<{
  firstWordsDeadlineMs: number;
  turnDeadlineMs: number;
}> {
  const { firstWordsDeadlineMs, turnDeadlineMs } = await getAgentSettings();
  return { firstWordsDeadlineMs, turnDeadlineMs };
}

export interface EffectiveCeiling {
  ceilingUsd: number;
  /** Whether this person's own override decided it, or the default did. */
  source: 'override' | 'default';
}

/**
 * What one person may spend this month: their override, else the default.
 *
 * Both reads go out together; the default is read even when an override exists,
 * because one round trip for two primary-key lookups costs no more than one.
 */
export async function getEffectiveMonthlyCeiling(userId: string): Promise<EffectiveCeiling> {
  const [override, settings] = await Promise.all([
    prisma.appUserBudget.findUnique({
      where: { userId },
      select: { monthlyCeilingUsd: true },
    }),
    getAgentSettings(),
  ]);

  if (override) return { ceilingUsd: override.monthlyCeilingUsd, source: 'override' };
  return { ceilingUsd: settings.defaultMonthlyCeilingUsd, source: 'default' };
}

/**
 * Replace the singleton's three values.
 *
 * An upsert rather than an update so that saving the page is also the remedy
 * for a missing row (`HB10`) — the resolver's warning names it. Validation,
 * including "first words shorter than the turn", happened at the boundary.
 */
export async function updateAgentSettings(update: AgentSettingsUpdate): Promise<AgentSettings> {
  return prisma.appAgentSettings.upsert({
    where: { slug: AGENT_SETTINGS_SLUG },
    create: { slug: AGENT_SETTINGS_SLUG, ...update },
    update,
    select: {
      firstWordsDeadlineMs: true,
      turnDeadlineMs: true,
      defaultMonthlyCeilingUsd: true,
      updatedAt: true,
    },
  });
}

/** One row of the admin list: a person, and what they may spend. */
export interface UserBudgetRow {
  userId: string;
  name: string;
  email: string;
  role: string | null;
  /** Their own ceiling, or `null` when the default applies to them. */
  overrideUsd: number | null;
  /** What applies — the override, else the default. Derived here, not in JSX. */
  effectiveCeilingUsd: number;
}

/**
 * Every person, newest account first, with their effective ceiling.
 *
 * The single enriched list the override is set from: one page of users, one
 * query for those users' overrides, one read of the default. No per-row fetch.
 * The overrides are joined in memory because `app_user_budget` has a
 * hand-written FK and no Prisma relation to `User`.
 */
export async function listUserBudgets(query: UserBudgetQuery): Promise<{
  users: UserBudgetRow[];
  total: number;
}> {
  const where: Prisma.UserWhereInput = {};

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  if (query.overriddenOnly) {
    // The override table is small by construction — a row exists only where an
    // admin chose one — so reading its keys first is cheaper than anything that
    // would page through users looking for them.
    const overridden = await prisma.appUserBudget.findMany({ select: { userId: true } });
    where.id = { in: overridden.map((row) => row.userId) };
  }

  const [users, total, settings] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.user.count({ where }),
    getAgentSettings(),
  ]);

  const overrides = await prisma.appUserBudget.findMany({
    where: { userId: { in: users.map((user) => user.id) } },
    select: { userId: true, monthlyCeilingUsd: true },
  });
  const overrideByUser = new Map(overrides.map((row) => [row.userId, row.monthlyCeilingUsd]));

  return {
    users: users.map((user) =>
      toRow(user, overrideByUser.get(user.id) ?? null, settings.defaultMonthlyCeilingUsd)
    ),
    total,
  };
}

function toRow(
  user: { id: string; name: string; email: string; role: string | null },
  overrideUsd: number | null,
  defaultUsd: number
): UserBudgetRow {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    overrideUsd,
    effectiveCeilingUsd: overrideUsd ?? defaultUsd,
  };
}

async function findUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
}

/**
 * Give one person their own ceiling. Returns their row as it now stands, or
 * `null` when no such person exists (the caller answers 404).
 */
export async function setUserBudget(
  userId: string,
  monthlyCeilingUsd: number
): Promise<UserBudgetRow | null> {
  const user = await findUser(userId);
  if (!user) return null;

  await prisma.appUserBudget.upsert({
    where: { userId },
    create: { userId, monthlyCeilingUsd },
    update: { monthlyCeilingUsd },
  });

  const settings = await getAgentSettings();
  return toRow(user, monthlyCeilingUsd, settings.defaultMonthlyCeilingUsd);
}

/**
 * Put one person back on the default — a delete, never a zero.
 *
 * Idempotent: clearing an override nobody set still answers with the person's
 * row, because the state asked for ("on the default") is the state they are in.
 * `null` only when no such person exists.
 */
export async function clearUserBudget(
  userId: string
): Promise<{ row: UserBudgetRow; cleared: boolean } | null> {
  const user = await findUser(userId);
  if (!user) return null;

  const { count } = await prisma.appUserBudget.deleteMany({ where: { userId } });

  const settings = await getAgentSettings();
  return { row: toRow(user, null, settings.defaultMonthlyCeilingUsd), cleared: count > 0 };
}

/**
 * The Art. 15 collector's read: this person's override, if they have one.
 *
 * An array, always — empty when the default applies — because a declared
 * section must be present in what the leaf collector returns.
 */
export function findUserBudgetsForSubject(subject: { userId: string }): Promise<AppUserBudget[]> {
  return prisma.appUserBudget.findMany({ where: { userId: subject.userId } });
}
