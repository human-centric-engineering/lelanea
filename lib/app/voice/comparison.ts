/**
 * Two arms, the same questions, and a refusal to run them if they are the same arm twice.
 *
 * A voice fingerprint is tuned by editing prose, and prose edits have no
 * compiler. Change a clause in the core to fix one awkward reply and three other
 * replies quietly get worse — nothing fails, nothing is logged, and there is no
 * way to notice except by reading everything again. This module is the part of
 * the remedy that can be built: it queues the fixed golden set through her
 * assembled prompt path AND through a bare model, over the same cases, with each
 * side's answers attached to the words that produced them.
 *
 * ## What is Sunrise's, and what is ours (`fp1`)
 *
 * Sunrise ships the whole harness — `AiDataset`, `AiEvaluationRun`,
 * `AiEvaluationCaseResult`, a lease-claiming worker that drains a run on the
 * maintenance tick, and judge agents to score one. **None of that is
 * reimplemented here.** What the platform has no notion of is an *arm*: a run
 * records which agent answered and nothing about which version of her voice that
 * agent was wearing, and `AiEvaluationRun` has no free column to put it in. So
 * this module queues two ordinary platform runs and records the missing half in
 * `AppVoiceComparison` / `AppVoiceComparisonArm`.
 *
 * ## The bare arm matters as much as the fingerprint arm
 *
 * Running only the assembled path tells you an output exists, not that the
 * fingerprint did anything. The control is a second agent with no profile, whose
 * entire system prompt is the authored `control.systemInstructions` from
 * `content/lelanea_voice_golden_set.json` — readable, and hers to change,
 * exactly like the core it is being compared against.
 *
 * ## The guard, and why it is the load-bearing thing in this file (`fp6`)
 *
 * The failure this exists to prevent is not a crash. It is a comparison that
 * runs the bare model twice — a detached profile, a seed that never ran, an
 * operator who pinned a different model on one of the two agents — and then
 * reports two similar-looking walls of text as evidence that the fingerprint
 * changed nothing. Every one of those states is reachable through the admin UI,
 * and none of them errors.
 *
 * So {@link assertArmsComparable} composes **both** system prompts before
 * anything is queued and refuses unless all of the following hold:
 *
 * | Check | The misconfiguration it catches |
 * | --- | --- |
 * | the fingerprint arm's prompt carries a version marker | the profile came detached from her agent |
 * | the bare arm's prompt carries none | somebody pointed the control at her profile |
 * | the two prompts differ | both arms are the same agent, or the same text |
 * | provider, model and temperature match | the comparison is silently a model comparison |
 *
 * Each refusal names the arm and the remedy (`HB10`), because "arms are not
 * comparable" on its own is a diagnosis rather than a mechanism.
 *
 * ## What this cannot check, stated rather than left to be found
 *
 * **The runs exercise the CORE, not the overlays or the exemplars.** Sunrise's
 * subject-case runner (`lib/orchestration/evaluations/run-cases/agent-case.ts`)
 * calls `drainStreamChat` with no `contextType` / `contextId`, so no prompt-
 * context contributor fires on an evaluation turn — including ours. The golden
 * set therefore hears layer one of the fingerprint, which is also the layer the
 * retrieval-empty case is there to prove. Layers two and three are not covered
 * by this, and no configuration here can cover them: the blob is identical in
 * all three tiers, so it is a Sunrise gap rather than anything a leaf or the
 * framework can close. Recorded in `.context/app/voice.md`.
 *
 * **Whether an answer reads as her is hers to say.** This ships the set, both
 * arms, and the surface that makes the judgement cheap to make. It does not make
 * the judgement (`fp3b`).
 *
 * @see lib/app/voice/comparison-admin.ts — the reads behind the surface
 * @see prisma/seeds/app-lelanea/004-voice-golden-set.ts — the dataset and the control agent
 * @see .context/app/voice.md
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { ValidationError } from '@/lib/api/errors';
import { logger } from '@/lib/logging';
import { getVoiceGoldenSet } from '@/lib/app/content';
import { readFingerprintVersion } from '@/lib/app/voice/fingerprint';
import {
  BRAND_VOICE_JUDGE_SLUG,
  VOICE_ARMS,
  VOICE_ARM_AGENT_SLUGS,
  VOICE_ARM_LABELS,
  goldenSetDatasetId,
  isVoiceArm,
  type VoiceArm,
} from '@/lib/app/voice/golden-set';
import {
  composeSystemPromptString,
  resolveEffectivePrompt,
  type FieldMode,
} from '@/lib/orchestration/agents/resolve-effective-prompt';
import { noteMaintenanceWork } from '@/lib/orchestration/maintenance/idle-gate';

/** One arm, composed and ready to be queued. */
export interface ResolvedVoiceArm {
  arm: VoiceArm;
  agentId: string;
  agentSlug: string;
  /** The prompt this arm will actually run with. Stored whole — it is the evidence. */
  systemPrompt: string;
  /** Read back out of `systemPrompt`; `null` is the bare arm's correct answer. */
  fingerprintVersion: string | null;
  /** Pinned onto the judge's config for BOTH arms. See {@link queueVoiceComparison}. */
  brandVoiceInstructions: string | null;
  /** The binding the comparison must hold constant across arms. */
  binding: { provider: string; model: string; temperature: number };
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** Everything an arm needs, in one query per agent. */
export const AGENT_SELECT = {
  id: true,
  slug: true,
  isActive: true,
  provider: true,
  model: true,
  temperature: true,
  systemInstructions: true,
  persona: true,
  guardrails: true,
  brandVoiceInstructions: true,
  personaMode: true,
  voiceMode: true,
  guardrailsMode: true,
  profile: {
    select: {
      id: true,
      name: true,
      persona: true,
      guardrails: true,
      brandVoiceInstructions: true,
    },
  },
} satisfies Prisma.AiAgentSelect;

/**
 * The remedy named on every refusal.
 *
 * Both arms' rows come from one seed unit, and the runner skips a unit whose
 * content hash has not changed — so a row that drifted underneath the seed is
 * precisely the case where re-running `db:seed` alone does nothing. The history
 * row has to go first. Stated here once, because a guard that says what is wrong
 * without saying what to do is advice rather than a mechanism (`HB10`).
 */
const RESEED_REMEDY =
  "Re-apply the seed: DELETE FROM seed_history WHERE name = 'app-lelanea/004-voice-golden-set'; then `npm run db:seed`.";

/**
 * Compose one arm: resolve the agent's effective prompt against its profile, and
 * read the fingerprint version back out of the result.
 *
 * The version is read from the COMPOSED PROMPT rather than from the content file
 * or the profile row, and that is the whole reason this function exists. Reading
 * it from the file would answer "which version is authored"; reading it here
 * answers "which version is this agent about to be told", which is the only one
 * an output can honestly be attributed to. An arm whose profile came detached
 * therefore reports `null` instead of confidently reporting the authored
 * version.
 */
/**
 * Narrow a stored mode column to the union the resolver takes.
 *
 * The Prisma columns are `String`, so anything the database happens to hold
 * type-checks as a mode. `resolveEffectivePrompt` treats every value that is not
 * `'append'` as `'override'`, which is also its documented default for an unset
 * column — so this is the resolver's own rule, written once here rather than
 * cast away with `as` at the call site.
 */
function toFieldMode(value: string | null): FieldMode | null {
  return value === 'append' ? 'append' : value === 'override' ? 'override' : null;
}

/**
 * An agent's composed system prompt — its own columns resolved against its
 * profile, exactly as the chat handler will compose them.
 *
 * Exported for the turn record (`lib/app/agent/turn-record.ts`), which reads the
 * fingerprint version off a live turn's prompt for the same reason an arm does:
 * the version an output can honestly be attributed to is the one the agent is
 * about to be told, not the one the content file holds.
 */
export function composeAgentPrompt(
  agent: Prisma.AiAgentGetPayload<{ select: typeof AGENT_SELECT }>
): { resolved: ReturnType<typeof resolveEffectivePrompt>; systemPrompt: string } {
  const resolved = resolveEffectivePrompt(
    {
      systemInstructions: agent.systemInstructions,
      persona: agent.persona,
      guardrails: agent.guardrails,
      brandVoiceInstructions: agent.brandVoiceInstructions,
      personaMode: toFieldMode(agent.personaMode),
      voiceMode: toFieldMode(agent.voiceMode),
      guardrailsMode: toFieldMode(agent.guardrailsMode),
    },
    agent.profile
  );
  return { resolved, systemPrompt: composeSystemPromptString(resolved) };
}

function composeArm(
  arm: VoiceArm,
  agent: Prisma.AiAgentGetPayload<{ select: typeof AGENT_SELECT }>
): ResolvedVoiceArm {
  const { resolved, systemPrompt } = composeAgentPrompt(agent);

  return {
    arm,
    agentId: agent.id,
    agentSlug: agent.slug,
    systemPrompt,
    fingerprintVersion: readFingerprintVersion(systemPrompt),
    brandVoiceInstructions: resolved.brandVoiceInstructions,
    binding: {
      provider: agent.provider,
      model: agent.model,
      temperature: agent.temperature,
    },
  };
}

/**
 * Load and compose both arms.
 *
 * Does not validate — {@link assertArmsComparable} does, separately, so a caller
 * that only wants to SHOW an operator what each arm would be told (the surface's
 * preflight panel) can do so without an exception being the only way to learn
 * that something is wrong.
 */
export async function resolveVoiceArms(db: PrismaLike = prisma): Promise<ResolvedVoiceArm[]> {
  const agents = await db.aiAgent.findMany({
    where: { slug: { in: Object.values(VOICE_ARM_AGENT_SLUGS) } },
    select: AGENT_SELECT,
  });
  const bySlug = new Map(agents.map((agent) => [agent.slug, agent]));

  return VOICE_ARMS.map((arm) => {
    const agent = bySlug.get(VOICE_ARM_AGENT_SLUGS[arm]);
    if (!agent) {
      throw new ValidationError(
        `The ${VOICE_ARM_LABELS[arm]} arm has no agent: "${VOICE_ARM_AGENT_SLUGS[arm]}" is not in this install. ${RESEED_REMEDY}`
      );
    }
    if (!agent.isActive) {
      throw new ValidationError(
        `The ${VOICE_ARM_LABELS[arm]} arm's agent "${agent.slug}" is inactive, so its half of the comparison would fail every case. Activate it in /admin/orchestration/agents.`
      );
    }
    return composeArm(arm, agent);
  });
}

/**
 * Refuse a comparison whose two arms are not actually two arms.
 *
 * Throws on the first thing wrong rather than collecting every complaint: the
 * checks are ordered from most to least likely to be the root cause, and a
 * missing version marker explains a prompt collision that a combined message
 * would report as two independent faults.
 *
 * Exported and pure so the surface can call it on the same objects it renders,
 * and so `tests/unit/lib/app/voice/comparison.test.ts` can reach every branch
 * without a database — which is what keeps the guard from being decoration.
 */
export function assertArmsComparable(arms: readonly ResolvedVoiceArm[]): void {
  const byArm = new Map(arms.map((entry) => [entry.arm, entry]));
  const fingerprint = byArm.get('fingerprint');
  const bare = byArm.get('bare');

  if (!fingerprint || !bare || arms.length !== VOICE_ARMS.length) {
    throw new ValidationError(
      `A comparison needs exactly ${VOICE_ARMS.length} arms (${VOICE_ARMS.join(', ')}); got ${arms
        .map((entry) => entry.arm)
        .join(', ')}.`
    );
  }

  if (fingerprint.fingerprintVersion === null) {
    throw new ValidationError(
      `The ${VOICE_ARM_LABELS.fingerprint} arm's system prompt carries no fingerprint version, which means "${fingerprint.agentSlug}" is not carrying the voice profile — every answer it gives would be a bare answer filed as a voice answer. ${RESEED_REMEDY}`
    );
  }

  if (bare.fingerprintVersion !== null) {
    throw new ValidationError(
      `The ${VOICE_ARM_LABELS.bare} arm's system prompt carries fingerprint v${bare.fingerprintVersion}, so the control is carrying the voice profile too and the comparison would be the voice against itself. Detach the profile from "${bare.agentSlug}" in /admin/orchestration/agents.`
    );
  }

  if (fingerprint.systemPrompt === bare.systemPrompt) {
    throw new ValidationError(
      `Both arms would run the identical system prompt, so the comparison would report no difference no matter what the voice core says. Check that "${fingerprint.agentSlug}" and "${bare.agentSlug}" are different agents. ${RESEED_REMEDY}`
    );
  }

  // Not a purity check. Both agents are created unbound and then pinned to the
  // same provider and model by `005-agent-models.ts`, but that pin is
  // operator-owned and `SYSTEM_AGENT_PROTECTED_FIELDS` does not cover any of
  // these three — an operator can change the model on one agent through the
  // admin form, and from then on the comparison measures the models rather than
  // the fingerprint, with nothing on the screen saying so.
  const differing = (['provider', 'model', 'temperature'] as const).filter(
    (key) => fingerprint.binding[key] !== bare.binding[key]
  );
  if (differing.length > 0) {
    const detail = differing
      .map(
        (key) =>
          `${key}: ${JSON.stringify(fingerprint.binding[key])} vs ${JSON.stringify(bare.binding[key])}`
      )
      .join('; ');
    throw new ValidationError(
      `The two arms are bound to different models, so the run would compare the models rather than the voice (${detail}). Match them in /admin/orchestration/agents — the seed pins both arms to the same provider and model, and a change to one has to be made to the other.`
    );
  }
}

/** What a queued comparison reports back. */
export interface QueuedComparison {
  comparisonId: string;
  goldenSetVersion: string;
  caseCount: number;
  arms: Array<{
    arm: VoiceArm;
    agentSlug: string;
    fingerprintVersion: string | null;
    evaluationRunId: string;
  }>;
}

/**
 * Queue one comparison: two platform runs over the same dataset, and the rows
 * that say which arm each was.
 *
 * ## The judge is pinned to HER voice on both arms, deliberately
 *
 * Sunrise's own run-create route pins `subjectBrandVoice` from *the subject
 * agent's* `brandVoiceInstructions`, which for the control would be null — the
 * brand-voice judge would fall back to a generic rubric and score the bare arm
 * against nothing in particular. Both arms are pinned to the FINGERPRINT arm's
 * brand voice instead, because the question being asked of both is the same one:
 * *does this sound like her?* Scoring the control against its own absent voice
 * would produce a number that cannot be compared with the other arm's, which is
 * worse than no number.
 *
 * ## Everything lands together or not at all
 *
 * One transaction. A comparison row with one arm, or two runs with no arms
 * attributing them, is a state the surface has no honest way to render — and the
 * runs would drain anyway, spending real money on answers nothing could read
 * back.
 */
export async function queueVoiceComparison(queuedByUserId: string): Promise<QueuedComparison> {
  const goldenSet = getVoiceGoldenSet();

  const arms = await resolveVoiceArms();
  assertArmsComparable(arms);

  // Keyed on the AUTHORED version, so a comparison always runs the questions
  // currently in the tree rather than whichever dataset happened to be seeded
  // first. A version bump that has not been seeded yet lands here as a missing
  // dataset, which is the honest failure — the alternative is silently running
  // the previous version's questions and filing the answers under the new one.
  const datasetId = goldenSetDatasetId(goldenSet.collection.version);
  const dataset = await prisma.aiDataset.findUnique({
    where: { id: datasetId },
    select: { id: true, contentHash: true, caseCount: true },
  });
  if (!dataset || dataset.caseCount === 0) {
    throw new ValidationError(
      `The golden set v${goldenSet.collection.version} is not in this install (dataset "${datasetId}"${
        dataset ? ' exists but holds no cases' : ''
      }), so there is nothing to ask either arm. ${RESEED_REMEDY}`
    );
  }

  const judge = await prisma.aiAgent.findUnique({
    where: { slug: BRAND_VOICE_JUDGE_SLUG },
    select: { kind: true, isActive: true },
  });
  if (!judge || judge.kind !== 'judge' || !judge.isActive) {
    throw new ValidationError(
      `The brand-voice judge "${BRAND_VOICE_JUDGE_SLUG}" is ${
        judge ? 'not an active judge agent' : 'not in this install'
      }, so the comparison would come back unscored — two walls of text that look exactly like a scored comparison. It is a platform-seeded agent: run \`npm run db:seed\`, or re-activate it in /admin/orchestration/agents.`
    );
  }

  const fingerprintArm = arms.find((entry) => entry.arm === 'fingerprint');
  const metricConfigs = [
    {
      slug: 'judge_agent',
      config: {
        agentSlug: BRAND_VOICE_JUDGE_SLUG,
        // `assertArmsComparable` has already established the fingerprint arm
        // exists and carries a version; the fallback is for the type, not for a
        // reachable state.
        ...(fingerprintArm?.brandVoiceInstructions
          ? { subjectBrandVoice: fingerprintArm.brandVoiceInstructions }
          : {}),
      },
    },
  ];

  const result = await prisma.$transaction(async (tx) => {
    const comparison = await tx.appVoiceComparison.create({
      data: {
        goldenSetVersion: goldenSet.collection.version,
        datasetContentHash: dataset.contentHash,
      },
      select: { id: true },
    });

    const queued: QueuedComparison['arms'] = [];
    for (const arm of arms) {
      const run = await tx.aiEvaluationRun.create({
        data: {
          userId: queuedByUserId,
          name: `${goldenSet.dataset.name} · ${VOICE_ARM_LABELS[arm.arm]}`,
          description:
            arm.fingerprintVersion === null
              ? 'The control arm of a voice comparison: the same questions, a bare model, no fingerprint.'
              : `The assembled arm of a voice comparison, carrying fingerprint v${arm.fingerprintVersion}.`,
          subjectKind: 'agent',
          agentId: arm.agentId,
          datasetId: dataset.id,
          datasetContentHash: dataset.contentHash,
          metricConfigs,
          status: 'queued',
          progress: { casesTotal: dataset.caseCount, casesDone: 0, casesFailed: 0 },
        },
        select: { id: true },
      });

      await tx.appVoiceComparisonArm.create({
        data: {
          comparisonId: comparison.id,
          arm: arm.arm,
          agentSlug: arm.agentSlug,
          fingerprintVersion: arm.fingerprintVersion,
          systemPrompt: arm.systemPrompt,
          evaluationRunId: run.id,
        },
      });

      queued.push({
        arm: arm.arm,
        agentSlug: arm.agentSlug,
        fingerprintVersion: arm.fingerprintVersion,
        evaluationRunId: run.id,
      });
    }

    return {
      comparisonId: comparison.id,
      goldenSetVersion: goldenSet.collection.version,
      caseCount: dataset.caseCount,
      arms: queued,
    };
  });

  // Without this the runs sit queued for up to the idle gate's cap: the
  // evaluation worker only advances on a maintenance tick, and an armed gate
  // suppresses ticks (#442). Sunrise's own run-create route does the same thing
  // for the same reason.
  noteMaintenanceWork('voice-comparison-queued');

  logger.info('Voice comparison queued', {
    comparisonId: result.comparisonId,
    goldenSetVersion: result.goldenSetVersion,
    caseCount: result.caseCount,
    arms: result.arms.map((arm) => `${arm.arm}:${arm.fingerprintVersion ?? 'none'}`),
  });

  return result;
}

/** What a stop did, so the surface can say it rather than guess. */
export interface CancelledComparison {
  comparisonId: string;
  /** Arms whose run this call moved to `cancelled`. */
  cancelled: VoiceArm[];
  /** Arms already terminal — completed, failed, or cancelled by someone else. */
  alreadyFinished: VoiceArm[];
}

/**
 * Stop a comparison that is still draining.
 *
 * ## Why this exists rather than the operator cancelling two runs
 *
 * A comparison is two platform runs, and the platform's own cancel route takes
 * one run id. Cancelling one arm and not the other does not stop the spend — it
 * produces a comparison with a full column and a truncated one, which is the
 * shape of a real result rather than of an abandoned run. Whatever the reason
 * for stopping, it applies to both arms, so this is the unit that can be stopped.
 *
 * ## The platform does the stopping; this only flips the rows
 *
 * `run-worker.ts` re-reads `status` before each case and breaks out when it is
 * no longer `running`, and `markTerminal` / `releaseLease` are both guarded by a
 * `status: 'running'` predicate — so a tick already mid-case finishes that case,
 * writes it, and then exits, and can never revert the row to completed. Nothing
 * here needs to interrupt anything; setting the status IS the mechanism.
 *
 * ## An arm already finished is not an error
 *
 * The button is on a polling surface, so the honest race is somebody pressing
 * stop on the tick that the last case lands. Refusing the whole call in that
 * state would report a failure for a comparison that is simply already over.
 * Terminal arms are reported back as terminal and the rest are stopped.
 */
export async function cancelVoiceComparison(
  comparisonId: string,
  userId: string
): Promise<CancelledComparison> {
  const arms = await prisma.appVoiceComparisonArm.findMany({
    where: { comparisonId },
    select: { arm: true, evaluationRunId: true },
  });

  if (arms.length === 0) {
    throw new ValidationError(
      `No voice comparison "${comparisonId}" in this install, so there is nothing to stop.`
    );
  }

  const runIds = arms
    .map((entry) => entry.evaluationRunId)
    .filter((id): id is string => id !== null);

  // Scoped to the caller's own runs for the same reason the platform's cancel
  // route is: `AiEvaluationRun.userId` is the ownership column, and one admin
  // stopping another's run is a thing the platform does not let them do.
  const live = await prisma.aiEvaluationRun.findMany({
    where: { id: { in: runIds }, userId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  });
  const liveIds = new Set(live.map((run) => run.id));

  if (liveIds.size > 0) {
    await prisma.aiEvaluationRun.updateMany({
      where: { id: { in: [...liveIds] } },
      data: { status: 'cancelled', completedAt: new Date(), lockedBy: null, lockedAt: null },
    });
  }

  const cancelled: VoiceArm[] = [];
  const alreadyFinished: VoiceArm[] = [];
  for (const entry of arms) {
    const arm = isVoiceArm(entry.arm) ? entry.arm : null;
    if (arm === null) continue;
    // A deleted run has no id and nothing to stop; it belongs with the finished
    // rather than being silently dropped from both lists.
    if (entry.evaluationRunId !== null && liveIds.has(entry.evaluationRunId)) cancelled.push(arm);
    else alreadyFinished.push(arm);
  }

  logger.info('Voice comparison stopped', {
    comparisonId,
    cancelled: cancelled.length,
    alreadyFinished: alreadyFinished.length,
  });

  return { comparisonId, cancelled, alreadyFinished };
}
