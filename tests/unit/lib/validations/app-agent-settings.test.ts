/**
 * What the agent-settings routes refuse (§08 t-53): a non-positive deadline, a
 * first-words deadline not shorter than the turn's, and a negative ceiling.
 *
 * @see lib/validations/app-agent-settings.ts
 */

import { describe, it, expect } from 'vitest';

import {
  agentSettingsUpdateSchema,
  userBudgetQuerySchema,
  userBudgetUpdateSchema,
} from '@/lib/validations/app-agent-settings';

const VALID = { firstWordsDeadlineMs: 8000, turnDeadlineMs: 60000, defaultMonthlyCeilingUsd: 5 };

describe('agentSettingsUpdateSchema', () => {
  it('accepts the ruled defaults', () => {
    expect(agentSettingsUpdateSchema.parse(VALID)).toEqual(VALID);
  });

  it.each([
    ['a zero first-words deadline', { firstWordsDeadlineMs: 0 }],
    ['a negative first-words deadline', { firstWordsDeadlineMs: -1 }],
    ['a zero turn deadline', { turnDeadlineMs: 0 }],
    ['a negative turn deadline', { turnDeadlineMs: -60000 }],
  ])('refuses %s', (_label, patch) => {
    expect(agentSettingsUpdateSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
  });

  it('refuses a first-words deadline equal to the turn deadline', () => {
    const result = agentSettingsUpdateSchema.safeParse({
      ...VALID,
      firstWordsDeadlineMs: 60000,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['firstWordsDeadlineMs']);
  });

  it('refuses a first-words deadline longer than the turn deadline', () => {
    expect(
      agentSettingsUpdateSchema.safeParse({ ...VALID, firstWordsDeadlineMs: 61000 }).success
    ).toBe(false);
  });

  it('refuses a negative default ceiling, and accepts zero', () => {
    expect(
      agentSettingsUpdateSchema.safeParse({ ...VALID, defaultMonthlyCeilingUsd: -0.01 }).success
    ).toBe(false);
    expect(
      agentSettingsUpdateSchema.safeParse({ ...VALID, defaultMonthlyCeilingUsd: 0 }).success
    ).toBe(true);
  });

  it('refuses a partial body — the pair rule needs both deadlines', () => {
    expect(agentSettingsUpdateSchema.safeParse({ turnDeadlineMs: 30000 }).success).toBe(false);
  });

  it('refuses a fractional millisecond', () => {
    expect(
      agentSettingsUpdateSchema.safeParse({ ...VALID, firstWordsDeadlineMs: 7999.5 }).success
    ).toBe(false);
  });
});

describe('userBudgetUpdateSchema', () => {
  it('refuses a negative ceiling, and accepts zero', () => {
    expect(userBudgetUpdateSchema.safeParse({ monthlyCeilingUsd: -1 }).success).toBe(false);
    expect(userBudgetUpdateSchema.safeParse({ monthlyCeilingUsd: 0 }).success).toBe(true);
  });

  it('refuses a string amount', () => {
    expect(userBudgetUpdateSchema.safeParse({ monthlyCeilingUsd: '5' }).success).toBe(false);
  });
});

describe('userBudgetQuerySchema', () => {
  it('defaults to every person, first page', () => {
    expect(userBudgetQuerySchema.parse({})).toEqual({
      overriddenOnly: false,
      page: 1,
      limit: 25,
    });
  });
});
