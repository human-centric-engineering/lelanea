/**
 * Agent settings validation — the deadlines, the default ceiling, and one
 * person's override.
 *
 * The settings write is a full replacement: all three values, every time. That
 * is what lets the one cross-field rule — the first-words deadline must be
 * shorter than the whole turn's — be checked here, at the boundary, rather than
 * against whatever happens to be stored when only one of the pair arrives.
 *
 * Deadlines are whole milliseconds on the wire and in the row; the admin page
 * shows seconds and converts. Ceilings are USD.
 *
 * @see lib/app/agent/settings.ts — what these schemas feed
 */

import { z } from 'zod';

/** How many people the budget list shows per page. */
export const USER_BUDGET_PAGE_SIZE = 25;

/**
 * Longest deadline anyone may set: ten minutes.
 *
 * Not a product rule — the ruling is 8 s and 60 s — but a bound on a typo. A
 * turn deadline of 600,000,000 ms is a turn with no deadline, and the platform's
 * own request timeout would end it long before this would.
 */
export const MAX_DEADLINE_MS = 600_000;

/**
 * Highest monthly ceiling anyone may set, per person or by default.
 *
 * Same reasoning: a bound on a slipped key, not a policy. Pre-revenue, a person
 * spending this much in a month is something to notice rather than to allow.
 */
export const MAX_MONTHLY_CEILING_USD = 10_000;

const deadlineMsSchema = z
  .number()
  .int('A deadline is a whole number of milliseconds.')
  .positive('A deadline must be longer than zero.')
  .max(MAX_DEADLINE_MS, `A deadline cannot be longer than ${MAX_DEADLINE_MS / 1000} seconds.`);

/**
 * A monthly ceiling in USD. Zero is allowed — it is a real answer ("may spend
 * nothing") — and a negative is not.
 */
const ceilingUsdSchema = z
  .number()
  .finite()
  .nonnegative('A ceiling cannot be negative.')
  .max(MAX_MONTHLY_CEILING_USD, `A ceiling cannot be more than $${MAX_MONTHLY_CEILING_USD}.`);

export const agentSettingsUpdateSchema = z
  .object({
    firstWordsDeadlineMs: deadlineMsSchema,
    turnDeadlineMs: deadlineMsSchema,
    defaultMonthlyCeilingUsd: ceilingUsdSchema,
  })
  .refine((body) => body.firstWordsDeadlineMs < body.turnDeadlineMs, {
    message:
      'The first-words deadline must be shorter than the whole turn’s — otherwise the turn ends before the app ever says it is slow.',
    path: ['firstWordsDeadlineMs'],
  });

export type AgentSettingsUpdate = z.infer<typeof agentSettingsUpdateSchema>;

export const userBudgetUpdateSchema = z.object({
  monthlyCeilingUsd: ceilingUsdSchema,
});

export type UserBudgetUpdate = z.infer<typeof userBudgetUpdateSchema>;

export const userBudgetQuerySchema = z.object({
  /** Free-text search over name and email. Never logged — see the route. */
  q: z.string().trim().min(1).max(200).optional(),
  /** Only people who carry an override. */
  overriddenOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(USER_BUDGET_PAGE_SIZE),
});

export type UserBudgetQuery = z.infer<typeof userBudgetQuerySchema>;
