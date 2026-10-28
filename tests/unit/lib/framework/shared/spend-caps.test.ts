/**
 * Spend-cap refusals for framework LLM calls (Sunrise 0.15.0).
 *
 * Recognises a refusal by code through the `cause` chain, keeps the code-carrying error's
 * operator message, answers a route with the cap's code at 402 through core's real
 * `handleAPIError`, and — through core's real `ExecutorError` — fails a workflow step under the
 * cap's code, never retried.
 *
 * @see lib/framework/shared/spend-caps.ts
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  asSpendCapRefusal,
  isSpendCapCode,
  rethrowSpendCapRefusal,
  spendCapCodeInJudgeText,
  spendCapCodeOf,
  SpendCapRefusedError,
} from '@/lib/framework/shared/spend-caps';
import { SpendCapExceededError } from '@/lib/orchestration/llm/spend-caps';
import { SPEND_CAP_CODES } from '@/lib/orchestration/llm/provider';
import { getUserFacingError } from '@/lib/orchestration/chat/error-messages';
import { handleAPIError } from '@/lib/api/errors';
import { ExecutorError } from '@/lib/orchestration/engine/errors';

describe('recognising a refusal', () => {
  it('knows exactly core’s three cap codes', () => {
    for (const code of Object.values(SPEND_CAP_CODES)) expect(isSpendCapCode(code)).toBe(true);
    expect(isSpendCapCode('budget_exceeded_per_turn')).toBe(false);
    expect(isSpendCapCode(undefined)).toBe(false);
  });

  it('reads the code off core’s error, or anything that wraps it', () => {
    const refusal = new SpendCapExceededError('org', 'openai');
    expect(spendCapCodeOf(refusal)).toBe('org_budget_exceeded');
    const wrapped = new Error('outer', { cause: new Error('middle', { cause: refusal }) });
    expect(spendCapCodeOf(wrapped)).toBe('org_budget_exceeded');
  });

  it('answers null for anything else, and for a cyclic chain', () => {
    expect(spendCapCodeOf(new Error('timeout'))).toBeNull();
    expect(spendCapCodeOf('org_budget_exceeded')).toBeNull();
    const cyclic = new Error('a');
    cyclic.cause = cyclic;
    expect(spendCapCodeOf(cyclic)).toBeNull();
  });

  it('finds a cap whose words open a judge’s failure text, in either of scoreResponse’s shapes', () => {
    const { message, action } = getUserFacingError('budget_exceeded');
    const words = `${message} ${action}`;
    expect(spendCapCodeInJudgeText(`… — faithfulness: ${words}; relevance: x`)).toBe(
      'budget_exceeded'
    );
    expect(spendCapCodeInJudgeText(`judge unavailable: ${words}`)).toBe('budget_exceeded');
  });

  it('ignores the same words anywhere else in the text', () => {
    const { message } = getUserFacingError('org_budget_exceeded');
    expect(spendCapCodeInJudgeText(`faithfulness: 400 bad request: "${message}"`)).toBeNull();
    expect(spendCapCodeInJudgeText(message)).toBeNull();
    expect(spendCapCodeInJudgeText('faithfulness: no active provider')).toBeNull();
  });
});

describe('SpendCapRefusedError', () => {
  it('keeps the operator message of the error carrying the code, not a wrapper’s', () => {
    const refusal = new SpendCapExceededError('global', 'openai');
    const converted = asSpendCapRefusal(new Error('judge failed', { cause: refusal }));
    expect(converted).toBeInstanceOf(SpendCapRefusedError);
    expect(converted?.message).toBe(refusal.message);
    expect(converted?.code).toBe('global_budget_exceeded');
  });

  it('carries what the refused run spent, defaulting to nothing', () => {
    expect(new SpendCapRefusedError('budget_exceeded')).toMatchObject({
      costUsd: 0,
      tokensUsed: 0,
    });
    expect(
      new SpendCapRefusedError('budget_exceeded', undefined, { costUsd: 0.5, tokensUsed: 9 })
    ).toMatchObject({ costUsd: 0.5, tokensUsed: 9 });
  });

  it('falls back to the registry’s words when it has only the code', () => {
    const { message, action } = getUserFacingError('org_budget_exceeded');
    expect(new SpendCapRefusedError('org_budget_exceeded').message).toBe(`${message} ${action}`);
  });

  it('passes a non-cap error through unchanged', () => {
    const other = new Error('timeout');
    expect(asSpendCapRefusal(other)).toBeNull();
    expect(() => rethrowSpendCapRefusal(other)).toThrow(other);
    expect(() => rethrowSpendCapRefusal(new SpendCapExceededError('agent', 'openai'))).toThrow(
      SpendCapRefusedError
    );
  });

  it('answers a route with the cap’s code at 402, not a 500', async () => {
    const res = handleAPIError(new SpendCapRefusedError('org_budget_exceeded'));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body).toMatchObject({ success: false, error: { code: 'org_budget_exceeded' } });
  });

  it('fails a workflow step under the cap’s code, never retried', () => {
    const failure = new ExecutorError(
      'step-1',
      'framework_eval_sweep_spend_cap',
      'stopped',
      new SpendCapRefusedError('global_budget_exceeded')
    );
    expect(failure.code).toBe('global_budget_exceeded');
    expect(failure.retriable).toBe(false);
  });
});
