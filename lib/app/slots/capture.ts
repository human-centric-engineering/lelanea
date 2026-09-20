/**
 * Capture — she writes what she learns into the profile, once per turn
 * (f-slots t-72; product description §3.12, §8.1, §11).
 *
 * Daybreak's `fill_slot` does the writing: validation, the open-mode mint, the
 * per-agent exposure allowlist, sensitivity masking, the typed-value extraction
 * and the P2002 version retry are all its work and none of it is repeated here.
 * What this module adds is the one thing the framework cannot know about — that
 * two dispatches can belong to the **same turn**, because the turn id is ours.
 *
 * ## The double-write, and why the framework's own retry is not it
 *
 * `fill_slot` already "catches P2002 once and re-runs off the fresh head". That
 * is **concurrency** on `@@unique([userId, slotSlug, version])` — two appends
 * racing for the same version number, resolved by giving the loser the next one.
 * Appending a new version is exactly what it is for.
 *
 * The defect is one level up. A turn that fails after its tool calls is settled
 * `failed`, and the same turn id may run again (`lib/app/agent/turn-record.ts`).
 * The re-run calls the model from scratch on the same words, the model reaches
 * the same reading, and `fill_slot` appends a second version of it. The person
 * said one thing once; the profile records two readings, minutes apart, both
 * true and one of them spurious. §8.1: a retried turn cannot double-write the
 * profile.
 *
 * So the guard is keyed on the turn, and the unique index is the guard — the
 * same shape as the turn claim itself, for the same reason: two dispatches
 * cannot both miss a row neither of them can insert twice. A suppressed call
 * answers with the version that **was** written rather than an error, because
 * the reading is recorded, which is what the model asked for.
 *
 * ## Where the turn id comes from, and why that is worth a paragraph
 *
 * `CapabilityContext` has no turn id: Sunrise's chat handler does not model a
 * turn, and the reconciliation at claim recorded that as gap 4's other half.
 * But the handler DOES thread `request.costLogMetadata` into the dispatch
 * context (`streaming-handler.ts`, the `dispatchContext` literal), the
 * dispatcher shallow-copies the context before `execute()` so it survives, and
 * `lib/app/agent/turns.ts` already puts `{ turnId, seat }` there on every turn
 * she takes. The id is therefore reachable today, through a carrier declared for
 * something else.
 *
 * **That is a workaround and is read as one** (`fp5`: the shape transfers, the
 * justification does not). `costLogMetadata` is documented as "extra keys the
 * caller wants on this dispatch's `AiCostLog.metadata` row" — a cost-attribution
 * channel, typed `Record<string, unknown>`, which is why {@link turnIdFrom}
 * validates rather than casts and why an unusable value degrades to "no turn"
 * instead of throwing. A first-class turn/request id on the context is what
 * should exist, and is filed with the tier that owns the file (`daybreak.filing`)
 * as **sunrise#822** — the blobs for `types.ts`, `streaming-handler.ts` and
 * `dispatcher.ts` are identical across all three tiers, so Daybreak could not
 * have fixed it. Delete this paragraph and read the id off the context when
 * that lands.
 *
 * ## What is deliberately NOT guarded
 *
 * **Two `fill_slot` calls for the same slug inside one attempt.** Neither has
 * been recorded when the other starts, so both write and the framework's P2002
 * retry versions them. That is a model calling a tool twice in one tool loop,
 * not a retried turn, and collapsing it here would silently drop a second
 * reading the model meant as a correction. `fp6`: the assertion that would fail
 * is written against the retry, because the retry is the defect.
 *
 * **A dispatch with no turn id at all** — a workflow step, an MCP call, the
 * general consumer chat route (`.context/app/agent.md`, "Where else she can be
 * reached"). It runs unguarded, exactly as it did before this existed. Failing
 * closed there would refuse every write on paths the turn seam never reaches;
 * the guard's job is to stop a SECOND write, and without a turn id there is no
 * "second" to recognise.
 *
 * @see lib/app/capabilities.ts — where this is mounted over the framework's
 * @see .context/app/slots.md — "Capture"
 */

import { z } from 'zod';

import { logger } from '@/lib/logging';
import { prisma } from '@/lib/db/client';
import { FillSlotCapability } from '@/lib/framework/data-slots/capabilities/fill-slot';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

/** The framework's own argument and result types, which it does not export. */
type FillSlotArgs = Parameters<FillSlotCapability['execute']>[0];
type FillSlotResult = Awaited<ReturnType<FillSlotCapability['execute']>>;

/**
 * The turn id, out of the cost-attribution carrier the chat handler threads.
 *
 * Validated, never cast: the field is `Record<string, unknown>` and anything may
 * put keys on it. A missing, non-string or empty value is "no turn" — the
 * honest reading, and the one that leaves an unguarded dispatch behaving as it
 * always did.
 */
const turnCarrierSchema = z.object({ turnId: z.string().min(1) });

export function turnIdFrom(context: CapabilityContext): string | null {
  const parsed = turnCarrierSchema.safeParse(context.costLogMetadata);
  return parsed.success ? parsed.data.turnId : null;
}

/**
 * The framework's result, with `skipFollowup` dropped — so she still speaks.
 *
 * **Measured, not reasoned about.** `fill_slot` sets `skipFollowup` so a silent
 * capture does not cost a second model pass, which is right for an agent that
 * answers *and* captures in one pass. Her instruction tells her to record
 * before she answers, and the pinned model obliges literally: a first pass
 * carrying nothing but tool calls. With the follow-up skipped, that pass IS the
 * turn — she records what the person told her and replies with an empty string.
 * Observed on a real turn against the dev database, not predicted.
 *
 * Letting the follow-up run costs one extra model call on any turn she captures
 * in. That is the cost the owner accepted at claim — *"each write also adds a
 * tool pass to her turn"* — and the alternative is a person who confides
 * something and is answered with silence.
 *
 * **Not fixed in the instruction instead.** "Answer in the same breath as you
 * record" would make the turn's correctness depend on a model choosing to emit
 * text alongside a tool call, which is exactly the kind of thing that holds
 * until a model changes. This holds whatever it emits.
 *
 * **Unconditional, and applied on every return** — the guarded write, the
 * suppressed retry, and the two unguarded paths alike. A pass that ends on a
 * `fill_slot` result strands the turn whatever that result SAYS, so exempting
 * refusals would leave the same silence behind a rarer door. The framework does
 * not set the flag on an error today; this does not depend on that staying
 * true.
 */
function answering(result: FillSlotResult): FillSlotResult {
  if (!('skipFollowup' in result)) return result;
  const { skipFollowup: _skipped, ...rest } = result;
  return rest;
}

/** What this turn already wrote for a slug, or null. */
export interface RecordedSlotWrite {
  version: number;
  minted: boolean;
}

/**
 * The turn's row id, and what it has already written for this slug — in one
 * query, because the insert needs the row id anyway.
 *
 * Null when no turn row matches. The `userId` is part of the lookup rather than
 * checked afterwards: a turn id is unique per person, never globally, so a
 * lookup on the id alone could reach another person's turn.
 */
async function readTurnWrite(
  userId: string,
  turnId: string,
  slotSlug: string
): Promise<{ id: string; written: RecordedSlotWrite | null } | null> {
  const turn = await prisma.appTurn.findUnique({
    where: { userId_turnId: { userId, turnId } },
    select: {
      id: true,
      slotWrites: {
        where: { slotSlug },
        select: { version: true, minted: true },
      },
    },
  });
  if (turn === null) return null;
  const [written] = turn.slotWrites;
  return { id: turn.id, written: written ?? null };
}

/**
 * `fill_slot`, guarded so one turn writes a slot once.
 *
 * Mounted over Daybreak's under the same slug, the way
 * `LabelledSearchKnowledgeCapability` is mounted over Sunrise's search: the
 * schema, the function definition the model is shown, and the redaction policy
 * are all inherited unchanged, so nothing about what the model may call or what
 * lands in the audit row moves. Only `execute()` is wrapped.
 */
export class GuardedFillSlotCapability extends FillSlotCapability {
  /**
   * The framework's redaction, re-declared — and it has to be re-declared.
   *
   * `capabilityDispatcher.register()` refuses any `processesPii` capability
   * whose redactor it cannot see, and `isRedactorOverridden()` asks
   * `hasOwnProperty` of the **immediate** prototype. An inherited redactor does
   * not satisfy it. That is deliberate upstream (the dispatcher's own docblock
   * calls the own-property check the thing "that lets a fork avoid wrapping a
   * capability"): a subclass touching a PII path is made to say what it does
   * about redaction rather than inherit an answer by accident.
   *
   * **And the refusal is silent.** The throw is caught by the registration
   * pass, logged as an `UnknownError`, and the slug is simply absent from the
   * dispatcher — so she would have gone on searching normally and quietly never
   * captured anything. Nothing in this file would have failed; what caught it
   * was the `lib/app/capabilities.ts` row in `tests/unit/lib/app/defaults.test.ts`
   * asserting the handler the dispatcher ACTUALLY holds for the slug.
   *
   * Delegating is the correct answer here, not a shortcut. This subclass adds
   * no argument and no result field — the guard changes when `execute()` runs,
   * never what it returns — so the parent's policy is still exactly right: the
   * value and reasoning note masked, a minted slug masked, a vetted targeted
   * slug kept. Re-implementing it would be a second copy to keep in step
   * (`HB7`).
   */
  redactProvenance(
    args: Parameters<FillSlotCapability['redactProvenance']>[0],
    result: Parameters<FillSlotCapability['redactProvenance']>[1]
  ): ReturnType<FillSlotCapability['redactProvenance']> {
    return super.redactProvenance(args, result);
  }

  async execute(args: FillSlotArgs, context: CapabilityContext): Promise<FillSlotResult> {
    const turnId = turnIdFrom(context);
    if (turnId === null || context.userId === null) {
      // No turn to be the second attempt of. See "What is deliberately NOT
      // guarded" — and note the framework refuses a null `userId` itself, with
      // its own message, which is why that case falls through rather than
      // answering here.
      return answering(await super.execute(args, context));
    }

    const turn = await readTurnWrite(context.userId, turnId, args.slotSlug);
    if (turn === null) {
      // A turn id the record does not know: a client id on a path that never
      // claimed a turn. Unguarded, not refused.
      return answering(await super.execute(args, context));
    }

    if (turn.written !== null) {
      logger.info('fill_slot: this turn already wrote this slot; left as it is', {
        // No slug: a minted one is model-authored free text that can encode what
        // the person said, and durable app logs are not erasure-covered. The
        // same reasoning as the framework's own mint log.
        agentId: context.agentId,
        turnId,
        version: turn.written.version,
      });
      // No `skipFollowup` — see `answering()`. A suppressed write must leave
      // the turn in exactly the state a real one does, or a retry would be the
      // one attempt that came back silent.
      return this.success({
        slotSlug: args.slotSlug,
        version: turn.written.version,
        minted: turn.written.minted,
      });
    }

    const result = answering(await super.execute(args, context));
    if (!result.success || !result.data) return result;

    // Recorded AFTER the write, so a failed append leaves nothing claiming to
    // have happened. The window between them is a process death mid-dispatch,
    // which loses the tool result too — the model is never told the write
    // landed, so the turn it belongs to has no reading to double.
    await prisma.appTurnSlotWrite
      .create({
        data: {
          turnId: turn.id,
          slotSlug: result.data.slotSlug,
          version: result.data.version,
          minted: result.data.minted,
        },
      })
      .catch((err: unknown) => {
        // Never fails the turn. The write landed and the person's profile is
        // right; what is lost is the guard for a retry that may not happen.
        // P2002 is the ordinary case — two calls for one slug inside one
        // attempt, which this deliberately does not collapse.
        logger.warn('fill_slot: the turn wrote a slot but the guard row was not recorded', {
          agentId: context.agentId,
          turnId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return result;
  }
}
