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
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { VOICE_CONTROL_AGENT_SLUG } from '@/lib/app/voice/golden-set';

// The model and its price live in `pinned-model.ts`, which the provider seam
// loads on the way to every model call and so must stay import-light.
// Re-exported so everything about the pin is still reachable from one place.
export { PINNED_MODEL, PINNED_MODEL_INFO, PINNED_PROVIDER } from '@/lib/app/agent/pinned-model';

/**
 * Both arms of the golden-set comparison, pinned to the SAME pair.
 *
 * Pinning her alone would leave the bare control floating on the install
 * default, and from then on the comparison would measure the two models rather
 * than the fingerprint. `assertArmsComparable` refuses to queue in that state;
 * pinning both here is what keeps it from arising.
 */
export const PINNED_AGENT_SLUGS: readonly string[] = [VOICE_AGENT_SLUG, VOICE_CONTROL_AGENT_SLUG];

/** What the version timeline says when the seed writes the pin. */
export const PIN_CHANGE_SUMMARY = 'Pinned model and provider (seeded — §08)';

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
 * twice its true cost. Null falls through to whatever exact rate is there — ours
 * from `pinned-model.ts`, or OpenRouter's — and where neither is, the model reads
 * as unpriced, which the voice preflight flags rather than showing as cheap.
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
  contextLength: 'high',
  toolUse: 'moderate',
  bestRole: 'Her pinned voice model (dev)',
  costPerMillionTokens: null, // never a blended rate — see above
} as const;

/**
 * The default task models the side roles resolve through, and what fills them
 * when blank.
 *
 * `routing` is what the platform's conversation summariser asks for; `chat` is
 * what slot extraction, the facilitation supervisor and keyword enrichment ask
 * for. None of them speaks as her, so none needs her model — they sit on the
 * cheapest current one.
 *
 * The ALIAS here, deliberately, where her own pin is dated. A task default is
 * read by paths that look the model up by bare id in the in-memory registry —
 * the workflow LLM runner does it before any leaf seam has run, and THROWS
 * `unknown_model` on a miss. The static map knows the alias and not the snapshot,
 * and the snapshot is only registered where `lib/app/llm-providers.ts` has
 * already been wired; so a dated `chat` default would fail every workflow LLM
 * step in a cold process. Her own turns do not have that problem: an agent's
 * explicit model goes through the resolver, which wires the seam first.
 *
 * These roles extract and summarise; a repointed alias changes their cost before
 * it changes anything a person hears.
 */
export const SIDE_ROLE_MODEL = 'gpt-4o-mini';
export const SIDE_ROLE_TASKS = ['routing', 'chat'] as const;

/** The two seats this leaf's seed owns. Every other seat is left to whoever binds it. */
export const SEATED_ROLES: readonly string[] = [
  FACILITATION_ROLES.facilitator,
  FACILITATION_ROLES.onboarding,
];
