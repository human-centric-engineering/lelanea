/**
 * Query shapes for the meter's read API (§08 t-56).
 *
 * The window is a half-open UTC range `[from, to)`. Omitted, it is the current
 * UTC month to now — the question f-budget asks first. Bounded to a year so an
 * unfiltered admin read cannot ask Postgres to scan the whole cost log.
 *
 * @see lib/app/agent/metering.ts
 */

import { z } from 'zod';

import { cuidSchema } from '@/lib/validations/common';

/** The longest window a breakdown may cover. */
export const MAX_METER_WINDOW_DAYS = 366;

/** The most groups a breakdown returns; the rest are reported as truncated. */
export const MAX_METER_GROUPS = 500;
export const DEFAULT_METER_GROUPS = 100;

/** What a member may break their own spend down by. */
export const MEMBER_METER_DIMENSIONS = ['conversation', 'seat', 'model', 'day'] as const;

/** What an admin may break everyone's spend down by. */
export const ADMIN_METER_DIMENSIONS = ['user', ...MEMBER_METER_DIMENSIONS] as const;

export type MeterDimension = (typeof ADMIN_METER_DIMENSIONS)[number];

const DAY_MS = 86_400_000;

const windowFields = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(MAX_METER_GROUPS).default(DEFAULT_METER_GROUPS),
};

/**
 * Judged on the window the reader will actually use — the missing end filled
 * the way `resolveWindow()` fills it (`to` defaults to now, `from` to the start
 * of `to`'s UTC month) — so a lone future `from`, or a lone `to` on the first
 * instant of a month, is refused rather than answered with an empty window.
 */
function windowIsSane(query: { from?: Date; to?: Date }, ctx: z.RefinementCtx): void {
  const end = query.to?.getTime() ?? Date.now();
  const endDate = new Date(end);
  const start =
    query.from?.getTime() ?? Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1);
  if (start >= end) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'The window must end after it starts' });
    return;
  }
  if (end - start > MAX_METER_WINDOW_DAYS * DAY_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: `A window may cover at most ${MAX_METER_WINDOW_DAYS} days`,
    });
  }
}

export const memberBreakdownQuerySchema = z
  .object({ by: z.enum(MEMBER_METER_DIMENSIONS), ...windowFields })
  .superRefine(windowIsSane);

export type MemberBreakdownQuery = z.infer<typeof memberBreakdownQuerySchema>;

export const adminBreakdownQuerySchema = z
  .object({
    by: z.enum(ADMIN_METER_DIMENSIONS),
    /** Narrow to one person. Omitted: everyone, platform cost included. */
    userId: cuidSchema.optional(),
    ...windowFields,
  })
  .superRefine(windowIsSane);

export type AdminBreakdownQuery = z.infer<typeof adminBreakdownQuerySchema>;

/** The most turns one conversation's drill-down lists; the cheapest are cut (t-97). */
export const MAX_CONVERSATION_TURNS = 500;
export const DEFAULT_CONVERSATION_TURNS = 200;

/** One conversation's turns, over a window — the admin cost view's drill-down (t-97). */
export const conversationTurnsQuerySchema = z
  .object({
    from: windowFields.from,
    to: windowFields.to,
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_CONVERSATION_TURNS)
      .default(DEFAULT_CONVERSATION_TURNS),
  })
  .superRefine(windowIsSane);

/** A turn id as a client sends one — the same bound the turn hook accepts. */
export const turnIdParamSchema = z.string().trim().min(1).max(128);
