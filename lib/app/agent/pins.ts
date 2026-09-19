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
import {
  PINNED_MODEL,
  PINNED_MODEL_CAPABILITIES,
  PINNED_MODEL_INFO,
  PINNED_PROVIDER,
} from '@/lib/app/agent/pinned-model';

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
 * **`contextLength` is `n_a`, for the same reason the cost is null.** The column
 * is a coarse label the adapter turns into a token count, and on hydrate a
 * POSITIVE count overrides the registry's 128,000. The chat handler trims history
 * to it. `high` — what the platform's row for the alias says — is 200,000 against
 * a 128k model, so a long conversation is rejected by the provider instead of
 * trimmed; `medium` (32,000), tried first, made her budget flip between 32k and
 * 128k depending on whether a hydrate or the leaf's registration wrote last.
 * `n_a` is 0, which falls through to the exact figure in every order — and where
 * nothing exact exists, the handler reads 0 as "no token budget" rather than as
 * a budget of nothing. No bucket means 128k, so none is claimed.
 *
 * **The slug and name are derived**, not typed out: change `PINNED_MODEL` and a
 * NEW row is created under its own slug, instead of the old row being rewritten
 * in place under a name that still describes the previous snapshot.
 */
export const PINNED_MODEL_MATRIX_ROW = {
  slug: `${PINNED_PROVIDER}-${PINNED_MODEL}`,
  providerSlug: PINNED_PROVIDER,
  modelId: PINNED_MODEL,
  name: PINNED_MODEL_INFO.name,
  description:
    'The dated snapshot of GPT-4o Mini that the voice golden set was signed off on. Pinned for her agent and the bare control so neither moves when the alias does.',
  capabilities: PINNED_MODEL_CAPABILITIES,
  tierRole: 'infrastructure',
  reasoningDepth: 'medium',
  latency: 'very_fast',
  costEfficiency: 'very_high',
  contextLength: 'n_a', // never a bucket the model does not fit — see above
  toolUse: 'moderate',
  bestRole: 'Her pinned voice model (dev)',
  costPerMillionTokens: null, // never a blended rate — see above
} as const;

/** The two seats this leaf's seed owns. Every other seat is left to whoever binds it. */
export const SEATED_ROLES: readonly string[] = [
  FACILITATION_ROLES.facilitator,
  FACILITATION_ROLES.onboarding,
];

/** What her version timeline says when the seed widens her to `public`. */
export const REACHABLE_CHANGE_SUMMARY = 'Made reachable by members (seeded — §08)';

/**
 * The capabilities her seed grants — the tool to look in her material.
 *
 * Granted together with the instruction that tells her to use it
 * (`VOICE_AGENT_SYSTEM_INSTRUCTIONS`): an instruction to look with no tool
 * produces a confident claim to have looked, and a tool with no instruction is
 * one she may never reach for.
 */
export const GRANTED_CAPABILITY_SLUGS: readonly ReadOnlyCapabilitySlug[] = [
  'search_knowledge_base',
];

/**
 * Every capability she may ever hold. Each one was read and found to change
 * nothing, and nothing else is on the list (f-safety t-60).
 *
 * Someone who talks her into deleting their account, their data or anything
 * else meets a tool set in which nothing deletes. That is enforced in two
 * places. **The chat path** refuses any tool name the model emits that is not in
 * her advertised set (`tool_not_advertised`, Sunrise's streaming handler).
 * **This list** is what that set may contain. `GRANTED_CAPABILITY_SLUGS` is typed
 * against it, so a grant outside it does not compile. Its test also names every
 * write capability the install ships and fails if one appears here.
 *
 * **Adding a slug is a security review, not an edit.** Read the capability's
 * `execute()` first. It belongs here only if nothing it does writes, deletes,
 * sends or spends on anyone's behalf.
 *
 * `search_knowledge_base` reads chunks. It is mounted in this leaf as
 * `LabelledSearchKnowledgeCapability`, which adds an origin label to each
 * result and writes nothing. The query embedding it pays for is a cost row, not
 * a change to anyone's data.
 *
 * What an operator binds in the admin UI is not stopped by a constant. The smoke
 * (`npm run smoke:app-misuse`) reads her advertised set on a real install and
 * fails if it holds anything outside this list.
 */
export const READ_ONLY_CAPABILITY_SLUGS = ['search_knowledge_base'] as const;
export type ReadOnlyCapabilitySlug = (typeof READ_ONLY_CAPABILITY_SLUGS)[number];

/**
 * The guard modes her agent is pinned to: observe, never speak (f-safety t-60).
 *
 * The platform's inline guards are heuristics. The input guard's own docblock
 * says it is not a security boundary. A `block` stops the turn with an error,
 * and every error reaches the person as our neutral `unavailable` ending
 * (`endings.ts`). So a false positive on someone's ordinary message would look
 * like she is down. At `log_only` a detection is still an event: it reaches the
 * escalation policy (`ESCALATION_POLICIES`, an audit entry and a notification)
 * and the safety record. The person just never sees a fake outage.
 *
 * Her refusals therefore stay in her prompt and are proved by the golden set's
 * `refusal` cases, not by a guard.
 *
 * This closes the `input_blocked` misfit §08 left in the endings by not
 * blocking, rather than by adding a word for it.
 *
 * The agent's own column wins over the install-wide default, which is why these
 * are written onto her. A `guard_minimum` policy can still raise a floor, but
 * that is an operator's explicit decision, and the smoke reports it.
 */
export const GUARD_MODES = { inputGuardMode: 'log_only', outputGuardMode: 'log_only' } as const;

/** What her version timeline says when the seed writes her guard modes. */
export const GUARD_MODES_CHANGE_SUMMARY = 'Guards set to observe, not block (seeded — f-safety)';

/**
 * The escalation policies her two seats carry: someone trying to talk her out
 * of role is seen by a person (f-safety t-60).
 *
 * Daybreak's `escalation` kind turns an input-guard detection on a seat into a
 * notification plus an audit entry (`handleFacilitationGuardEvent`). `flagged`
 * is the minimum severity. It fires on every detection, which at `log_only` is
 * every detection there is. `medium` priority because an attempt is not an
 * emergency. The crisis path is the one that is, and it does not go through a
 * guard.
 *
 * Operator-owned rows (`fp4`): the seed creates one only when none exists for
 * that seat and guard, and never edits or re-enables one.
 */
export const ESCALATION_POLICIES = SEATED_ROLES.map((role) => ({
  scope: { type: 'facilitation_role' as const, id: role },
  signal: { guard: 'input' as const, outcome: 'flagged' as const },
  priority: 'medium' as const,
}));
