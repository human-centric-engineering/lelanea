/**
 * `record_feedback` capability (f-engagement t-2, spec §4.3) — a built-in framework tool
 * any bound agent can call to capture a user's rating (+ optional comment) of the module
 * they're in. Feedback rides the shared engagement stream as a `module.feedback` event
 * (there is no core feedback table — `AiMessage.rating` is a per-message thumbs scalar,
 * the wrong grain), so the stats read side (t-3) aggregates it like any other event.
 *
 * **Module attribution is `context.scope.moduleSlug`, never an argument.** The surface
 * chat route sets `scope.moduleSlug` (X5); reading it from scope keeps the attribution
 * trustworthy. An explicit `moduleSlug` arg would let a mis-scoped (or adversarially
 * prompted) agent record feedback against an arbitrary module, so it is deliberately
 * omitted — the plain feedback API (`POST …/modules/[slug]/feedback`) is the sanctioned
 * "explicit module" path, authenticated and scoped by its own URL. A call outside a
 * module scope is refused, not silently mis-attributed.
 *
 * Writes the caller's own feedback (`caller.userId`), so there is no cross-user write.
 */

import { z } from 'zod';
import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import { checkUserCaller } from '@/lib/framework/shared/caller';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import { redactedString } from '@/lib/security/redact';
import { decodeScope } from '@/lib/framework/shared/scope';
import { recordModuleEngagement } from '@/lib/framework/engagement/record-engagement';
import { ENGAGEMENT_EVENT_TYPE } from '@/lib/framework/engagement/vocabulary';

const recordFeedbackSchema = z.object({
  /** 1 (worst) to 5 (best). */
  rating: z.number().int().min(1).max(5),
  /** Optional free-text comment. */
  comment: z.string().min(1).max(2000).optional(),
});
type RecordFeedbackArgs = z.infer<typeof recordFeedbackSchema>;

interface RecordFeedbackData {
  recorded: boolean;
}

export class RecordFeedbackCapability extends BaseCapability<
  RecordFeedbackArgs,
  RecordFeedbackData
> {
  readonly slug = 'record_feedback';
  readonly processesPii = true;

  readonly functionDefinition: CapabilityFunctionDefinition = {
    name: 'record_feedback',
    description:
      "Record the user's feedback on this module: a 1–5 rating and an optional short comment. Use it when the user expresses satisfaction or a rating about the current module.",
    parameters: {
      type: 'object',
      properties: {
        rating: {
          type: 'integer',
          description: "The user's rating of the module, 1 (worst) to 5 (best).",
          minimum: 1,
          maximum: 5,
        },
        comment: {
          type: 'string',
          description: "The user's optional comment, in their own words.",
          minLength: 1,
          maxLength: 2000,
        },
      },
      required: ['rating'],
    },
  };

  protected readonly schema = recordFeedbackSchema;

  /**
   * The free-text `comment` is user-authored PII (it can name people, health, anything),
   * so it is masked in the durable audit row; the numeric `rating` is not PII and stays so
   * an auditor sees the shape. The result carries no user data.
   */
  redactProvenance(
    args: RecordFeedbackArgs,
    result: CapabilityResult<RecordFeedbackData>
  ): { args: unknown; resultPreview: string } {
    const safeArgs = {
      ...args,
      ...(args.comment !== undefined ? { comment: redactedString('feedback-comment') } : {}),
    };
    return { args: safeArgs, resultPreview: JSON.stringify(result) };
  }

  async execute(
    args: RecordFeedbackArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<RecordFeedbackData>> {
    const caller = checkUserCaller(context, 'Feedback capture');
    if (!caller.ok) return this.error(caller.message, caller.code);

    // Module attribution comes from the trusted surface scope, never an argument.
    const { moduleSlug } = decodeScope(context.scope);
    if (moduleSlug === undefined) {
      return this.error(
        'Feedback can only be recorded from within a module conversation.',
        'no_module_scope'
      );
    }

    await recordModuleEngagement({
      userId: caller.userId,
      moduleSlug,
      type: ENGAGEMENT_EVENT_TYPE.moduleFeedback,
      payload: {
        rating: args.rating,
        ...(args.comment !== undefined ? { comment: args.comment } : {}),
      },
    });

    return this.success({ recorded: true });
  }
}
