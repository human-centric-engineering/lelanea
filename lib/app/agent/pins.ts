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
import { readableSlotGroups } from '@/lib/app/content/slot-taxonomy';
// One spelling of the capture slug, shared with the panel that refreshes when
// it answers — see the constant's own docblock for why it lives there.
import { SLOT_WRITE_CAPABILITY } from '@/lib/app/slots/notes-view';
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

/** What her version timeline says when the seed lets members speak to her (t-67). */
export const VOICE_INPUT_CHANGE_SUMMARY = 'Voice input switched on (seeded — §10)';

/**
 * The capabilities her seed grants — the tool to look in her material.
 *
 * Granted together with the instruction that tells her to use it
 * (`VOICE_AGENT_SYSTEM_INSTRUCTIONS`): an instruction to look with no tool
 * produces a confident claim to have looked, and a tool with no instruction is
 * one she may never reach for.
 */
export const GRANTED_CAPABILITY_SLUGS: readonly HerCapabilitySlug[] = ['search_knowledge_base'];

/**
 * What the slot-capture seed grants: she reads what is already understood about
 * a person, and writes what she newly learns (f-slots t-72).
 *
 * A separate list from `GRANTED_CAPABILITY_SLUGS` because these two bindings
 * carry an exposure allowlist ({@link SLOT_EXPOSURE_CONFIG}) and 007's do not —
 * the seeds are what differ, not the ceiling, and both lists are checked
 * against {@link HER_CAPABILITY_SLUGS} by the same test.
 *
 * Granted together with the instruction that tells her when to write, for the
 * reason `GRANTED_CAPABILITY_SLUGS` gives: a tool with no instruction is one she
 * may never reach for, and an instruction with no tool produces a confident
 * claim to have done it.
 */
export const SLOT_CAPABILITY_SLUGS: readonly HerCapabilitySlug[] = ['get_state', 'fill_slot'];

/**
 * What the resources seed grants: the agent may hand a person one of Lelañea
 * Fulton's films or pieces of writing (f-resources t-77).
 *
 * Its own list because its own seed grants it
 * (`prisma/seeds/app-lelanea/014-suggest-resource.ts`), which also creates the
 * capability's row — the app's own tool, not one of Daybreak's or Sunrise's.
 * No allowlist: an id in, a library record out. The instruction that tells the
 * agent when to reach for it rides in the facilitation context beside the list
 * of what may be suggested (`lib/app/resources/offering.ts`), read per turn.
 */
export const RESOURCE_CAPABILITY_SLUGS: readonly HerCapabilitySlug[] = ['suggest_resource'];

/**
 * The exposure allowlist on both slot bindings — what she may read back, and
 * what she may write (f-slots t-72).
 *
 * Daybreak's allowlist filters on a slot's `group` and `scope` only
 * (`lib/framework/data-slots/capabilities/exposure.ts`), and the two facets are
 * deliberately asymmetric here:
 *
 * - **No `write` facet, which is permissive.** Not an oversight, and not the
 *   same as forgetting to restrict. An open-mode mint has no definition row, so
 *   it has no group and no scope — and `facetAllows()` refuses a null group
 *   against any named list. So ANY write restriction, however wide, also forbids
 *   her inventing a slot. The owner ruled on 20 Sept 2026 that she may invent
 *   one; that ruling and a `write` facet cannot both hold. What bounds her
 *   writing is her instruction, until the admin-mode feature lands (idea #33).
 * - **A `read` facet naming the groups whose slots are all visible.** §12:
 *   development is "a tuning signal, never a grade. It must never rank, score,
 *   or display that as a level." `visibility: hidden` is that mechanism, and
 *   this is what keeps it true of the model as well as of the panel — she writes
 *   a development slot and never reads one back, so it cannot reach a sentence
 *   she says. The cost, accepted with the ruling: the same filter drops her own
 *   mints, which have no group either, so she cannot read those back.
 *
 * **Derived from the bundled taxonomy, never typed out** — see
 * {@link readableSlotGroups}.
 */
export const SLOT_EXPOSURE_CONFIG = {
  read: { groups: readableSlotGroups() },
} as const;

/**
 * The capabilities she holds that only read (f-safety t-60).
 *
 * `search_knowledge_base` reads chunks. It is mounted in this leaf as
 * `LabelledSearchKnowledgeCapability`, which adds an origin label to each
 * result and writes nothing. The query embedding it pays for is a cost row, not
 * a change to anyone's data.
 *
 * `get_state` reads the head value of the caller's own slots, through
 * Daybreak's `canRead` guard and this leaf's exposure allowlist
 * ({@link SLOT_EXPOSURE_CONFIG}). It writes nothing and cannot reach another
 * person's slots (f-slots t-72).
 */
export const READ_ONLY_CAPABILITY_SLUGS = [
  'search_knowledge_base',
  'get_state',
  // Hands the person one of Lelañea Fulton's films or pieces of writing, by
  // id (f-resources t-77). Reads the library and returns a record: no write,
  // no delete, nothing on anyone's behalf — `lib/app/resources/suggest.ts`.
  'suggest_resource',
] as const;

/**
 * The one capability she holds that writes — and what makes it admissible
 * (f-slots t-72).
 *
 * **The ceiling f-safety t-60 shipped was "she may only ever hold tools that
 * read".** §11 needs her to record what she learns about a person as she learns
 * it, so that rule had to be restated rather than quietly worked around. Owner
 * ruling, 20 Sept 2026 — the ceiling is now:
 *
 * > Nothing she holds may **delete** anything, or act on **anyone else's**
 * > behalf.
 *
 * `fill_slot` is admitted under it, and the argument is made here rather than
 * assumed:
 *
 * - **Own profile only.** It writes `context.userId`'s slots and nothing else —
 *   the framework's own docblock: "there is no cross-user write and no `canRead`
 *   on this path". There is no argument by which one person's conversation
 *   reaches another person's data.
 * - **Appends, never overwrites.** `framework_slot_value` is insert-only; a
 *   write is a new version beside the old one. Nothing it does is destructive,
 *   and the previous reading stays readable and correctable.
 * - **Sends and spends nothing on anyone's account.** No message leaves, no
 *   order is placed. The one cost is the prose→typed extraction fallback on a
 *   typed slot captured as prose (`extract.ts`), which is a cost row on this
 *   install's own budget, like the search embedding above.
 *
 * So the sentence that mattered stays true: **someone who talks her into
 * deleting their account, their data, or anything else still meets a tool set in
 * which nothing deletes.**
 *
 * **Adding a slug here is a security review, not an edit** — the same bar as
 * before, against the restated rule. Read the capability's `execute()` first,
 * and write the argument down as this one is written down.
 */
export const SELF_WRITE_CAPABILITY_SLUGS = [SLOT_WRITE_CAPABILITY] as const;

/**
 * Every capability she may ever hold: what reads, plus the sanctioned writes.
 *
 * That is enforced in two places. **The chat path** refuses any tool name the
 * model emits that is not in her advertised set (`tool_not_advertised`,
 * Sunrise's streaming handler). **This list** is what that set may contain —
 * every granted list is typed against it, so a grant outside it does not
 * compile. Its test names every write capability the install ships and fails if
 * one appears here that {@link SELF_WRITE_CAPABILITY_SLUGS} has not argued for.
 *
 * What an operator binds in the admin UI is not stopped by a constant. The smoke
 * (`npm run smoke:app-misuse`) reads her advertised set on a real install and
 * fails if it holds anything outside this list.
 */
export const HER_CAPABILITY_SLUGS = [
  ...READ_ONLY_CAPABILITY_SLUGS,
  ...SELF_WRITE_CAPABILITY_SLUGS,
] as const;
export type HerCapabilitySlug = (typeof HER_CAPABILITY_SLUGS)[number];

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
