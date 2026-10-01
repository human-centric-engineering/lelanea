/**
 * Smoke: passing the gate starts a person's journey, on the real development
 * database (§15, t-102).
 *
 * The unit tests mock Prisma and every framework call, so they prove this code
 * calls the right functions in the right order. What they cannot prove is the
 * wiring those calls rely on: that `createJourney` writes a row on the
 * published Lelañea map, that the engine really accepts an `enter` of the
 * `onboarding` node on that map (availability is computed from the stored
 * graph, the module rows and their liveness), that a second call writes
 * nothing, and that `recordNodeProgress` then accepts a once-only beat. That
 * last one is the reason the node is entered at all. Then the first run's own
 * beats (t-103): recorded through the real store, read back from the real
 * row, and not replayed. Then the discovery questions (t-104): an answer
 * appended as a slot value with onboarding provenance, revised as a second
 * version, a skip and a leave on the same node, and a fresh read resuming
 * after them. Then a real turn (t-105): an answer with a word worth listening
 * for, and the facilitator seat asked to quote it, through the real context
 * block and the real model — the wiring no unit test can prove. Then the
 * hand-off (t-106): refused with questions ahead, then, once every one is
 * answered or skipped, onboarding completed and Values entered by the real
 * engine (which needs Values live), read back by the map, repeated with no new
 * event, and an answer still revised afterwards.
 *
 * Needs a seeded, migrated database: the map published (`001-journey-map`),
 * Onboarding and Values active (their activation migrations or seeds), and the
 * gate's documents present, and a provider for her pinned model (step 8
 * spends one small turn). Skips (exit 0, says so) with no database, and fails
 * with a clear message when the map is not published.
 *
 * Self-cleaning: creates one `smoke-app-onboarding-*` user and removes it and
 * every row keyed on it, on every path. Never unscoped deletes.
 *
 * FORK NOTE — this runs the real `lib/app/leaf-bootstrap` seam (`initLeafApp()`),
 * because the map projection checks each node against the module registry it
 * fills. It asserts Lelañea's map, its `onboarding` node and its gate; a fork
 * with a different journey, or none, should replace this script rather than
 * pin ours.
 *
 * Usage: `npm run smoke:app-onboarding` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { ACKNOWLEDGEMENT_KINDS } from '@/lib/app/gateway/kinds';
import { getGateStatus, recordAcknowledgement } from '@/lib/app/gateway/acknowledgements';
import {
  JOURNEY_MAP_SLUG,
  ONBOARDING_NODE_KEY,
  VALUES_NODE_KEY,
} from '@/lib/app/journey/map-definition';
import { getJourneyMap } from '@/lib/app/journey/map';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { ensureJourneyStarted } from '@/lib/app/journey/start';
import { FIRST_RUN_BEATS, pendingBeats } from '@/lib/app/onboarding/first-run';
import {
  getFirstRunProgress,
  readOnboardingProgress,
  recordFirstRunBeat,
} from '@/lib/app/onboarding/first-run-store';
import { discoveryLedgerFrom } from '@/lib/app/onboarding/discovery';
import {
  answerDiscoveryQuestion,
  getDiscoveryState,
  leaveDiscovery,
  skipDiscoveryQuestion,
} from '@/lib/app/onboarding/discovery-store';
import { beginJourney } from '@/lib/app/onboarding/hand-off';
import { recordNodeProgress } from '@/lib/framework/facilitation/journey/progress';
import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import { getPublishedMapVersion } from '@/lib/framework/facilitation/map/version-service';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { drainStreamChat } from '@/lib/orchestration/evaluations/drain-stream-chat';
import { runAsOrg } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

const PREFIX = 'smoke-app-onboarding';
/** An answer with a word no reply would use by accident. */
const MIRRORED_WORDS = 'On the lighthouse steps at dawn, before anyone needs me.';
const stamp = Date.now();

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

async function cleanup(userId: string): Promise<void> {
  const journeys = await prisma.userJourney.findMany({ where: { userId }, select: { id: true } });
  const journeyIds = journeys.map((j) => j.id);
  await prisma.journeyEvent.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.userNodeState
    .deleteMany({ where: { journeyId: { in: journeyIds } } })
    .catch(() => undefined);
  await prisma.userJourney.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.appAcknowledgement.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.slotValue.deleteMany({ where: { userId } }).catch(() => undefined);
  // The real turn (step 8): its messages, its cost and its conversation.
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId } } }).catch(() => undefined);
  await prisma.aiCostLog.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.aiConversation.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:app-onboarding skipped — no database reachable.');
    return;
  }

  let userId: string | null = null;
  try {
    // The map projection checks each node against the module registry, which a
    // server fills at boot and a script has to fill itself.
    await initLeafApp();

    if ((await getPublishedMapVersion(JOURNEY_MAP_SLUG)) === null) {
      throw new Error(`the map "${JOURNEY_MAP_SLUG}" is not published — run npm run db:seed`);
    }

    const user = await prisma.user.create({
      data: { name: `${PREFIX} person`, email: `${PREFIX}-${stamp}@example.com` },
    });
    userId = user.id;

    console.log('\n1. The gate');
    for (const kind of ACKNOWLEDGEMENT_KINDS) {
      const result = await recordAcknowledgement(user.id, kind);
      check(result.created, `${kind} recorded`);
    }
    check((await getGateStatus(user.id)).complete, 'the gate is complete');

    console.log('\n2. The journey starts');
    check((await ensureJourneyStarted(user.id)) === 'started', 'the first call starts it');
    const journeys = await prisma.userJourney.findMany({ where: { userId: user.id } });
    check(
      journeys.length === 1 && journeys[0].graphSlug === JOURNEY_MAP_SLUG,
      `one journey, on the published map "${JOURNEY_MAP_SLUG}"`
    );
    const journeyId = journeys[0].id;
    const states = await prisma.userNodeState.findMany({ where: { journeyId } });
    check(
      states.length === 1 &&
        states[0].nodeKey === ONBOARDING_NODE_KEY &&
        states[0].status === NODE_STATE_STATUS.active,
      'onboarding is the one node, and it is active'
    );

    console.log('\n3. A second call writes nothing');
    const eventsBefore = await prisma.journeyEvent.count({ where: { journeyId } });
    check((await ensureJourneyStarted(user.id)) === 'already', 'the second call answers already');
    check(
      (await prisma.userJourney.count({ where: { userId: user.id } })) === 1,
      'still one journey'
    );
    check(
      (await prisma.journeyEvent.count({ where: { journeyId } })) === eventsBefore,
      `no new event (${eventsBefore} total)`
    );

    console.log('\n4. The drawer reads it');
    const map = await getJourneyMap(user.id);
    const current = map?.modules.filter((m) => m.state === 'current').map((m) => m.slug);
    check(
      current?.length === 1 && current[0] === ONBOARDING_NODE_KEY,
      'onboarding is the one current module'
    );
    check(
      map?.modules.filter((m) => m.state === 'open').length === (map?.modules.length ?? 0) - 1,
      'every other module is open'
    );

    console.log('\n5. A once-only beat is accepted');
    const beat = await recordNodeProgress(
      { userId: user.id },
      { userId: user.id, graphSlug: JOURNEY_MAP_SLUG },
      ONBOARDING_NODE_KEY,
      { welcomed: true }
    );
    check(beat.ok, 'recordNodeProgress accepts a beat on the entered node');

    console.log('\n6. The first run is recorded, and not replayed (t-103)');
    const before = await getFirstRunProgress(user.id);
    check(
      before !== null && pendingBeats(before).length === FIRST_RUN_BEATS.length,
      'every beat is still to come'
    );
    check(
      (await recordFirstRunBeat(user.id, 'initiation')) === 'recorded',
      'the Initiation is recorded'
    );
    check(
      (await recordFirstRunBeat(user.id, 'read:the_mission')) === 'recorded',
      'a skipped read is recorded'
    );
    check(
      (await recordFirstRunBeat(user.id, 'initiation')) === 'already',
      'recording it again answers already'
    );
    const after = await getFirstRunProgress(user.id);
    check(
      after !== null &&
        after.initiationShown &&
        !pendingBeats(after).includes('initiation') &&
        !pendingBeats(after).includes('read:the_mission') &&
        pendingBeats(after).length === FIRST_RUN_BEATS.length - 2,
      'a fresh read of the row resumes after them'
    );
    const row = await prisma.userNodeState.findFirst({
      where: { journeyId, nodeKey: ONBOARDING_NODE_KEY },
    });
    const progress = row?.progress;
    check(
      typeof progress === 'object' &&
        progress !== null &&
        !Array.isArray(progress) &&
        'welcomed' in progress,
      'the earlier beat on the same node survives the merge'
    );

    console.log('\n7. The discovery questions: answer, revise, skip, resume (t-104)');
    const fresh = await getDiscoveryState(user.id);
    if (fresh === null) throw new Error('the discovery state could not be read');
    const [first, second, third] = fresh.set.questions;
    if (!first || !second || !third) throw new Error('the set has fewer than three questions');
    check(fresh.position.next === first.id && !fresh.started, `a new person starts at ${first.id}`);
    const firstAnswer = first.conditionalFollowUp
      ? ({ words: 'A smoke answer.', branch: 'yes' } as const)
      : { words: 'A smoke answer.' };
    const answered = await answerDiscoveryQuestion(user.id, fresh.set, first, firstAnswer);
    check(
      answered.outcome === 'written' && answered.version === 1,
      `${first.id} is answered, as version 1`
    );
    check(
      discoveryLedgerFrom(await readOnboardingProgress(user.id)).started,
      'the first answer marks the first sitting started, on the node'
    );
    const again = await answerDiscoveryQuestion(user.id, fresh.set, first, firstAnswer);
    check(
      again.outcome === 'unchanged' && again.version === 1,
      'the same answer again writes nothing'
    );
    const revised = await answerDiscoveryQuestion(user.id, fresh.set, first, {
      ...firstAnswer,
      words: 'A revised smoke answer.',
    });
    check(
      revised.outcome === 'written' && revised.version === 2,
      'a revision is written, as version 2'
    );
    const values = await prisma.slotValue.findMany({
      where: { userId: user.id, slotSlug: first.slotSlug },
      orderBy: { version: 'asc' },
    });
    check(
      values.length === 2 &&
        values[0].supersededAt !== null &&
        values[1].supersededAt === null &&
        values[1].version === 2,
      'two versions, the first superseded: appended, never overwritten'
    );
    const provenance = values[1].provenance;
    check(
      typeof provenance === 'object' &&
        provenance !== null &&
        !Array.isArray(provenance) &&
        provenance.moduleSlug === fresh.set.moduleSlug &&
        provenance.nodeKey === ONBOARDING_NODE_KEY,
      'the value carries onboarding provenance'
    );
    if (second.core) {
      check(
        (
          await answerDiscoveryQuestion(user.id, fresh.set, second, {
            words: 'A smoke answer.',
            ...(second.conditionalFollowUp && { branch: 'no' as const }),
          })
        ).outcome === 'written',
        `${second.id} is core, so it is answered rather than skipped`
      );
    } else {
      check(
        (await skipDiscoveryQuestion(user.id, second.id)) === 'recorded',
        `${second.id} is skipped`
      );
    }
    check((await leaveDiscovery(user.id)) === 'recorded', 'leaving is recorded');
    const resumed = await getDiscoveryState(user.id);
    check(
      resumed !== null &&
        resumed.started &&
        resumed.position.next === third.id &&
        resumed.answers[first.id]?.words === 'A revised smoke answer.',
      `a fresh read resumes at ${third.id}, with the revised answer`
    );
    check(
      (await getFirstRunProgress(user.id))?.initiationShown === true,
      'the first run’s beats survive the discovery beats on the same node'
    );

    console.log('\n8. A real turn quotes the person back (t-105)');
    const quoted = await answerDiscoveryQuestion(user.id, fresh.set, third, {
      words: MIRRORED_WORDS,
      ...(third.conditionalFollowUp && { branch: 'yes' as const }),
    });
    check(quoted.outcome === 'written', `${third.id} is answered with words to listen for`);
    const turn = await runAsOrg(INSTALL_ORG_ID, () =>
      drainStreamChat({
        agentSlug: VOICE_AGENT_SLUG,
        userId: user.id,
        contextType: FACILITATION_CONTEXT_TYPE,
        contextId: CONVERSATION_SEAT,
        message:
          'In the onboarding questions I wrote something about where I feel most like myself. What did I write? Quote my own words back to me.',
      })
    );
    if (turn.errorCode) {
      throw new Error(`the turn did not run: ${turn.errorCode} ${turn.errorMessage ?? ''}`);
    }
    console.log(`    the reply: ${turn.assistantText.replace(/\s+/g, ' ').slice(0, 240)}`);
    check(
      /lighthouse/i.test(turn.assistantText),
      'the reply contains words from the person’s stored answer'
    );
    // The platform embeds the turn's messages and logs that cost after the
    // stream ends, fire-and-forget. Let it land before the cleanup removes the
    // conversation under it, or it logs a foreign-key failure that reads like ours.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log('\n9. The hand-off: begin the journey, into Values (t-106)');
    check(
      (await beginJourney(user.id)) === 'not_finished',
      'with questions still ahead, beginning is refused'
    );
    const ahead = await getDiscoveryState(user.id);
    if (ahead === null) throw new Error('the discovery state could not be read');
    for (const question of ahead.set.questions) {
      if (ahead.answers[question.id] || ahead.position.skipped.includes(question.id)) continue;
      if (question.core || !ahead.set.pacing.allowPartialCompletion) {
        await answerDiscoveryQuestion(user.id, ahead.set, question, {
          words: 'A smoke answer.',
          ...(question.conditionalFollowUp && { branch: 'no' as const }),
        });
      } else {
        await skipDiscoveryQuestion(user.id, question.id);
      }
    }
    const done = await getDiscoveryState(user.id);
    check(
      done !== null && done.position.finished && !done.handedOff,
      'every question answered or skipped, and not yet handed off'
    );
    check((await beginJourney(user.id)) === 'begun', 'the journey is begun');
    const after9 = await prisma.userNodeState.findMany({ where: { journeyId } });
    const statusOf = (key: string) => after9.find((s) => s.nodeKey === key)?.status;
    check(statusOf(ONBOARDING_NODE_KEY) === NODE_STATE_STATUS.completed, 'onboarding is completed');
    check(statusOf(VALUES_NODE_KEY) === NODE_STATE_STATUS.active, 'Values is entered');
    const drawer = await getJourneyMap(user.id);
    const stateOf = (slug: string) => drawer?.modules.find((m) => m.slug === slug)?.state;
    check(
      stateOf(ONBOARDING_NODE_KEY) === 'done' && stateOf(VALUES_NODE_KEY) === 'current',
      'the map reads onboarding done and Values current'
    );
    check((await getDiscoveryState(user.id))?.handedOff === true, 'the state reads handed off');
    const eventsAfter = await prisma.journeyEvent.count({ where: { journeyId } });
    check((await beginJourney(user.id)) === 'already', 'beginning again answers already');
    check(
      (await prisma.journeyEvent.count({ where: { journeyId } })) === eventsAfter,
      'and writes no event'
    );
    const revisedAfter = await answerDiscoveryQuestion(user.id, fresh.set, first, {
      ...firstAnswer,
      words: 'Revised after the hand-off.',
    });
    check(
      revisedAfter.outcome === 'written' && revisedAfter.version === 3,
      'an answer is still revised after the hand-off, as version 3'
    );

    console.log('\n✓ smoke:app-onboarding passed');
  } finally {
    if (userId) await cleanup(userId);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-onboarding failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
