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
 * ## The prompts are written once per version; the rest is reconciled (`fp4`)
 *
 * The prompts come from `seed-data/drafted/lelanea_voice_golden_set.json` the
 * first time an install sees a version, and **after that they are the admin's**
 * (t-92): the Voice page edits them, so a stored set that differs from the file
 * is reported and left as it is. A changed file reaches an install that already
 * has the version only as a NEW version — bump `goldenSet.version` and this unit
 * creates the dataset beside the old one.
 *
 * Before t-92 the unit reconciled a version nothing had run and refused one
 * something had. The freeze itself is unchanged — an answer is only readable
 * beside the question that produced it, and `AiEvaluationCaseResult` restricts
 * deleting a scored case — but it is now enforced where the prompts are edited
 * (`lib/app/voice/golden-set-editor.ts`), which is also where its remedy is.
 *
 * **The words ABOUT the questions stay the seed's.** The dataset's name,
 * description and tags are not what any answer was given and nothing in the
 * admin edits them, so they are reconciled on every run, whether or not the
 * version has been run: editing `dataset.description` in the file changes the
 * unit's `hashInputs` (so the unit re-runs) but not the content hash.
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

import type { Prisma } from '@prisma/client';

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import { buildGoldenSetSeed } from '@/lib/app/content/seed-input/golden-set-seed';
import { seedGoldenSetPointer } from '@/lib/app/content/golden-set-store';
import { getVoiceGoldenSet } from '@/lib/app/content/seed-input/voice-golden-set';
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
  //
  // The loader's path tracks where the loader lives: t-89 moved it out of
  // `lib/app/content/index.ts` into `seed-input/`, and this list kept naming the
  // barrel — a path that still resolves, so the `names paths that resolve` case
  // stayed green while the hash stopped covering the loader. **Move a module
  // named here and move its entry in the same commit.**
  //
  // `seed-input/golden-set-seed.ts` is DELIBERATELY ABSENT, and it reads like an
  // omission: `buildGoldenSetSeed()` picks the five authored fields that become
  // the pointer row, which is exactly the "decides what reaches the projection"
  // test the loader is here for. But its only consumer is
  // `seedGoldenSetPointer()`, which is write-once — it returns `skipped` the
  // moment the row exists (`golden-set-store.ts`), because after the seed the
  // admin surface owns that row. So hashing the builder would re-run the unit
  // and change nothing: the pointer path would no-op on the way past. Adding
  // the entry buys no property and costs a re-run of the dataset reconcile.
  // Re-derive this before "fixing" it — if the pointer ever stops being
  // write-once, the entry has to go in.
  hashInputs: [
    '../../../seed-data/drafted/lelanea_voice_golden_set.json',
    '../../../lib/app/content/seed-input/voice-golden-set.ts',
    '../../../lib/app/content/schemas.ts',
    '../../../lib/app/voice/golden-set.ts',
  ],
  async run({ prisma, logger }) {
    const goldenSet = getVoiceGoldenSet();
    const cases = projectGoldenSetCases(goldenSet);

    // Which version this install treats as current, and the provenance the
    // voice page shows. Written once and never again (t-88): the Voice page
    // repoints it when it starts a new version (t-92), and that must not be
    // undone on the next boot.
    const pointer = await seedGoldenSetPointer(buildGoldenSetSeed(goldenSet), prisma);
    logger.info(
      pointer.status === 'skipped'
        ? `⏭  Golden set pointer already in the database (v${pointer.version}); left as it is`
        : `📌 Golden set pointer written at v${goldenSet.collection.version}, revision 1 and draft`
    );

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
      // Every column here is compared below. `caseCount` is the one exception and
      // it is not selected: it is a function of the cases, so an equal
      // `contentHash` already settles it.
      select: {
        id: true,
        contentHash: true,
        name: true,
        description: true,
        tags: true,
        source: true,
      },
    });

    /** The projection's non-case columns that the stored row disagrees with. */
    function staleDatasetFields(row: {
      name: string;
      description: string | null;
      tags: string[];
      source: string;
    }): string[] {
      const stale = (['name', 'description', 'source'] as const).filter(
        (field) => row[field] !== datasetProjection[field]
      );
      const tagsDiffer =
        row.tags.length !== datasetProjection.tags.length ||
        row.tags.some((tag, index) => tag !== datasetProjection.tags[index]);
      return tagsDiffer ? [...stale, 'tags'] : stale;
    }

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
    } else {
      // The prompts are the admin's once the version exists (t-92): the Voice
      // page edits them, and a seed that reconciled them back to the file would
      // undo that on the next run. So a stored set that differs from the file
      // is reported and left — frozen or not — and a changed file reaches an
      // install as a NEW version (bump `goldenSet.version`), which is created
      // above like any version this install has not seen.
      if (existingDataset.contentHash !== contentHash) {
        logger.info(
          `⏭  golden set ${datasetId}: the prompts here differ from the file; they are edited on the Voice page, so they are left as they are`
        );
      }
      // The words ABOUT the questions stay the seed's: a name, a description
      // and a tag list are not what any answer was given, and nothing in the
      // admin edits them. Reconciled whether or not the version has run.
      const stale = staleDatasetFields(existingDataset);
      if (stale.length === 0) {
        if (existingDataset.contentHash === contentHash) {
          logger.info(`⏭  golden set already at v${goldenSet.collection.version}`);
        }
      } else {
        await prisma.aiDataset.update({
          where: { id: datasetId },
          data: {
            name: datasetProjection.name,
            description: datasetProjection.description,
            tags: datasetProjection.tags,
            source: datasetProjection.source,
          },
        });
        logger.info(`🎧 Corrected golden set ${datasetId}`, { fields: stale });
      }
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
          // Empty strings here, as on her own agent: `005-agent-models.ts` pins
          // BOTH arms to the same provider and model, which is what keeps the
          // comparison about the voice. Left blank, the two still match — both
          // resolve to the install's default chat model.
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
