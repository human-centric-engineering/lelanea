/**
 * Spend-cap refusals for framework-tier LLM calls (Sunrise 0.15.0, §110).
 *
 * Since 0.15.0 every paid call through `getProvider` is held to the agent, org and global
 * monthly caps, so a cap now refuses framework calls too. Core reports a refusal in two shapes:
 *   - a thrown `SpendCapExceededError` (a direct `provider.chat`, or a structured completion),
 *     possibly wrapped by whatever caught it — read through the `cause` chain;
 *   - a bare error code on a drained chat turn (`drainStreamChat` → `driveJudgeAgent`'s
 *     `errorCode`), for calls made through an agent.
 *
 * Either way the framework rethrows it as one {@link SpendCapRefusedError}: an `APIError`, so
 * `handleAPIError` answers a route with the cap's code instead of a 500, and it carries the
 * code on `.code`, so core's `ExecutorError` records a workflow step it stops under that code,
 * never retried. Recognised by code, the same duck type core's `ExecutorError` uses.
 */

import { APIError } from '@/lib/api/errors';
import { SPEND_CAP_CODES } from '@/lib/orchestration/llm/provider';
import { getUserFacingError } from '@/lib/orchestration/chat/error-messages';

/** A monthly spend cap's refusal code: `budget_exceeded`, `org_budget_exceeded` or `global_budget_exceeded`. */
export type SpendCapCode = (typeof SPEND_CAP_CODES)[keyof typeof SPEND_CAP_CODES];

const SPEND_CAP_REFUSAL_CODES: readonly string[] = Object.values(SPEND_CAP_CODES);

/**
 * The HTTP status a cap refusal answers with. The request was well formed and allowed; what
 * stops it is the budget, which retrying does not change — so not 429, which invites a retry.
 */
export const SPEND_CAP_STATUS = 402;

/** Whether `code` is a monthly spend cap's refusal code. */
export function isSpendCapCode(code: unknown): code is SpendCapCode {
  return typeof code === 'string' && SPEND_CAP_REFUSAL_CODES.includes(code);
}

/**
 * The spend-cap code `err` or anything it wraps carries, or `null`. Bounded at ten levels of
 * `cause`, as core's `ExecutorError` bounds it, because a chain is caller-built and can be cyclic.
 */
export function spendCapCodeOf(err: unknown): SpendCapCode | null {
  return spendCapCarrier(err)?.code ?? null;
}

/** The error in `err`'s `cause` chain that carries a spend-cap code; see {@link spendCapCodeOf}. */
function spendCapCarrier(err: unknown): (Error & { code: SpendCapCode }) | null {
  let current: unknown = err;
  for (let depth = 0; depth < 10 && current instanceof Error; depth++) {
    const carrier = current as Error & { code?: unknown };
    if (isSpendCapCode(carrier.code)) return carrier as Error & { code: SpendCapCode };
    current = current.cause;
  }
  return null;
}

/** A framework LLM call a monthly spend cap refused. */
export class SpendCapRefusedError extends APIError {
  declare code: SpendCapCode;
  /** What the refused run had already spent, so a caller that stops on it still counts it. */
  readonly costUsd: number;
  readonly tokensUsed: number;

  constructor(
    code: SpendCapCode,
    message?: string,
    options?: { cause?: unknown; costUsd?: number; tokensUsed?: number }
  ) {
    const { message: fallback, action } = getUserFacingError(code);
    super(message ?? (action ? `${fallback} ${action}` : fallback), code, SPEND_CAP_STATUS);
    this.name = 'SpendCapRefusedError';
    if (options?.cause !== undefined) this.cause = options.cause;
    this.costUsd = options?.costUsd ?? 0;
    this.tokensUsed = options?.tokensUsed ?? 0;
  }
}

/**
 * `err` as a {@link SpendCapRefusedError} when a spend cap refused it, else `null`. Keeps the
 * message of the error that carries the code — core's own, written for the operator and naming
 * who can raise the cap — not a wrapper's.
 */
export function asSpendCapRefusal(err: unknown): SpendCapRefusedError | null {
  if (err instanceof SpendCapRefusedError) return err;
  const carrier = spendCapCarrier(err);
  if (carrier === null) return null;
  return new SpendCapRefusedError(carrier.code, carrier.message || undefined, { cause: err });
}

/** Rethrow `err`, as a {@link SpendCapRefusedError} when a spend cap refused it. For a `.catch`. */
export function rethrowSpendCapRefusal(err: unknown): never {
  throw asSpendCapRefusal(err) ?? err;
}

/**
 * The spend-cap code a judge's failure text says refused it, or `null`. Only for an error that
 * kept a judge's message and dropped its code — core's `scoreResponse`, which reports a failed
 * judge as `<judge>: <message>` in the error it throws when all three fail, and as
 * `judge unavailable: <message>` in the reasoning of one that failed alone. A drained chat turn a
 * cap refused ends with the registry's words for the cap (`getUserFacingError`), so those words
 * must OPEN the judge's message: the same words inside some other error — a provider echoing the
 * turn it was asked to judge — are not a refusal. A stopgap until `scoreResponse` keeps the codes
 * (Sunrise #1071; `.context/framework/upstream-asks.md`).
 */
export function spendCapCodeInJudgeText(text: string): SpendCapCode | null {
  for (const code of Object.values(SPEND_CAP_CODES)) {
    const words = escapeRegExp(getUserFacingError(code).message);
    if (
      new RegExp(`(?:faithfulness|groundedness|relevance|judge unavailable): ${words}`).test(text)
    ) {
      return code;
    }
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
