/**
 * Smoke: the voice comparison against the real development database.
 *
 * The unit tests prove the guard's logic and the seed's branches against a fake
 * world. What no mock can prove is the WIRING — that the two seeded agents
 * really exist on a seeded install, that Sunrise's `resolveEffectivePrompt`
 * really composes a marker-carrying prompt out of the profile row `db:seed`
 * wrote, that the golden set really landed under the id `comparison.ts` looks
 * for, and that the two runs really insert against the hand-written FK.
 *
 * ## It does not queue by default, and that is deliberate
 *
 * A queued run is not inert: the maintenance-tick worker claims it and drains
 * every case through a real provider, twice over, with a judge call each. A
 * smoke script that spent money every time somebody ran it would stop being run.
 * So the default is preflight only — resolve both arms, run the guard, read the
 * dataset — and nothing is written.
 *
 * Pass `--queue` to exercise the write path. It queues a comparison, reads the
 * rows back, and then DELETES it, which cascades the arms and the runs. There is
 * a small race there: a maintenance tick landing between the insert and the
 * delete would claim a run and start spending. The window is milliseconds and
 * the alternative is never testing the write at all, but it is a real window and
 * this is where it is written down.
 *
 * Usage: `npm run smoke:voice-comparison [-- --queue]` (reads `.env.local`).
 * Exit 0 on every assertion passing, 1 otherwise; skipped (exit 0, says so) with
 * no database.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this runs the real `lib/app/content` seam, it does not assert on it
 * ---------------------------------------------------------------------------
 * `getVoiceGoldenSet()` reads Lelañea's authored prompts, so this script is
 * about a fork-owned artefact from end to end, not a platform contract. In a
 * fork with its own `content/` the accessor does not exist and the import fails
 * at load — which is the right failure, because there is nothing here to run.
 * Delete the script and its `smoke:voice-comparison` entry alongside the
 * feature, or rewrite it against your own golden set. There is nothing to pin.
 *
 * @see lib/app/voice/comparison.ts
 * @see .context/app/voice.md
 */

import { prisma } from '@/lib/db/client';
import {
  assertArmsComparable,
  queueVoiceComparison,
  resolveVoiceArms,
} from '@/lib/app/voice/comparison';
import { getVoiceComparison } from '@/lib/app/voice/comparison-admin';
import {
  VOICE_ARM_AGENT_SLUGS,
  VOICE_ARM_LABELS,
  goldenSetDatasetId,
  isVoiceArm,
} from '@/lib/app/voice/golden-set';
import { getVoiceGoldenSet } from '@/lib/app/content';
import { serviceAccountWhere } from '@/lib/auth/account';

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('skipped: no database reachable (set DATABASE_URL in .env.local)');
    return;
  }

  const wantsQueue = process.argv.includes('--queue');
  const goldenSet = getVoiceGoldenSet();

  try {
    console.log(
      `\ngolden set v${goldenSet.collection.version} — ${goldenSet.prompts.length} prompts`
    );

    // ---- The dataset the seed left behind --------------------------------
    const datasetId = goldenSetDatasetId(goldenSet.collection.version);
    const dataset = await prisma.aiDataset.findUnique({
      where: { id: datasetId },
      select: { id: true, caseCount: true, contentHash: true },
    });
    check(dataset !== null, `dataset ${datasetId} exists (run npm run db:seed if not)`);
    check(
      dataset?.caseCount === goldenSet.prompts.length,
      `it holds ${goldenSet.prompts.length} cases, one per authored prompt`
    );

    const cases = await prisma.aiDatasetCase.findMany({
      where: { datasetId },
      select: { position: true, input: true, expectedOutput: true, metadata: true },
      orderBy: { position: 'asc' },
    });
    check(
      cases.every((entry) => entry.expectedOutput === null),
      'no case carries an expectedOutput — the judgement is hers, not a string match'
    );
    check(
      cases.every((entry) => entry.metadata !== null),
      'every case carries its key, kind and probe'
    );

    // ---- Both arms, composed out of the real rows -------------------------
    console.log('\narms:');
    const arms = await resolveVoiceArms();
    for (const arm of arms) {
      const first = arm.systemPrompt.split('\n').find((line) => line.trim().length > 0) ?? '';
      console.log(
        `  ${VOICE_ARM_LABELS[arm.arm].padEnd(12)} ${arm.agentSlug.padEnd(22)} ` +
          `v${arm.fingerprintVersion ?? '—'}  ${arm.systemPrompt.length} chars`
      );
      console.log(`               ${first.slice(0, 96)}`);
    }

    const fingerprint = arms.find((arm) => arm.arm === 'fingerprint');
    const bare = arms.find((arm) => arm.arm === 'bare');
    check(
      (fingerprint?.systemPrompt.length ?? 0) > 0 && (bare?.systemPrompt.length ?? 0) > 0,
      'both arms composed a real prompt'
    );
    check(
      fingerprint?.fingerprintVersion !== null && bare?.fingerprintVersion === null,
      'exactly one of them carries her voice'
    );

    assertArmsComparable(arms);
    console.log('  ✓ the guard passes on this install');

    if (!wantsQueue) {
      console.log(
        `\n✓ smoke:voice-comparison passed (preflight only — pass --queue to exercise the write)`
      );
      return;
    }

    // ---- The write path, and its immediate undo ---------------------------
    const admin = await prisma.user.findFirst({ where: serviceAccountWhere, select: { id: true } });
    if (!admin) throw new Error('No service account — run npm run db:seed first.');

    const queued = await queueVoiceComparison(admin.id);
    try {
      check(queued.arms.length === 2, 'queueing created two runs');

      const runs = await prisma.aiEvaluationRun.findMany({
        where: { id: { in: queued.arms.map((arm) => arm.evaluationRunId) } },
        select: { id: true, datasetId: true, agentId: true, status: true },
      });
      check(runs.length === 2, 'both runs are readable back');
      check(new Set(runs.map((run) => run.datasetId)).size === 1, 'both ran the same questions');
      check(new Set(runs.map((run) => run.agentId)).size === 2, 'they ran different agents');

      const armRows = await prisma.appVoiceComparisonArm.findMany({
        where: { comparisonId: queued.comparisonId },
        select: { arm: true, agentSlug: true, fingerprintVersion: true, systemPrompt: true },
      });
      check(armRows.length === 2, 'both arm rows landed against the hand-written FK');
      check(
        // `isVoiceArm` rather than a cast: `arm` is a `String` column, so a row
        // holding something the vocabulary does not know must fail this check
        // rather than index into the map as `undefined` and compare equal to
        // nothing.
        armRows.every(
          (row) => isVoiceArm(row.arm) && row.agentSlug === VOICE_ARM_AGENT_SLUGS[row.arm]
        ),
        'each arm row names the agent its arm is supposed to use'
      );
      check(
        armRows.some((row) => row.systemPrompt.includes('Voice fingerprint:')) &&
          armRows.some((row) => !row.systemPrompt.includes('Voice fingerprint:')),
        'the stored prompts are the evidence, and only one of them carries the marker'
      );

      const detail = await getVoiceComparison([queued.comparisonId]);
      check(
        detail.cases.length === goldenSet.prompts.length,
        'the surface read returns one row per question'
      );
      check(
        detail.cases.every((entry) => entry.answers.length === 2),
        'each question has a column per arm, empty until the worker drains'
      );
    } finally {
      // Both deletes are needed, and neither implies the other. Deleting the runs
      // only NULLS the arms' `evaluationRunId` (`ON DELETE SET NULL` — the arm
      // outlives its run on purpose, so erasing an admin cannot destroy a
      // comparison's evidence); what removes the arm rows is deleting the
      // comparison, whose own FK cascades and is ours.
      await prisma.aiEvaluationRun.deleteMany({
        where: { id: { in: queued.arms.map((arm) => arm.evaluationRunId) } },
      });
      await prisma.appVoiceComparison.delete({ where: { id: queued.comparisonId } });
      console.log('  ✓ cleaned up — the comparison and both runs are gone');
    }

    console.log('\n✓ smoke:voice-comparison passed');
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:voice-comparison failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
