/**
 * Prose→typed extraction fallback for `fill_slot` (f-slot-capture t-3b, decision 7).
 *
 * **Impure** (DB + LLM) — the deliberately-separated sibling of the pure
 * [`typed-value.ts`](./typed-value.ts) map. When an agent captures a **typed** slot
 * (`number | boolean | date | json`) but supplies no valid `valueJson` — a prose-only
 * capture — this runs a **secondary #307-enforced structured completion** to extract the
 * typed value from the prose, constrained to the slot's `dataType` schema
 * (`typedValueSchema`). It fires ONLY on that rare path: the common text / valid-`valueJson`
 * cases short-circuit in `fill_slot` and never reach here, so silent captures stay silent
 * (D5) and no LLM cost is incurred on the hot path.
 *
 * Best-effort by contract: any failure (orphaned agent, no provider, malformed output,
 * timeout) returns `null` and the capture proceeds with the prose `value` and no typed
 * gate value — extraction must never fail the write.
 *
 * The provider/model are the **capturing agent's own** (`resolveAgentProviderAndModel`),
 * so the prose — which that agent already authored — is sent to the same provider it is
 * already talking to: no new data-exposure surface.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import type { LlmMessage } from '@/lib/orchestration/llm/types';
import { getProvider } from '@/lib/orchestration/llm/provider-manager';
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';
import { primaryCallContext } from '@/lib/orchestration/llm/provider-eligibility';
import { runStructuredCompletion } from '@/lib/orchestration/llm/structured-completion';
import { tryParseJson } from '@/lib/orchestration/evaluations/parse-structured';
import { SLOT_DATA_TYPE } from '@/lib/framework/data-slots/vocabulary';
import {
  typedValueSchema,
  validateTypedValue,
} from '@/lib/framework/data-slots/capabilities/typed-value';

/** Span phase tag for these completions (`gen_ai.operation.name` +
 *  `sunrise.evaluation.phase`) — this is slot capture, not evaluation. */
const EXTRACTION_PHASE = 'slot-extraction';

/** Tight budget — this is a single scalar extraction, not a generation. */
const EXTRACTION_MAX_TOKENS = 256;
const EXTRACTION_TIMEOUT_MS = 8_000;

const EXTRACTION_SYSTEM =
  'You convert one short piece of text into a single typed value. Extract the value the ' +
  'text expresses, as the requested data type, and respond ONLY with a JSON object of the ' +
  'form {"value": <the typed value>}. If the text does not clearly express such a value, ' +
  'respond with {"value": null}.';

/**
 * Extract the typed `valueJson` for a typed slot from its prose `value`, or `null` when
 * extraction is impossible or fails. Never throws. Not called for `text` slots (whose
 * typed form is the prose itself — `fill_slot` handles that inline).
 */
export async function extractTypedValue(
  dataType: string,
  prose: string,
  agentId: string
): Promise<Prisma.InputJsonValue | null> {
  if (dataType === SLOT_DATA_TYPE.text) return null;

  try {
    // Inside the try: a transient DB error on the agent lookup must degrade to null (a
    // capture without a typed gate value), never fail the write — the best-effort contract.
    const agent = await prisma.aiAgent.findUnique({
      where: { id: agentId },
      select: { provider: true, model: true, fallbackProviders: true },
    });
    if (agent === null) return null; // orphaned / system run — no provider to resolve

    const { providerSlug, model, provenance } = await resolveAgentProviderAndModel(agent, 'chat');
    // Tell the call-time provider gate (Sunrise 0.14.0, §120) which arm chose the provider; a
    // bare `getProvider(slug)` is held to both 'primary' and 'explicit' and may be refused.
    const provider = await getProvider(providerSlug, primaryCallContext(provenance));

    // Wrap the per-dataType schema in an object root (`{ value: <schema> }`) — the
    // portable shape `runStructuredCompletion` requires (a bare number/string/boolean
    // root is coerced to object by the Anthropic tool-extraction path).
    const responseSchema: Record<string, unknown> = {
      type: 'object',
      properties: { value: typedValueSchema(dataType) },
      required: ['value'],
      additionalProperties: false,
    };

    const messages: LlmMessage[] = [
      { role: 'system', content: EXTRACTION_SYSTEM },
      { role: 'user', content: `Data type: ${dataType}\nText: ${prose}` },
    ];

    const result = await runStructuredCompletion<Prisma.InputJsonValue>({
      provider,
      model,
      messages,
      responseSchema,
      responseSchemaName: 'slot_value',
      parse: (raw) =>
        tryParseJson(raw, (parsed) => {
          if (parsed === null || typeof parsed !== 'object' || !('value' in parsed)) return null;
          // The enforced schema constrains the shape; validate the type locally too so a
          // non-supporting provider (which ignores the schema) can't slip a wrong type in.
          return validateTypedValue(dataType, parsed.value);
        }),
      retryUserMessage: `Respond ONLY with a JSON object {"value": <the ${dataType}>}. No prose, no code fences.`,
      maxTokens: EXTRACTION_MAX_TOKENS,
      timeoutMs: EXTRACTION_TIMEOUT_MS,
      // Tag the span as slot capture, not evaluation. The runner's `phase` is an open
      // string (Sunrise #410) and defaults to `'evaluation'` when omitted, which
      // mislabelled every extraction as eval work in the OTEL trace. Spans only — the
      // runner persists nothing, and this call's `costUsd` is logged, never recorded.
      phase: EXTRACTION_PHASE,
    });

    logger.debug('fill_slot: extracted a typed value from prose', {
      agentId,
      dataType,
      costUsd: result.costUsd,
    });
    return result.value;
  } catch (err) {
    // Best-effort — a provider/parse/timeout failure must NOT fail the capture. The prose
    // `value` is still stored; only the typed gate value is absent (same as a no-op).
    logger.debug('fill_slot: prose→typed extraction failed; storing without a typed value', {
      agentId,
      dataType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
