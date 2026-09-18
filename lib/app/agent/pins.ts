/**
 * What she runs on, and which seats she holds — the values, in one place.
 *
 * Before §08 her agent shipped with an empty provider and model, so she answered
 * on whatever this install's default chat model happened to be. A change to a
 * platform default would have changed her voice overnight with nobody deciding
 * it, which is the exact event §8.2 of the product description rules out
 * ("version pinning, never latest").
 *
 * ## Why this model
 *
 * Owner ruling, 18 Sept 2026: pin the model the golden set was signed off on.
 * That is recoverable from the record rather than remembered — of the three run
 * pairs queued on 17 Sept 2026 only the last completed without failing every
 * case, and its cost rows name `openai` / `gpt-4o-mini`. That string is an
 * alias; the provider reports serving it from `gpt-4o-mini-2024-07-18`
 * (checked against the API on 18 Sept 2026), which is what is pinned.
 *
 * **This is the dev pin.** Production's model is chosen later, by evaluation, and
 * changing it is an admin edit to the agent — the seed fills these values only
 * when they are blank and never writes over one somebody set. Editing the
 * constants below therefore changes what a FRESH install gets, not what an
 * existing one runs.
 *
 * ## Why no fallback
 *
 * Owner ruling, same date. The platform has no fallback *model*: failover swaps
 * the provider and asks the next one for the same model string. Her voice was
 * signed off on one model, so a second would need its own sign-off before it
 * could speak as her. Explicit provider, explicit model, empty fallback list —
 * when it is unreachable the turn ends and says so.
 *
 * @see prisma/seeds/app-lelanea/005-agent-models.ts
 * @see prisma/seeds/app-lelanea/006-agent-seats.ts
 * @see .context/app/agent.md
 */

import { FACILITATION_ROLES } from '@/lib/framework/facilitation/agents/roles';
import { PINNED_MODEL, PINNED_PROVIDER } from '@/lib/app/agent/pinned-model';

// The model and its price live in `pinned-model.ts`, which the provider seam
// loads on the way to every model call and so must stay import-light.
// Re-exported so everything about the pin is still reachable from one place.
export { PINNED_MODEL, PINNED_MODEL_INFO, PINNED_PROVIDER } from '@/lib/app/agent/pinned-model';

/** What the version timeline says when the seed writes the pin. */
export const PIN_CHANGE_SUMMARY = 'Pinned model and provider (seeded — §08)';

/**
 * What the bare control's timeline says when the seed sets its model.
 *
 * A different sentence from hers on purpose: the control is never pinned on its
 * own account. It follows whatever she is on — the dev pin, or a model an admin
 * chose for her — because a comparison on two models measures the models.
 */
export const CONTROL_FOLLOWS_SUMMARY = "Matched to lelanea-guide's model (seeded — §08)";

/**
 * The provider-model matrix row for the pinned id.
 *
 * The platform's matrix seed carries the alias only. Without a row for the dated
 * id it is missing from the agent form's Model dropdown — so an admin who opens
 * her agent cannot re-select the value she is already on — and is unknown to the
 * registry on any path that hydrates from the matrix.
 *
 * Same characteristics as the platform's `openai-gpt-4o-mini` row, because it is
 * the same model — with one deliberate difference. **`costPerMillionTokens` is
 * null.** The column is a single number applied to input and output alike, and
 * on hydrate a positive value OVERRIDES a split price already in the registry:
 * measured, the platform's blended $0.375 prices a 3,000-in / 300-out turn at
 * twice its true cost. In the REGISTRY, null falls through to whatever exact rate
 * is there — ours from `pinned-model.ts`, or OpenRouter's — and where neither is,
 * the model reads as unpriced, which the voice preflight flags.
 *
 * The cost of that choice, accepted: the admin model list
 * (`GET /api/v1/admin/orchestration/models`) does not merge, it lets the matrix
 * row REPLACE the registry entry, so this model is listed there with no price
 * beside an alias that shows one. A wrong number in every cost row is worse than
 * a blank in a dropdown; the true rate is in `.context/app/agent.md`.
 *
 * **`contextLength` is `medium`, the conservative bucket.** The column is a
 * coarse label the adapter turns into a token count — `high` is 200,000 — and on
 * hydrate that positive number overrides the registry's 128,000. The chat
 * handler uses it as the history-truncation budget, so `high` (what the
 * platform's row for the alias says) budgets 200k against a 128k model and a long
 * conversation is rejected by the provider instead of trimmed. No bucket means
 * 128k; `medium` (32,000) trims early, which is the failure that loses nothing.
 */
export const PINNED_MODEL_MATRIX_ROW = {
  slug: 'openai-gpt-4o-mini-2024-07-18',
  providerSlug: PINNED_PROVIDER,
  modelId: PINNED_MODEL,
  name: 'GPT-4o Mini (2024-07-18)',
  description:
    'The dated snapshot of GPT-4o Mini that the voice golden set was signed off on. Pinned for her agent and the bare control so neither moves when the alias does.',
  capabilities: ['chat', 'vision', 'documents'],
  tierRole: 'infrastructure',
  reasoningDepth: 'medium',
  latency: 'very_fast',
  costEfficiency: 'very_high',
  contextLength: 'medium', // conservative on purpose — see above
  toolUse: 'moderate',
  bestRole: 'Her pinned voice model (dev)',
  costPerMillionTokens: null, // never a blended rate — see above
} as const;

/** The two seats this leaf's seed owns. Every other seat is left to whoever binds it. */
export const SEATED_ROLES: readonly string[] = [
  FACILITATION_ROLES.facilitator,
  FACILITATION_ROLES.onboarding,
];
