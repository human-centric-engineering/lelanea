/**
 * Seed the golden set — the fixed questions, and the bare model they are asked against.
 *
 * Before this runs there is no way to hear a change to her voice before it
 * ships. A clause in the core gets edited to fix one awkward reply, three other
 * replies quietly get worse, and nothing fails, nothing is logged and nobody
 * finds out except by reading everything again. This unit writes the two rows
 * that make the check possible: an `AiDataset` holding the authored prompts, and
 * an `AiAgent` with no fingerprint at all to ask them of.
 *
 * ## Both rows are pure code projections (`fp4`) — with one exception that matters
 *
 * The prompts come from `content/lelanea_voice_golden_set.json` and no operator
 * is meant to edit them in the admin UI. But a dataset case cannot simply be
 * reconciled once it has been used: `AiEvaluationCaseResult.datasetCase` declares
 * no `onDelete`, so Prisma's default `Restrict` applies and deleting a scored
 * case fails with `P2003`. That is the right behaviour — an answer is only
 * readable beside the question that produced it — so the rule here is:
 *
 * - **A version nothing has run yet is reconciled in place.** Fixing a typo in a
 *   prompt on a dev install costs nothing and should cost nothing.
 * - **A version something HAS run is frozen.** The unit refuses, and names the
 *   remedy: bump `goldenSet.version`, which mints a new dataset beside the old
 *   one. The old comparison keeps its questions; the new one gets the new ones.
 *
 * Silently reconciling the second case would quietly re-caption every historical
 * answer with a question it was never asked.
 *
 * ## The control agent
 *
 * `voice-control-bare` — deliberately NOT `lelanea-`-prefixed, because that
 * prefix is what `isCorpusAgent()` matches and a matching agent has her
 * designated corpus widened onto it. The arm meant to show what a bare model
 * does with her questions would otherwise start answering out of her documents
 * the moment anything bound a search tool, with the comparison still calling it
 * the bare arm.
 *
 * Its whole system prompt is the authored `control.systemInstructions`, and its
 * three inheritable columns and its `profileId` are reconciled to NULL on every
 * run — not because an operator is likely to attach her profile to the control,
 * but because that specific mistake produces a comparison of her voice with
 * itself that looks exactly like a comparison where the fingerprint did nothing.
 * `lib/app/voice/comparison.ts` refuses to queue in that state; this keeps the
 * state from persisting.
 *
 * **Idempotent, and no timestamp churn.** Every write is preceded by a
 * comparison; a re-run against a current database issues no write at all.
 *
 * **Safe on empty.** A set that projected to no cases is refused by throwing,
 * for the same reason `003-voice-fingerprint.ts` throws: `prisma/runner.ts`
 * upserts the `SeedHistory` row the moment `run()` resolves, so a quiet return
 * would bank the aborted run as a success and every later `db:seed` would skip
 * the unit.
 *
 * @see lib/app/voice/golden-set.ts — the ids, the arms, and the projection
 * @see lib/app/voice/comparison.ts — what queues a run against these rows
 * @see .context/app/voice.md
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import { getVoiceGoldenSet } from '@/lib/app/content';
import {
  VOICE_CONTROL_AGENT_SLUG,
  goldenSetDatasetId,
  projectGoldenSetCases,
  type GoldenDatasetCase,
} from '@/lib/app/voice/golden-set';
import { hashDatasetCases } from '@/lib/orchestration/evaluations/datasets/hash';

/**
 * The mode the control carries, as a constant rather than a literal at the write
 * site — so the test asserts the same string the seed writes.
 *
 * `restricted` rather than the platform default `full`, and it is a second lock
 * rather than the first. The slug is what keeps her corpus contributor off this
 * agent; this is what makes the set it could search empty — the platform's own
 * `system`-scoped reference corpus and nothing else — if a later task ever binds
 * a search tool to every agent on the install.
 */
export const CONTROL_KNOWLEDGE_ACCESS_MODE = 'restricted';

/**
 * Has anything actually been asked of this dataset yet?
 *
 * One run of any status counts, `failed` included: a failed run still holds
 * `AiEvaluationCaseResult` rows for every case it got through before it stopped,
 * and those are exactly the rows `Restrict` would refuse to orphan.
 */
async function datasetIsFrozen(prisma: PrismaClient, datasetId: string): Promise<boolean> {
  return (await prisma.aiEvaluationRun.count({ where: { datasetId } })) > 0;
}

/** One case row, without the dataset link the two write paths add differently. */
function toCaseRow(entry: GoldenDatasetCase) {
  return {
    position: entry.position,
    // `input` is `Json` on the platform's model — a string case is a JSON
    // string, which is what `hashDatasetCases` canonicalises and what
    // `runAgentCase` sends as the user turn.
    input: entry.input satisfies Prisma.InputJsonValue,
    metadata: { ...entry.metadata } satisfies Prisma.InputJsonValue,
  };
}

const unit: SeedUnit = {
  name: 'app-lelanea/004-voice-golden-set',
  // Everything between the authored words and the rows. The loader and the
  // schema are here for the same reason they are on unit 003 — they decide which
  // authored fields reach the projection at all — and `golden-set.ts` because it
  // owns the dataset id and the control's slug: change either and this unit must
  // re-run, or the install keeps a dataset under an id nothing looks for.
  hashInputs: [
    '../../../content/lelanea_voice_golden_set.json',
    '../../../lib/app/content/index.ts',
    '../../../lib/app/content/schemas.ts',
    '../../../lib/app/voice/golden-set.ts',
  ],
  async run({ prisma, logger }) {
    const goldenSet = getVoiceGoldenSet();
    const cases = projectGoldenSetCases(goldenSet);

    if (cases.length === 0) {
      // THROW, not return — see the header. A quiet return banks the aborted run
      // as a success and every later `db:seed` skips the unit, leaving an install
      // with no golden set permanently until somebody deletes the history row.
      logger.error('voice golden set: the authored set projected to no cases — refusing to write', {
        version: goldenSet.collection.version,
      });
      throw new Error(
        `Voice golden set v${goldenSet.collection.version} projected to no cases — refusing to write a check that asks nothing.`
      );
    }

    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No admin user found — ensure 001-system-owner runs first.');
    }

    // ---- The dataset: one per authored version ------------------------------
    const datasetId = goldenSetDatasetId(goldenSet.collection.version);
    const contentHash = hashDatasetCases(cases);
    const datasetProjection = {
      name: `${goldenSet.dataset.name} v${goldenSet.collection.version}`,
      description: goldenSet.dataset.description,
      tags: [...goldenSet.dataset.tags],
      caseCount: cases.length,
      contentHash,
      source: 'manual',
    };

    const existingDataset = await prisma.aiDataset.findUnique({
      where: { id: datasetId },
      select: { id: true, contentHash: true, name: true, description: true, caseCount: true },
    });

    if (!existingDataset) {
      await prisma.aiDataset.create({
        data: {
          id: datasetId,
          // Null rather than the service account: the set belongs to the
          // install, not to a person. The consequence, stated rather than
          // discovered — the platform's own dataset list at
          // /admin/orchestration/evaluations/datasets filters on the session
          // user, so this row will not appear there. /admin/app/voice is its
          // surface.
          userId: null,
          ...datasetProjection,
          cases: { create: cases.map(toCaseRow) },
        },
      });
      logger.info(
        `🎧 Created golden set ${datasetId} (${cases.length} prompts, hash ${contentHash.slice(0, 8)})`
      );
    } else if (existingDataset.contentHash === contentHash) {
      logger.info(`⏭  golden set already at v${goldenSet.collection.version}`);
    } else if (await datasetIsFrozen(prisma, datasetId)) {
      // Refuse rather than reconcile. Deleting a scored case would fail with
      // P2003 anyway; the point of catching it here is to say WHY, and to name
      // the remedy rather than leaving an operator with a foreign-key error
      // (`HB10`).
      logger.error('voice golden set: the authored prompts changed under a version that has run', {
        version: goldenSet.collection.version,
        datasetId,
      });
      throw new Error(
        `The prompts in content/lelanea_voice_golden_set.json have changed, but v${goldenSet.collection.version} has already been run — its answers are only readable beside the questions that produced them. Bump \`goldenSet.version\` in that file: a new version mints a new dataset beside this one and leaves the old comparisons intact.`
      );
    } else {
      // Nothing has been asked of this version yet, so there is no history to
      // re-caption and fixing a prompt should cost nothing.
      await prisma.$transaction([
        prisma.aiDatasetCase.deleteMany({ where: { datasetId } }),
        prisma.aiDatasetCase.createMany({
          data: cases.map((entry) => ({ datasetId, ...toCaseRow(entry) })),
        }),
        prisma.aiDataset.update({ where: { id: datasetId }, data: datasetProjection }),
      ]);
      logger.info(
        `🎧 Reconciled golden set ${datasetId} (${cases.length} prompts, hash ${contentHash.slice(0, 8)})`
      );
    }

    // ---- The control agent: created once, five columns reconciled forever ---
    const existingControl = await prisma.aiAgent.findUnique({
      where: { slug: VOICE_CONTROL_AGENT_SLUG },
      select: {
        id: true,
        systemInstructions: true,
        profileId: true,
        knowledgeAccessMode: true,
        persona: true,
        guardrails: true,
        brandVoiceInstructions: true,
      },
    });

    if (!existingControl) {
      await prisma.aiAgent.create({
        data: {
          name: goldenSet.control.name,
          slug: VOICE_CONTROL_AGENT_SLUG,
          description: goldenSet.control.description,
          systemInstructions: goldenSet.control.systemInstructions,
          // Empty strings: resolved at runtime from the operator's first
          // configured provider and the system default chat model — the same
          // contract her own agent uses, which is what makes the two arms
          // resolve to the SAME model without either naming one.
          model: '',
          provider: '',
          isActive: true,
          isSystem: true,
          knowledgeAccessMode: CONTROL_KNOWLEDGE_ACCESS_MODE,
          createdBy: admin.id,
        },
      });
      logger.info(`🤖 Created ${VOICE_CONTROL_AGENT_SLUG} (the bare arm)`);
      return;
    }

    const corrections: Prisma.AiAgentUpdateInput = {};
    if (existingControl.systemInstructions !== goldenSet.control.systemInstructions) {
      corrections.systemInstructions = goldenSet.control.systemInstructions;
    }
    if (existingControl.knowledgeAccessMode !== CONTROL_KNOWLEDGE_ACCESS_MODE) {
      corrections.knowledgeAccessMode = CONTROL_KNOWLEDGE_ACCESS_MODE;
    }
    // The four that make the control a control. An operator who attaches her
    // profile here, or pastes her persona onto the agent, produces a comparison
    // of her voice with itself — which looks exactly like a comparison in which
    // the fingerprint did nothing. `assertArmsComparable` refuses to queue in
    // that state; this is what stops the state persisting.
    if (existingControl.profileId !== null) corrections.profile = { disconnect: true };
    if (existingControl.persona !== null) corrections.persona = null;
    if (existingControl.guardrails !== null) corrections.guardrails = null;
    if (existingControl.brandVoiceInstructions !== null) corrections.brandVoiceInstructions = null;

    const changed = Object.keys(corrections);
    if (changed.length === 0) {
      logger.info(`⏭  ${VOICE_CONTROL_AGENT_SLUG} already bare`);
      return;
    }

    await prisma.aiAgent.update({ where: { id: existingControl.id }, data: corrections });
    logger.info(`🤖 Corrected ${VOICE_CONTROL_AGENT_SLUG}`, { fields: changed });
  },
};

export default unit;
