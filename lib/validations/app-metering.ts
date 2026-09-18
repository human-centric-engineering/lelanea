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

function windowIsSane(query: { from?: Date; to?: Date }, ctx: z.RefinementCtx): void {
  const { from, to } = query;
  if (from && to && from.getTime() >= to.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: '`to` must be after `from`' });
    return;
  }
  const start = from?.getTime() ?? Date.now();
  const end = to?.getTime() ?? Date.now();
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

/** A turn id as a client sends one — the same bound the turn hook accepts. */
export const turnIdParamSchema = z.string().trim().min(1).max(128);
