/**
 * `set_register` — the person asks to be met differently, in their own words
 * (f-registers t-126; product description §3.4, §3.14).
 *
 * "Just be gentle with me today", "push me harder on this", "never mind, go
 * back to normal". The AI calls this when the person asks, and the next turn
 * is steered to that register (`register-store.ts`). The ask is disclosed in
 * the account under the reply, like any tool call.
 *
 * ## Bounded (owner ruling, 2 Oct 2026)
 *
 * A lean, not an order. It beats the module's default; a crisis beats it, and
 * the overlays still set teaching down when pain shows. It holds for a sitting
 * ({@link LEAN_HOLD_HOURS}) on the module the person is in, then lapses.
 *
 * ## A write, admitted under the ceiling
 *
 * The guide's tools may not delete anything or act on anyone else's behalf
 * (`lib/app/agent/pins.ts`). This writes, so it is argued there: it writes
 * `context.userId`'s own lean, on their own journey, through Daybreak's
 * `canWrite`-guarded seam, and nothing else. Clearing it writes a tombstone;
 * nothing is deleted. It spends nothing.
 *
 * ## The facilitator seat only
 *
 * The register is the facilitator seat's (the onboarding seat is one moment,
 * the first meeting). The turn seam stamps every dispatch with its seat
 * (`costLogMetadata`); a call from any other seat, or from no turn at all, is
 * answered with a refusal the AI can speak past rather than a write nobody
 * would read.
 *
 * @see lib/app/voice/register-lean.ts — where the lean lives, and for how long
 * @see prisma/seeds/app-lelanea/023-set-register.ts — its row and grant
 */

import { z } from 'zod';

import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import { logger } from '@/lib/logging';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { readCurrentModuleSlug } from '@/lib/app/voice/register-store';
import { leanLapsesAt, recordRegisterLean } from '@/lib/app/voice/register-lean';
import { REGISTERS, type Register } from '@/lib/app/voice/register';

export const SET_REGISTER_SLUG = 'set_register';

/** What the person may ask for: one of the registers, or to go back to the module's. */
const ASKS = [...REGISTERS, 'default'] as const;
type Ask = (typeof ASKS)[number];

/**
 * What the model is told the tool is. Kept in step with the seed's literal by
 * `tests/unit/prisma/seeds/app-lelanea/set-register.test.ts`.
 */
export const SET_REGISTER_DEFINITION: CapabilityFunctionDefinition = {
  name: SET_REGISTER_SLUG,
  description:
    'Call this only when the person asks you to change how you speak with them: gentler or softer ("be gentle with me today", "I can’t take being pushed right now") is guiding; more direct or challenging ("push me", "don’t let me off the hook") is teaching; asking to go back to how it was is default. It holds for the rest of this sitting. Never call it on your own judgement, and never to push someone who is struggling. Then answer them in that register.',
  parameters: {
    type: 'object',
    properties: {
      register: {
        type: 'string',
        enum: [...ASKS],
        description:
          'guiding (gentle, holding space), teaching (direct, probing), or default (back to how this part of the journey starts).',
      },
    },
    required: ['register'],
  },
};

const argsSchema = z.object({ register: z.enum(ASKS) });
type SetRegisterArgs = z.infer<typeof argsSchema>;

/** What the AI is told back. */
export interface SetRegisterResult {
  register: Register | 'default';
  /** ISO, or null when the ask was to go back to the default. */
  holdsUntil: string | null;
}

/** The seat the turn seam stamped on this dispatch, or null when it came from no turn. */
function seatOf(context: CapabilityContext): string | null {
  const parsed = z.object({ seat: z.string() }).safeParse(context.costLogMetadata);
  return parsed.success ? parsed.data.seat : null;
}

export class SetRegisterCapability extends BaseCapability<SetRegisterArgs, SetRegisterResult> {
  readonly slug = SET_REGISTER_SLUG;
  readonly functionDefinition = SET_REGISTER_DEFINITION;
  protected readonly schema = argsSchema;
  /** A register in, a register and a time out: nothing personal passes through. */
  readonly processesPii = false;

  async execute(
    args: SetRegisterArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<SetRegisterResult>> {
    if (context.userId === null) {
      return this.error('There is no person to remember this for.', 'no_person');
    }
    if (seatOf(context) !== CONVERSATION_SEAT) {
      return this.error(
        'How you speak can only be changed in the main conversation, not here. Answer the person as you are.',
        'wrong_seat'
      );
    }

    const ask: Ask = args.register;
    const now = new Date();
    try {
      const moduleSlug = await readCurrentModuleSlug(context.userId);
      const outcome =
        moduleSlug === null
          ? 'no_module'
          : await recordRegisterLean(
              context.userId,
              moduleSlug,
              ask === 'default' ? null : ask,
              now
            );
      if (outcome === 'no_module') {
        return this.error(
          'The person is not in a part of the journey yet, so this cannot be remembered. Answer them as they asked anyway.',
          'no_module'
        );
      }
    } catch (err) {
      logger.error('set_register: the lean could not be recorded', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.error(
        'This could not be remembered just now. Answer the person as they asked anyway.',
        'not_recorded'
      );
    }

    return this.success({
      register: ask,
      holdsUntil: ask === 'default' ? null : leanLapsesAt(now).toISOString(),
    });
  }
}
