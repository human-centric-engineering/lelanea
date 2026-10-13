/**
 * `fill_slot` capability (f-slot-capture t-2) — the write half: an agent persists a new
 * reading about the user into their data-slots (spec §6.1). A silent tool (D5) the agent
 * calls mid-conversation when it learns something worth remembering.
 *
 * Writes the **caller's own** slots (`caller.userId` → `appendSlotValue.userId`), so
 * there is no cross-user write and no `canRead` on this path (that guard is for reads).
 * It fills the two seams the shipped value engine deliberately left open:
 * - **Slug validation / open-mode minting.** `appendSlotValue` does not validate
 *   `slotSlug` and `SlotValue.slotSlug` is not an FK — so this capability decides:
 *   a slug with an **active** `SlotDefinition` is a *targeted* append; a **retired**
 *   (inactive) definition is refused; a slug with **no** definition is an *open-mode*
 *   mint (a free-form capture the system learns), logged for observability. Per-agent
 *   scoping of what may be written is t-4.
 * - **P2002 retry.** `appendSlotValue` computes the next version and does not retry a
 *   concurrent same-slug append (the loser hits `@@unique([userId, slotSlug, version])`);
 *   `fill_slot` catches P2002 once and re-runs off the fresh head.
 *
 * Sensitivity masking + local typed-value handling landed in **t-3**; the #307-enforced
 * prose→typed extraction fallback ([`extract.ts`](./extract.ts)) is **t-3b**.
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logging';
import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import { checkUserCaller } from '@/lib/framework/shared/caller';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import { redactedString } from '@/lib/security/redact';
import { appendSlotValue } from '@/lib/framework/data-slots/values';
import type { AppendSlotValueInput } from '@/lib/framework/data-slots/values';
import { getSlotDefinition } from '@/lib/framework/data-slots/queries';
import {
  SLOT_SOURCE_TYPE,
  SLOT_DATA_TYPE,
  SLOT_SENSITIVITY,
} from '@/lib/framework/data-slots/vocabulary';
import { validateTypedValue } from '@/lib/framework/data-slots/capabilities/typed-value';
import { extractTypedValue } from '@/lib/framework/data-slots/capabilities/extract';
import { slotMaskingPolicy } from '@/lib/framework/data-slots/capabilities/masking';
import {
  resolveExposureConfig,
  facetAllows,
} from '@/lib/framework/data-slots/capabilities/exposure';
import { decodeScope } from '@/lib/framework/shared/scope';

const fillSlotSchema = z.object({
  /** The slot to fill — an active definition's slug (targeted) or a new one (open-mint). */
  slotSlug: z.string().min(1).max(120),
  /** The plain-language reading — canonical for conversation. */
  value: z.string().min(1),
  /** 1–10. */
  confidence: z.number().int().min(1).max(10),
  /** One sentence: how this reading was made. */
  reasoningNote: z.string().min(1),
  /** How the value was captured (classifier — X1 free string, validated to the vocab). */
  sourceType: z.enum(SLOT_SOURCE_TYPE),
  /** Optional typed form of the value, matching the slot's `dataType` (number/boolean/
   *  date/json). Validated locally; ignored if it doesn't match. Omit for text slots. */
  valueJson: z.unknown().optional(),
});
type FillSlotArgs = z.infer<typeof fillSlotSchema>;

interface FillSlotData {
  slotSlug: string;
  version: number;
  /** Whether the slug was an open-mode mint (no prior definition). */
  minted: boolean;
}

export class FillSlotCapability extends BaseCapability<FillSlotArgs, FillSlotData> {
  readonly slug = 'fill_slot';
  readonly processesPii = true;

  readonly functionDefinition: CapabilityFunctionDefinition = {
    name: 'fill_slot',
    description:
      'Record something newly learned about the user as a data-slot value. Use a known slot slug, or a new descriptive slug to capture something not yet tracked. Silent — the user is not shown this.',
    parameters: {
      type: 'object',
      properties: {
        slotSlug: {
          type: 'string',
          description: 'The slot to fill (e.g. "primary_goal"). A new slug captures a new fact.',
          minLength: 1,
          maxLength: 120,
        },
        value: { type: 'string', description: 'The reading, in plain language.', minLength: 1 },
        confidence: {
          type: 'integer',
          description: 'How confident this reading is, 1 (low) to 10 (high).',
          minimum: 1,
          maximum: 10,
        },
        reasoningNote: {
          type: 'string',
          description: 'One sentence: how you arrived at this reading.',
          minLength: 1,
        },
        sourceType: {
          type: 'string',
          description: 'How the value was captured.',
          enum: Object.values(SLOT_SOURCE_TYPE),
        },
        valueJson: {
          description:
            'Optional typed form of the value (a number, boolean, ISO date string, or object) for slots that gate on a typed value. Omit for plain text.',
        },
      },
      required: ['slotSlug', 'value', 'confidence', 'reasoningNote', 'sourceType'],
    },
  };

  protected readonly schema = fillSlotSchema;

  /**
   * The captured `value` (+ the `reasoningNote`, which quotes it) is user-derived PII, so
   * both are masked in the durable audit row; `confidence`/`sourceType` stay so an auditor
   * sees the shape of what was written. The slug is kept ONLY on a **confirmed targeted
   * success** (a vetted `SlotDefinition` identifier — safe): a **minted** slug is
   * model-authored free text that can itself encode PII (e.g. `recently_divorced`), so it
   * is masked. Crucially, we mask on **every non-targeted-success** result too — including
   * a thrown DB error, which the streaming handler reports as a generic `execution_error`
   * where we can no longer tell a minted slug from a targeted one — because keeping an
   * unconfirmed slug would leak a minted one into the durable trace. Losing the (safe)
   * targeted slug on a `slot_inactive` refusal is the cheap price. The LLM still sees the
   * un-redacted result.
   */
  redactProvenance(
    args: FillSlotArgs,
    result: CapabilityResult<FillSlotData>
  ): { args: unknown; resultPreview: string } {
    const slugIsVettedTargeted = result.success && result.data?.minted === false;
    const safeArgs = {
      ...args,
      value: redactedString('slot-value'),
      reasoningNote: redactedString('slot-reasoning'),
      ...(args.valueJson !== undefined ? { valueJson: redactedString('slot-value-json') } : {}),
      ...(slugIsVettedTargeted ? {} : { slotSlug: redactedString('minted-slot') }),
    };
    const safeResult =
      !slugIsVettedTargeted && result.success && result.data
        ? { ...result, data: { ...result.data, slotSlug: redactedString('minted-slot') } }
        : result;
    return { args: safeArgs, resultPreview: JSON.stringify(safeResult) };
  }

  async execute(
    args: FillSlotArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<FillSlotData>> {
    const caller = checkUserCaller(context, 'Slot capture');
    if (!caller.ok) return this.error(caller.message, caller.code);

    // Targeted vs open-mint: a defined-and-active slug appends; a retired one is refused;
    // an undefined slug is a runtime open-mode mint.
    const definition = await getSlotDefinition(args.slotSlug);
    if (definition !== null && !definition.isActive) {
      return this.error(
        `Slot "${args.slotSlug}" is retired and no longer accepts new values.`,
        'slot_inactive'
      );
    }
    // Per-agent write exposure (t-4): the binding config the dispatcher resolved for this
    // capability may allowlist which slot groups/scopes this agent may write. Enforced
    // BEFORE any write. A malformed config fails closed; an absent one is permissive.
    // A mint (no definition ⇒ null group/scope) is refused under any active write
    // restriction — an agent limited to named groups/scopes may not invent a slot
    // outside them.
    const exposure = resolveExposureConfig(context, this.slug);
    if (!exposure.ok) {
      return this.error("This agent's slot-access configuration is invalid.", 'invalid_exposure');
    }
    if (!facetAllows(exposure.config.write, definition?.group ?? null, definition?.scope ?? null)) {
      return this.error(
        `Slot "${args.slotSlug}" is outside this agent's write scope.`,
        'slot_not_permitted'
      );
    }

    const minted = definition === null;
    if (minted) {
      // A minted slug is model-authored free text that can encode PII — so it is NOT
      // logged (durable app logs aren't erasure-covered). The `agentId` is enough to
      // spot a runaway/abusive agent; the slug itself lives only in the (erasable) slot
      // row for an authorised operator to inspect.
      logger.info('fill_slot: minted an open-mode slot value', { agentId: context.agentId });
    }

    // The slot's typing + sensitivity come from its definition (a mint has neither, so
    // it defaults to a text/standard slot). The typed gate value: `text` ⇒ the value
    // itself; a typed slot ⇒ the agent's `valueJson` if it validates, else a prose→typed
    // extraction (t-3b) as a best-effort fallback (null if that too fails). Then
    // sensitivity masking runs BEFORE the append, so raw special-category prose never
    // lands at rest.
    const dataType = definition?.dataType ?? SLOT_DATA_TYPE.text;
    const sensitivity = definition?.sensitivity ?? SLOT_SENSITIVITY.standard;
    let typedValue =
      dataType === SLOT_DATA_TYPE.text ? args.value : validateTypedValue(dataType, args.valueJson);
    if (typedValue === null && dataType !== SLOT_DATA_TYPE.text) {
      // Prose-only capture of a typed slot: extract the typed form from the value. Fires
      // only here — the common text / valid-`valueJson` paths never reach it, so silent
      // captures stay silent (D5) and no LLM cost hits the hot path.
      typedValue = await extractTypedValue(dataType, args.value, context.agentId);
    }
    const stored = slotMaskingPolicy(sensitivity, dataType, {
      value: args.value,
      valueJson: typedValue,
    });

    const scope = decodeScope(context.scope);
    const input: AppendSlotValueInput = {
      userId: caller.userId,
      slotSlug: args.slotSlug,
      value: stored.value,
      ...(stored.valueJson !== null ? { valueJson: stored.valueJson } : {}),
      confidence: args.confidence,
      sourceType: args.sourceType,
      reasoningNote: args.reasoningNote,
      provenance: {
        ...(context.conversationId !== undefined ? { conversationId: context.conversationId } : {}),
        ...(scope.moduleSlug !== undefined ? { moduleSlug: scope.moduleSlug } : {}),
        ...(scope.nodeKey !== undefined ? { nodeKey: scope.nodeKey } : {}),
      },
    };

    const written = await appendWithP2002Retry(input);
    return this.success(
      { slotSlug: written.slotSlug, version: written.version, minted },
      {
        skipFollowup: true,
      }
    );
  }
}

/**
 * Append, retrying once on a P2002 unique-violation — a concurrent same-slug append that
 * computed the same next version. The re-run reads the now-committed head and takes the
 * next version. A second P2002 (vanishingly rare) propagates to the dispatcher.
 */
async function appendWithP2002Retry(input: AppendSlotValueInput) {
  try {
    return await appendSlotValue(input);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return appendSlotValue(input);
    }
    throw err;
  }
}
