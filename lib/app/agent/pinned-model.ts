/**
 * The model the voice agent is pinned to, and what it costs — nothing else.
 *
 * Split out of `pins.ts` for one reason: `lib/app/llm-providers.ts` imports this
 * file, and that seam is loaded in every module graph that is about to resolve a
 * provider. `pins.ts` also names the agent's seats, which pulls in Daybreak's
 * vocabulary, and the matrix row; none of that belongs on the path to a model
 * call. This file imports the model registry — synchronous, no database — and
 * nothing more.
 *
 * ## Why the price is here at all
 *
 * Sunrise's cost tracker prices a turn from an in-memory model registry. Its
 * static map knows the alias `gpt-4o-mini` and not the dated snapshot §8.2 makes
 * us pin. Measured on 18 Sept 2026, in a cold process, 3,000 tokens in and 300
 * out: the alias priced at $0.00063 and the dated id at **$0**, with a warning
 * nobody reads. Since Sunrise 0.14.0 every provider call hydrates the registry
 * from the matrix first (#813's fix), but our matrix row is null-cost on purpose
 * (one blended rate mis-prices), so a hydrate alone still prices the snapshot
 * at $0. The rate has to come from here.
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
 * the same reason. That is the platform gap, reported as sunrise#813
 * (https://github.com/human-centric-engineering/sunrise/issues/813), and §08 t-54
 * carries the requirement that a miss on the turn path is surfaced rather than
 * logged as free.
 *
 * @see lib/app/llm-providers.ts — where this is registered
 * @see .context/app/agent.md
 */

import {
  getModel,
  isMatrixOwnedFigure,
  registerModels,
} from '@/lib/orchestration/llm/model-registry';
import type { ModelInfo } from '@/lib/orchestration/llm/types';

/** The `AiProviderConfig.slug` the agent's turns go to. Explicit, so it is never re-picked. */
export const PINNED_PROVIDER = 'openai';

/** A dated snapshot, never the alias that can be repointed. */
export const PINNED_MODEL = 'gpt-4o-mini-2024-07-18';

/** What the pinned model can take. One list, shared with its matrix row in `pins.ts`. */
export const PINNED_MODEL_CAPABILITIES: readonly string[] = ['chat', 'vision', 'documents'];

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
  // Carried here as well as on the matrix row: `ensurePinnedModelPriced()` can
  // replace an entry a hydrate put there, and an entry with no capabilities has
  // the agent form greying out toggles until the next hydrate restores them.
  available: true,
  capabilities: [...PINNED_MODEL_CAPABILITIES],
};

/**
 * Make sure the registry THIS module graph reads can price the pinned model.
 *
 * Cheap enough to call wherever a price is about to be asked for: one map lookup
 * when the rate is already there, one registration when it is not. Two callers
 * today — the provider seam (before any model call is costed) and the voice
 * preflight (before the leaf's own estimate).
 *
 * **What it holds against (divergence row 30).** It registers as code, so a
 * matrix hydrate fills around the rate and never replaces it. A rate a hydrate
 * put there — an admin's blended cost typed onto our row — is replaced here
 * rather than left alone, so the exact rate wins whichever ran first. An id
 * another provider holds is theirs to route and is left alone. A
 * catalogue refresh (`refreshFromOpenRouter()`) puts the rate back where the new
 * catalogue has no price for the snapshot; where OpenRouter prices it, its split
 * rate stands, which is the same rate.
 */
export function ensurePinnedModelPriced(): void {
  const known = getModel(PINNED_MODEL);
  const priced = known && known.inputCostPerMillion > 0 && known.outputCostPerMillion > 0;
  // A positive rate is left alone unless a matrix row put it there: OpenRouter's
  // figure is as good as ours, a blended row's is not.
  const fromMatrix =
    isMatrixOwnedFigure(PINNED_MODEL, 'input') || isMatrixOwnedFigure(PINNED_MODEL, 'output');
  // Another provider holding the id owns its routing; the registration would
  // leave it alone, so there is nothing to retry.
  if ((priced && !fromMatrix) || (known && known.provider !== PINNED_PROVIDER)) return;
  // As a code registration, so the next matrix hydrate — our row is null-cost
  // on purpose — fills around this rate rather than zeroing it (Sunrise 0.14.0;
  // divergence row 30).
  registerModels([PINNED_MODEL_INFO], { source: 'code' });
}
