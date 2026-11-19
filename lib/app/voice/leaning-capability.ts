/**
 * `set_leaning` — a person changes one of their lasting leanings in a sentence,
 * or says yes when the AI suggests one (f-leanings t-137; product description
 * §3.4, §5 "User preference is a filter").
 *
 * "Be plainer with me", "you can be more direct with me than this": the person
 * asks, and one dial moves a stop toward that pole, exactly as if they had
 * moved it in Settings. The setting lasts until they change it again, here or
 * there. The change is a new version of their own leaning slot, written by the
 * one service settings writes through (`leanings-store.ts`), so the dial in
 * Settings moves with it.
 *
 * ## Proposal, then confirmation (owner rulings, 4 and 5 Oct 2026)
 *
 * The AI may notice a pattern the person has not named ("you keep cutting my
 * longer answers short") and propose the change. **It never moves a dial on
 * inference alone**: what it has noted about how someone likes to be met (the
 * `preferences` slots) is evidence to propose from, never a setting.
 *
 * That is held in code, not only in words. The smoke showed the pinned model
 * moving a dial on a pattern turn and calling it `agreed`, with no proposal
 * and no yes, so the account would have told the person they agreed to
 * something never put to them. So a proposal is itself a call, `how:
 * proposed`, which writes nothing; its answered trace is the record. `how:
 * agreed` is refused unless the person's PREVIOUS turn carried a proposal for
 * the same leaning and stop. A yes therefore always comes in a message of the
 * person's own, after the proposal was shown to them, and the account's "you
 * agreed" is true. Whether their message was really a yes is still the AI's
 * reading; that much cannot be code.
 *
 * Said in the tool's description and in the per-turn block that lists the
 * dials (`leaning-context.ts`); a test pins both. A dial the bounds mark as
 * not to be suggested is refused for a proposal and an agreement alike; the
 * person can still ask.
 *
 * ## Not `set_register`
 *
 * `set_register` is today's lean ("be gentle with me today"): one sitting, on
 * the module they are in. This is a lasting setting. Its description says so,
 * naming `set_register`; the AI holds both and reads both together.
 *
 * ## A write, admitted under the ceiling
 *
 * Argued in `lib/app/agent/pins.ts`: it writes `context.userId`'s own leaning,
 * insert-only, through the store's bounds, and nothing else. The arguments name
 * no person (the schema is strict, so a `userId` argument is refused). It
 * deletes nothing and spends nothing.
 *
 * ## The facilitator seat only
 *
 * The seat with a register is the only one whose turns apply leanings
 * (`readLeaningInputs`), so it is the only one a change could be heard on. As
 * `set_register`, a call from any other seat, or from no turn, is refused with
 * a reason the AI can speak past.
 *
 * ## The next reply changes
 *
 * The turn seam stamps a turn's leanings at claim, so the next turn reads the
 * new stop. The cached context block lists the dials (`leaning-context.ts`),
 * so it is dropped here. The platform's handler also drops it after any tool
 * call on a request that carries a context; this does not rely on that.
 *
 * @see lib/app/voice/leaning-change.ts — the result's shape, which the account reads
 * @see prisma/seeds/app-lelanea/025-set-leaning.ts — its row and grant
 */

import { z } from 'zod';

import { ConflictError } from '@/lib/api/errors';
import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import { invalidateContext } from '@/lib/orchestration/chat/context-builder';
import { logger } from '@/lib/logging';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { getLeanings, setLeaning } from '@/lib/app/voice/leanings-store';
import {
  LEANING_DIMENSIONS,
  LEANING_KEYS,
  LEANING_REST,
  type LeaningStop,
} from '@/lib/app/voice/leanings';
import {
  LEANING_CHANGE_HOWS,
  SET_LEANING_SLUG,
  type LeaningChange,
} from '@/lib/app/voice/leaning-change';
import { previousProposals } from '@/lib/app/voice/leaning-proposals';

export { SET_LEANING_SLUG } from '@/lib/app/voice/leaning-change';

/**
 * Where a call moves a leaning: one of its two poles, in the pole's own words,
 * or rest. Named rather than "left"/"right": the smoke showed the pinned model
 * saying "more concise" while sending `left`, which on `length` is "Verbose and
 * exploratory". A pole's words cannot be read backwards.
 */
const POLES = LEANING_DIMENSIONS.flatMap((dimension) => [dimension.left, dimension.right]);
const TOWARD: readonly string[] = [...POLES, 'rest'];

/**
 * What the model is told the tool is. Kept in step with the seed's literal by
 * `tests/unit/prisma/seeds/app-lelanea/set-leaning.test.ts`, and with the
 * migration's by `tests/unit/prisma/migrations/set-leaning-capability.test.ts`.
 */
export const SET_LEANING_DEFINITION: CapabilityFunctionDefinition = {
  name: SET_LEANING_SLUG,
  description:
    'Change one of the person’s lasting leanings: how your voice leans for them from now on, the same dials they have in Settings. Two ways, and only these. (1) They ask in their own words for a lasting change ("be plainer with me", "you can be more direct with me"): call it then, with how: asked. (2) You notice a pattern they have not named: call it with how: proposed, which changes nothing and only records the proposal, and put it to them in one sentence: what you noticed, and what you would change. Then wait. Only if they say yes in their next message, call it again with how: agreed, the same leaning and the same pole. Never change a leaning on your own inference. Each call moves one leaning one stop toward a pole, or back to rest. This is not set_register: "be gentle with me today" is today’s lean, and that is set_register; a lasting setting is this. Then answer them as they asked.',
  parameters: {
    type: 'object',
    properties: {
      leaning: {
        type: 'string',
        enum: [...LEANING_KEYS],
        description: `Which leaning, with its two poles: ${LEANING_DIMENSIONS.map(
          (dimension) => `${dimension.key} (${dimension.left} ↔ ${dimension.right})`
        ).join('; ')}.`,
      },
      toward: {
        type: 'string',
        enum: [...TOWARD],
        description:
          'One of the two poles of that leaning, exactly as written there, to move it one stop toward that pole; or rest, to put it back to her voice unshaded.',
      },
      how: {
        type: 'string',
        enum: [...LEANING_CHANGE_HOWS],
        description:
          'asked: they asked for this change themselves, without you suggesting it. proposed: you are suggesting it; nothing changes. agreed: you proposed it in your last reply, and they have just said yes.',
      },
    },
    required: ['leaning', 'toward', 'how'],
  },
};

// Strict: the arguments name a dial and a direction, never a person.
const argsSchema = z.strictObject({
  leaning: z.enum(LEANING_KEYS),
  toward: z.string().refine((value) => TOWARD.includes(value), 'not a pole, or rest'),
  how: z.enum(LEANING_CHANGE_HOWS),
});
type SetLeaningArgs = z.infer<typeof argsSchema>;

/** The seat and turn the turn seam stamped on this dispatch, or null when it came from no turn. */
function turnOf(context: CapabilityContext): { seat: string; turnId: string } | null {
  const parsed = z
    .object({ seat: z.string(), turnId: z.string() })
    .safeParse(context.costLogMetadata);
  return parsed.success ? parsed.data : null;
}

/** One stop from `from` toward a side, or rest. Never past ±2; the bounds clamp after. */
function stepped(from: LeaningStop, toward: 'left' | 'right' | 'rest'): LeaningStop {
  if (toward === 'rest') return LEANING_REST;
  const next = from + (toward === 'left' ? -1 : 1);
  return Math.max(-2, Math.min(2, next)) as LeaningStop;
}

/** Drop the person's cached context block on the seat. Never throws. */
function dropContext(userId: string): void {
  try {
    invalidateContext(FACILITATION_CONTEXT_TYPE, CONVERSATION_SEAT, { userId });
  } catch (err) {
    logger.warn('set_leaning: could not drop the cached context', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * What the AI is told back: the change, and on a proposal what to do next, at
 * the moment it is deciding what to say. The account reads the change and
 * ignores the rest.
 */
type SetLeaningResult = LeaningChange & { next?: string };

export class SetLeaningCapability extends BaseCapability<SetLeaningArgs, SetLeaningResult> {
  readonly slug = SET_LEANING_SLUG;
  readonly functionDefinition = SET_LEANING_DEFINITION;
  protected readonly schema = argsSchema;
  /** A dial, a direction and two stops: nothing personal passes through. */
  readonly processesPii = false;

  async execute(
    args: SetLeaningArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<SetLeaningResult>> {
    if (context.userId === null) {
      return this.error('There is no person to remember this for.', 'no_person');
    }
    const turn = turnOf(context);
    if (turn?.seat !== CONVERSATION_SEAT) {
      return this.error(
        'Leanings can only be changed in the main conversation, not here. Answer the person as you are.',
        'wrong_seat'
      );
    }
    const userId = context.userId;

    try {
      const view = await getLeanings(userId);
      if (!view.configured) {
        return this.error(
          'Leanings cannot be changed just now. Tell the person, and answer them as they asked anyway.',
          'leanings_unavailable'
        );
      }
      const dial = view.dials.find((d) => d.key === args.leaning);
      // Unreachable: the view lists every key, and the schema allows only those.
      if (!dial) return this.error('There is no such leaning.', 'unknown_leaning');
      if (dial.locked) {
        return this.error(
          'This leaning stays where Lelañea keeps it and cannot be moved. Tell the person so, plainly, and answer them as well as you can.',
          'leaning_locked'
        );
      }
      if (args.how !== 'asked' && !dial.suggest) {
        return this.error(
          'This leaning is not one to suggest, so nothing was changed. If the person wants it, they can ask for it, or set it in Settings.',
          'not_suggestable'
        );
      }

      const side =
        args.toward === 'rest'
          ? 'rest'
          : args.toward === dial.left
            ? 'left'
            : args.toward === dial.right
              ? 'right'
              : null;
      if (side === null) {
        return this.error(
          `"${args.toward}" is not a pole of ${dial.key}. Its poles are "${dial.left}" and "${dial.right}".`,
          'wrong_pole'
        );
      }

      const from = dial.position;
      // Inside the dial's bounds, as the view reports them (rest always is).
      const to = Math.min(Math.max(stepped(from, side), dial.min), dial.max) as LeaningStop;

      if (args.how === 'proposed') {
        // Recorded by being answered: the trace of this call is the proposal
        // an "agreed" next turn is checked against. Nothing is written. The
        // cached block is dropped so the next turn's names it as awaiting.
        if (to === from) {
          return this.error(
            'That leaning is already as far as it goes that way, so there is nothing to propose.',
            'nothing_to_propose'
          );
        }
        dropContext(userId);
        return this.success({
          leaning: args.leaning,
          from,
          to,
          how: 'proposed',
          next: 'Nothing has changed. Ask them, in one sentence, whether they would like this. Change it only if they say yes, in their next message, with how: agreed.',
        });
      }

      if (args.how === 'agreed') {
        const proposals = await previousProposals(userId, turn.seat, turn.turnId);
        const matching = proposals.some(
          // From where it was proposed, too: a dial moved in Settings since
          // could otherwise reach the same stop from the other side.
          (proposal) =>
            proposal.leaning === args.leaning && proposal.from === from && proposal.to === to
        );
        if (!matching) {
          return this.error(
            'Nothing was changed: agreed is only for a yes to a change your last reply proposed, and it did not propose this one. If the person’s own words ask for this change, call again now with how: asked. If you are suggesting it, use how: proposed and ask them.',
            'no_proposal'
          );
        }
      }

      if (to !== from) {
        await setLeaning({
          userId,
          key: args.leaning,
          stop: to,
          via: args.how,
          ...(context.conversationId
            ? { provenance: { conversationId: context.conversationId } }
            : {}),
        });
        dropContext(userId);
      }
      return this.success({ leaning: args.leaning, from, to, how: args.how });
    } catch (err) {
      if (err instanceof ConflictError) {
        // Locked or unreadable bounds, decided by the store between our read and
        // its write. Either way nothing was written.
        return this.error(
          'This leaning cannot be changed just now. Tell the person, and answer them as they asked anyway.',
          'not_recorded'
        );
      }
      logger.error('set_leaning: the leaning could not be recorded', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.error(
        'This could not be remembered just now. Answer the person as they asked anyway.',
        'not_recorded'
      );
    }
  }
}
