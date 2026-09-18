/**
 * The model she is pinned to, and what it costs — nothing else.
 *
 * Split out of `pins.ts` for one reason: `lib/app/llm-providers.ts` imports this
 * file, and that seam is loaded in every module graph that is about to resolve a
 * provider. `pins.ts` also names her agents and seats, which pulls in the content
 * loader and Daybreak's vocabulary; none of that belongs on the path to a model
 * call. This file imports a type and nothing more.
 *
 * ## Why the price is here at all
 *
 * Sunrise's cost tracker prices a turn from an in-memory model registry. Its
 * static map knows the alias `gpt-4o-mini` and not the dated snapshot §8.2 makes
 * us pin, and nothing on the chat path or in the evaluation worker warms the
 * registry from anywhere else — only the admin cost/model pages and the
 * estimators do, each in their own module graph. Measured on 18 Sept 2026, in a
 * cold process, 3,000 tokens in and 300 out: the alias priced at $0.00063 and
 * the dated id at **$0**, with a warning nobody reads.
 *
 * So the leaf teaches the registry this one model's rate, through the seam that
 * runs where the cost is about to be logged. Owner ruling, 18 Sept 2026, over
 * pinning the alias (drifts) and over accepting $0 until the turn seam lands
 * (zeroes the golden-set costs today).
 *
 * **The rates are the published per-million rates for this snapshot** and are
 * part of the pin: change `PINNED_MODEL` and these change with it, in the same
 * edit. A test holds the two together as far as it can — it fails if the id
 * changes and the rates are left behind.
 *
 * What this does NOT cover: a model an admin later pins through the agent form.
 * If that id is outside the static map it prices at $0 in a cold process, for
 * the same reason. That is the platform gap, reported upstream, and §08 t-54
 * carries the requirement that a miss on the turn path is surfaced rather than
 * logged as free.
 *
 * @see lib/app/llm-providers.ts — where this is registered
 * @see .context/app/agent.md
 */

import type { ModelInfo } from '@/lib/orchestration/llm/types';

/** The `AiProviderConfig.slug` her turns go to. Explicit, so it is never re-picked. */
export const PINNED_PROVIDER = 'openai';

/** A dated snapshot, never the alias that can be repointed. */
export const PINNED_MODEL = 'gpt-4o-mini-2024-07-18';

/**
 * The registry entry for the pinned snapshot.
 *
 * `provider` matches the registry's own entry for the alias, so runtime provider
 * resolution by bare id lands where the alias's does. Tier, context and tool
 * support are the alias's too: it is the same model under its dated name.
 */
export const PINNED_MODEL_INFO: ModelInfo = {
  id: PINNED_MODEL,
  name: 'GPT-4o Mini (2024-07-18)',
  provider: PINNED_PROVIDER,
  tier: 'budget',
  inputCostPerMillion: 0.15,
  outputCostPerMillion: 0.6,
  maxContext: 128_000,
  supportsTools: true,
};
