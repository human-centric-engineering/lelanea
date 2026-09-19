/**
 * Smoke: someone in danger gets the resource with no model reachable at all —
 * the real turn seam, against the dev database (f-safety t-58).
 *
 * **Why in-process, not through the route.** The claim under test is that
 * nothing between a person in danger and the resource needs a model: not her
 * turn, and not the context check's side model either. Through a running server
 * the provider key cannot be taken away — it is in that process's environment.
 * Here it can: every `*_API_KEY` is deleted before anything is imported, so the
 * context check's provider cannot be built or cannot answer, and the model call
 * itself is a function that throws. (That the route reaches the turn hook is
 * `smoke:app-turn`'s job, and unchanged.)
 *
 * Flow:
 *   1. Delete every provider key from this process's environment.
 *   2. Create a throwaway member.
 *   3. Take a hard-tier turn with `Accept-Language: en-GB` and a model call
 *      that throws. Assert: one frame, the crisis ending, UK services; the model
 *      call never made; no turn record.
 *   4. Assert the safety record: hard, the context check did NOT soften it, the
 *      locale and region — and none of the words.
 *   5. The resource is read from the tables an admin edits (f-safety t-63):
 *      seed them if this database has not been, edit the GB row, take another
 *      hard turn, and assert the EDITED service is what the person is shown.
 *      The row is put back exactly as it was, on every path.
 *   6. Delete the member. Assert the records went with them (the hand-written
 *      `ON DELETE CASCADE`).
 *
 * Needs: the migrations applied (`npm run db:migrate:deploy`). Costs nothing —
 * no model is reachable, by construction.
 *
 * Safety: every row is scoped by the `smoke-test-crisis` email prefix and
 * removed on every path, including a sweep at startup.
 *
 * Run with: npm run smoke:app-crisis
 */

// A module, not a global script: everything else is imported dynamically.
export {};

for (const key of Object.keys(process.env)) {
  if (key.endsWith('_API_KEY')) delete process.env[key];
}

const PREFIX = 'smoke-test-crisis';
const EDITED_SERVICE = {
  name: 'Smoke Test Line',
  contact: 'Call 0800 000 0000',
  hours: 'Only during this smoke run',
};
const EMAIL = `${PREFIX}@example.com`;
const MESSAGE = 'I want to kill myself tonight';

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log('\nsmoke:app-crisis — in-process, every provider key removed\n');

  // Imported after the keys are gone, so nothing caches one.
  const { prisma } = await import('@/lib/db/client');
  const { logger } = await import('@/lib/logging');
  const { runRecordedTurn } = await import('@/lib/app/agent/turns');
  const { invalidateCrisisContentCache } = await import('@/lib/app/safety/resources-store');
  const { default: crisisSeed } = await import('@/prisma/seeds/app-lelanea/010-crisis-resources');

  const sweep = () => prisma.user.deleteMany({ where: { email: EMAIL } });

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.log('skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }

  let restoreGb: (() => Promise<unknown>) | null = null;

  try {
    await sweep();
    const leftover = Object.keys(process.env).filter((k) => k.endsWith('_API_KEY'));
    check(leftover.length === 0, 'no provider key is in this process');

    const user = await prisma.user.create({ data: { name: `${PREFIX} member`, email: EMAIL } });

    console.log('\n1. A hard-tier turn, with the model call broken');
    let modelCalled = false;
    const result = await runRecordedTurn(
      {
        userId: user.id,
        role: 'onboarding',
        agentId: 'unused',
        agentSlug: 'lelanea-guide',
        conversationId: undefined,
        message: MESSAGE,
        clientTurnId: `${PREFIX}-${Date.now()}`,
        headers: new Headers({ 'accept-language': 'en-GB,en;q=0.9' }),
      },
      () => {
        modelCalled = true;
        throw new Error('the model is unreachable');
      }
    );
    if ('refused' in result) throw new Error(`refused: ${result.reason}`);
    const frames = [];
    for await (const frame of result) frames.push(frame);

    check(!modelCalled, 'the model was never called');
    check(frames.length === 1, `one frame (${frames.length})`);
    const [frame] = frames;
    check(
      frame?.type === 'error' && 'code' in frame && frame.code === 'crisis',
      'it is the crisis ending'
    );
    check(
      frame !== undefined && 'message' in frame && frame.message.includes('116 123'),
      'it names a UK service by number'
    );
    const turns = await prisma.appTurn.count({ where: { userId: user.id } });
    check(turns === 0, 'no turn was recorded');

    console.log('\n2. What was recorded');
    const events = await prisma.appSafetyEvent.findMany({ where: { userId: user.id } });
    check(events.length === 1, 'one safety event');
    const [event] = events;
    check(event?.actedTier === 'hard', 'acted on as hard');
    check(
      event?.contextCheck !== 'softened' && event?.contextCheck !== 'confirmed',
      `the context check could not run, and the hard tier stood (${event?.contextCheck})`
    );
    check(event?.locale === 'en-GB' && event.resourceRegion === 'GB', 'chosen for en-GB → GB');
    const stored = JSON.stringify(event);
    check(
      !['kill', 'myself', 'tonight'].some((word) => stored.includes(word)),
      'no part of the message is stored'
    );

    console.log('\n3. The words come from the tables an admin edits');
    if (!(await prisma.appCrisisCopy.findUnique({ where: { slug: 'global' } }))) {
      await crisisSeed.run({ prisma, logger });
      console.log('  (seeded this database from the bundled file first — what db:seed does)');
    }
    const original = await prisma.appCrisisRegion.findUnique({ where: { region: 'GB' } });
    check(original !== null, 'GB is listed in the tables');
    restoreGb = () =>
      prisma.appCrisisRegion.update({
        where: { region: 'GB' },
        data: {
          emergencyNumber: original!.emergencyNumber,
          services: original!.services ?? [],
          status: original!.status,
          version: original!.version,
          signedOffAt: original!.signedOffAt,
        },
      });
    await prisma.appCrisisRegion.update({
      where: { region: 'GB' },
      data: { services: [EDITED_SERVICE], status: 'draft', version: { increment: 1 } },
    });
    // What an admin write does in the instance that served it; any other
    // instance sees the edit when its cache expires.
    invalidateCrisisContentCache();
    console.log(`  edited GB's services to: ${EDITED_SERVICE.name} — ${EDITED_SERVICE.contact}`);

    const edited = await runRecordedTurn(
      {
        userId: user.id,
        role: 'onboarding',
        agentId: 'unused',
        agentSlug: 'lelanea-guide',
        conversationId: undefined,
        message: MESSAGE,
        clientTurnId: `${PREFIX}-edited-${Date.now()}`,
        headers: new Headers({ 'accept-language': 'en-GB' }),
      },
      () => {
        throw new Error('the model is unreachable');
      }
    );
    if ('refused' in edited) throw new Error(`refused: ${edited.reason}`);
    const editedFrames = [];
    for await (const frame of edited) editedFrames.push(frame);
    const [editedFrame] = editedFrames;
    const shown = editedFrame !== undefined && 'message' in editedFrame ? editedFrame.message : '';
    check(shown.includes(EDITED_SERVICE.contact), 'the person is shown the edited GB service');
    check(!shown.includes('116 123'), 'and not the bundled one it replaced');
    check(
      editedFrame !== undefined &&
        'resource' in editedFrame &&
        (editedFrame.resource as { status: string }).status === 'draft',
      'an edited region is shown as a draft until it is signed off'
    );
    await restoreGb();
    restoreGb = null;
    invalidateCrisisContentCache();
    check(true, 'GB put back as it was');

    console.log('\n4. Erasure');
    await prisma.user.delete({ where: { id: user.id } });
    const after = await prisma.appSafetyEvent.count({ where: { userId: user.id } });
    check(after === 0, 'the records went with the account (ON DELETE CASCADE)');

    console.log('\n✓ smoke:app-crisis passed\n');
  } finally {
    if (restoreGb)
      await restoreGb().catch((err: unknown) => console.error('GB restore failed:', err));
    await sweep().catch((err: unknown) => console.error('sweep failed:', err));
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ smoke:app-crisis failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
