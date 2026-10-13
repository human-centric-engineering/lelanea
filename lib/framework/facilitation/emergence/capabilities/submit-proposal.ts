/**
 * `submit_proposal` (f-governance-plus t-2, spec §5.5 F17) — the emergence gate's **authoring**
 * capability. f-emergence shipped the propose → approve → apply pipeline but left proposals
 * human/API-authored only; this lets an AGENT write one. It is the write counterpart to
 * f-guidance's `request_transition`, but where that asks the engine to move a user's journey, this
 * asks the governance gate to consider a structure change — it stores a **pending** proposal for
 * human approval, never applying the change itself (the downstream admin approve/publish is the
 * real gate, so `requiresApproval` stays false on this tool — the DB default).
 *
 * One polymorphic tool over all three subjects (`map` | `module_config` | `policy`): the arguments
 * carry `subjectType` + the target's `subjectId` + an opaque `proposedDefinition`, and ALL
 * shape-validation is delegated to the pipeline (`validateProposal`, run inside the service) — a bad
 * definition / unknown target comes back as a structured `ValidationError`/`NotFoundError`, surfaced
 * to the agent as a clean capability error so it can narrate why rather than crash.
 *
 * Authorship (F17): `createdBy = "agent:<slug>"` resolved from the calling agent, preserved on the
 * proposal row; `actorUserId` is the end user whose conversation drove it (the audit actor). Not
 * `processesPii` — the arguments are a subject id + a config/definition, no user PII.
 */

import { z } from 'zod';
import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import { isEmbedUserId } from '@/lib/embed/auth';
import type { ProvenanceRedaction } from '@/lib/orchestration/capabilities/base-capability';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import { prisma } from '@/lib/db/client';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { submitStructureChangeProposal } from '@/lib/framework/facilitation/emergence/proposal-service';
import { formatAgentAuthor } from '@/lib/framework/facilitation/emergence/author';
import { PROPOSAL_SUBJECT_TYPES } from '@/lib/framework/facilitation/emergence/pipeline';

const submitProposalSchema = z
  .object({
    subjectType: z.enum(PROPOSAL_SUBJECT_TYPES),
    subjectId: z.string().min(1).max(200),
    proposedDefinition: z.unknown(),
  })
  // A `z.unknown()` field is optional in a Zod object — a call omitting `proposedDefinition` would
  // otherwise pass validation with it `undefined` (e.g. blanking a module config to its schema
  // defaults). Enforce the presence the `required` contract declares; the VALUE is still opaque
  // (the pipeline validates its shape per subject).
  .refine((v) => v.proposedDefinition !== undefined, {
    message: 'proposedDefinition is required',
    path: ['proposedDefinition'],
  });
type SubmitProposalArgs = z.infer<typeof submitProposalSchema>;

interface SubmitProposalData {
  /** The stored proposal's id (surfaced so the agent can reference it). */
  proposalId: string;
  /** Its status — `pending` (awaits human approval; auto-approval is inert in v1). */
  status: string;
  subjectType: string;
  subjectId: string;
}

export class SubmitProposalCapability extends BaseCapability<
  SubmitProposalArgs,
  SubmitProposalData
> {
  readonly slug = 'submit_proposal';

  readonly functionDefinition: CapabilityFunctionDefinition = {
    name: 'submit_proposal',
    description:
      'Propose a structure change for human review — a new map definition, module configuration, or facilitation policy payload. This does NOT apply the change; it records a pending proposal that an admin must approve. subjectId names the EXISTING target (a map/graph slug, a module slug, or a policy id) and proposedDefinition is the full new content for that subject. Use only when a deliberate change to the facilitation structure is warranted.',
    parameters: {
      type: 'object',
      properties: {
        subjectType: {
          type: 'string',
          description:
            "What kind of thing to change: 'map' (a journey map/graph), 'module_config' (a module's configuration), or 'policy' (a facilitation policy).",
          enum: [...PROPOSAL_SUBJECT_TYPES],
        },
        subjectId: {
          type: 'string',
          description:
            'The existing target: a map/graph slug, a module slug, or a policy id — depending on subjectType.',
          minLength: 1,
          maxLength: 200,
        },
        proposedDefinition: {
          description:
            'The full proposed content for the subject: a map definition, a module config value, or a policy payload. Validated server-side against the subject.',
        },
      },
      required: ['subjectType', 'subjectId', 'proposedDefinition'],
    },
  };

  protected readonly schema = submitProposalSchema;

  readonly processesPii = false;

  /**
   * `proposedDefinition` is an unbounded, model-authored blob (a whole map/config/policy payload,
   * possibly carrying conversation-derived text) and is already persisted in full on the proposal
   * row. Keep it OUT of the durable message-provenance trace: record only which subject was targeted
   * (plus the small result). This is a provenance-hygiene decision, not a PII claim — the arguments
   * are structural, so `processesPii` stays false; the override just avoids duplicating a large,
   * separately-stored, separately-erasable payload onto every authoring call's audit row.
   */
  redactProvenance(
    args: SubmitProposalArgs,
    result: CapabilityResult<SubmitProposalData>
  ): ProvenanceRedaction {
    return {
      args: {
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        proposedDefinition: '[omitted — stored on the proposal row]',
      },
      resultPreview: JSON.stringify(result),
    };
  }

  async execute(
    args: SubmitProposalArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<SubmitProposalData>> {
    // An anonymous embed widget visitor (not a `User`, Sunrise #705, t-765) is refused outright.
    // A signed-in user's proposal is attributed to them (`actorUserId`), and a system run's comes
    // from an operator's own schedule or workflow; a visitor's would be attributed to no one, so
    // anyone on the internet could fill the review queue with proposals nobody can trace.
    if (isEmbedUserId(context.userId)) {
      return this.error(
        'Structure proposals are unavailable to anonymous embed widget visitors.',
        'anonymous_visitor'
      );
    }

    // Resolve the calling agent's slug for authorship (`agent:<slug>`, F17).
    const agent = await prisma.aiAgent.findUnique({
      where: { id: context.agentId },
      select: { slug: true },
    });
    if (!agent) {
      return this.error('The authoring agent could not be resolved', 'no_agent');
    }

    try {
      const proposal = await submitStructureChangeProposal({
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        proposedDefinition: args.proposedDefinition,
        createdBy: formatAgentAuthor(agent.slug),
        actorUserId: context.userId,
      });
      return this.success({
        proposalId: proposal.id,
        status: proposal.status,
        subjectType: proposal.subjectType,
        subjectId: proposal.subjectId,
      });
    } catch (err) {
      // A bad definition / unknown target is a normal outcome the agent should be able to narrate —
      // return it as a structured capability error rather than letting the dispatcher normalise an
      // opaque `execution_error`. Unexpected errors propagate (the dispatcher wraps them).
      if (err instanceof ValidationError) {
        return this.error(err.message, 'invalid_proposal');
      }
      if (err instanceof NotFoundError) {
        return this.error(err.message, 'subject_not_found');
      }
      throw err;
    }
  }
}
