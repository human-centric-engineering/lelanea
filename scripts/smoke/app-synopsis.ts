/**
 * Smoke: drafting a session's synopsis, on the real development database and a
 * real model (f-journey-record t-146).
 *
 * The unit tests fake the database and mock the model, so they prove the rules
 * and the queries. What they cannot prove is the wiring: that the arrival
 * which closes a session queues its draft without waiting for it; that the
 * seeded agent in the `synopsis` seat writes it, in her voice, through a real
 * provider; that the reply passes the schema and is stored as a draft with
 * the session's modules and notes; and that the person is charged for it.
 *
 * 1. Seeds a person through onboarding and a first session of three real
 *    turns, and a visible note one of those turns wrote.
 * 2. Moves that session more than twelve hours into the past.
 * 3. Arrives, as the pane does: the session closes and its draft is queued.
 * 4. Waits for the draft, prints it, and checks what was stored and charged.
 *
 * Whether the account reads well is a human judgement, made by the owner at
 * ship (t-147 is where the person changes it).
 *
 * Needs a seeded, migrated database (the map published, the synopsis seat
 * bound by `026-synopsis-seat`) and a provider for her model. Skips (exit 0,
 * says so) with no database.
 *
 * Self-cleaning: creates one `smoke-app-synopsis-*` user and removes it and
 * every row keyed on it, on every path. Never unscoped deletes.
 *
 * FORK NOTE — this runs the real `lib/app/leaf-bootstrap` seam (`initLeafApp()`)
 * and walks Lelañea's map and onboarding; a fork should replace it.
 *
 * Usage: `npm run smoke:app-synopsis` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { ACKNOWLEDGEMENT_KINDS } from '@/lib/app/gateway/kinds';
import { recordAcknowledgement } from '@/lib/app/gateway/acknowledgements';
import { JOURNEY_MAP_SLUG } from '@/lib/app/journey/map-definition';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { ensureJourneyStarted } from '@/lib/app/journey/start';
import {
  answerDiscoveryQuestion,
  getDiscoveryState,
  skipDiscoveryQuestion,
} from '@/lib/app/onboarding/discovery-store';
import { beginJourney } from '@/lib/app/onboarding/hand-off';
import { getPublishedMapVersion } from '@/lib/framework/facilitation/map/version-service';
import { resolveFacilitationSurface } from '@/lib/framework/facilitation/agents/surface';
import { getFacilitationBindingByRole } from '@/lib/framework/facilitation/agents/binding-queries';
import { runFacilitationTurn } from '@/lib/framework/facilitation/agents/turn-hook';
import { appendSlotValue } from '@/lib/framework/data-slots/values';
import { streamChat } from '@/lib/orchestration/chat';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { arriveSession } from '@/lib/app/sessions/store';
import { SYNOPSIS_SEAT } from '@/lib/app/agent/pins';
import { SYNOPSIS_AGENT_SLUG } from '@/lib/app/journey-record/synopsis/agent';
import { draftSynopsis, SYNOPSIS_COST_KIND } from '@/lib/app/journey-record/synopsis/draft';
import { getJourneyRecord } from '@/lib/app/journey-record/record';
import { runAsOrg } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import type { ChatStream } from '@/lib/orchestration/chat/types';

const PREFIX = 'smoke-app-synopsis';
const stamp = Date.now();
/** Three things they say: a session of substance. */
const SAID = [
  'I have been thinking about leaving my job at the hospital. I trained for nine years to be a nurse and I am tired all the time.',
  'The part I would miss is the night shift on the children’s ward. The part I would not miss is the rota and the way nobody asks how we are.',
  'I think I have decided to talk to my manager on Friday about going part time, and see how that feels before I decide anything bigger.',
];
/** The note the first turn wrote: visible, so the draft lists it. */
const NOTE_SLUG = 'life_work';
const NOTE_VALUE = 'You are weighing whether to leave nursing after nine years.';
/** Thirteen hours: past the twelve-hour gap. */
const QUIET_MS = 13 * 60 * 60 * 1000;
/** How long to wait for the queued draft: a real model, off the request path. */
const DRAFT_WAIT_MS = 120_000;

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
  await prisma.appJourneyEntry.deleteMany({ where: { userId } }).catch(() => undefined);
  // Turns before the events: their session FK points at the event rows.
  await prisma.aiCostLog.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.appTurn.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.journeyEvent.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.userNodeState
    .deleteMany({ where: { journeyId: { in: journeyIds } } })
    .catch(() => undefined);
  await prisma.userJourney.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.appAcknowledgement.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.slotValue.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.appSafetyEvent.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId } } }).catch(() => undefined);
  await prisma.aiConversation.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
}

/** Read a stream to its end. */
async function drain(events: ChatStream): Promise<string> {
  let text = '';
  let done = false;
  let ended: string | null = null;
  for await (const event of events) {
    if (event.type === 'content') text += event.delta;
    if (event.type === 'content_reset') text = '';
    if (event.type === 'done') done = true;
    if (event.type === 'error') ended = `error ${event.code}`;
  }
  if (!done) throw new Error(`the turn did not complete: ${ended ?? 'no done frame'}`);
  // The platform embeds and costs a turn after its stream; let it land.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return text;
}

/** One turn of the person's on the facilitator seat, through the real hook and model. */
async function takeTurn(userId: string, turnId: string, message: string): Promise<string> {
  const surface = await resolveFacilitationSurface(userId, CONVERSATION_SEAT);
  if (surface === null) throw new Error('the facilitator seat resolved no surface');
  const events = await runAsOrg(INSTALL_ORG_ID, () =>
    runFacilitationTurn(
      {
        userId,
        role: CONVERSATION_SEAT,
        agentId: surface.agentId,
        agentSlug: surface.agentSlug,
        conversationId: surface.conversationId,
        message,
        clientTurnId: turnId,
      },
      (extras) =>
        streamChat({
          message,
          agentSlug: surface.agentSlug,
          userId,
          conversationId: surface.conversationId,
          contextType: FACILITATION_CONTEXT_TYPE,
          contextId: CONVERSATION_SEAT,
          ...extras,
        })
    )
  );
  return drain(events);
}

/** Every row of the person's that carries a time, moved back by `ms`: a sitting gone quiet. */
async function moveIntoThePast(userId: string, ms: number): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "framework_journey_event" SET "occurredAt" = "occurredAt" - (${ms} * interval '1 millisecond') WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "app_turn" SET "startedAt" = "startedAt" - (${ms} * interval '1 millisecond'), "completedAt" = "completedAt" - (${ms} * interval '1 millisecond') WHERE "userId" = ${userId}`,
    prisma.$executeRaw`UPDATE "ai_message" SET "createdAt" = "createdAt" - (${ms} * interval '1 millisecond') WHERE "conversationId" IN (SELECT "id" FROM "ai_conversation" WHERE "userId" = ${userId})`,
    prisma.$executeRaw`UPDATE "framework_slot_value" SET "capturedAt" = "capturedAt" - (${ms} * interval '1 millisecond') WHERE "userId" = ${userId}`,
  ]);
}

/** Wait for the session's synopsis to be stored. */
async function waitForDraft(userId: string, sessionId: string) {
  const deadline = Date.now() + DRAFT_WAIT_MS;
  while (Date.now() < deadline) {
    const row = await prisma.appJourneyEntry.findFirst({ where: { userId, sessionId } });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:app-synopsis skipped — no database reachable.');
    return;
  }

  let userId: string | null = null;
  try {
    await initLeafApp();
    if ((await getPublishedMapVersion(JOURNEY_MAP_SLUG)) === null) {
      throw new Error(`the map "${JOURNEY_MAP_SLUG}" is not published — run npm run db:seed`);
    }
    const seat = await getFacilitationBindingByRole(SYNOPSIS_SEAT);
    if (seat?.agent?.slug !== SYNOPSIS_AGENT_SLUG) {
      throw new Error(
        `the "${SYNOPSIS_SEAT}" seat is not held by ${SYNOPSIS_AGENT_SLUG} — run npm run db:seed`
      );
    }

    const user = await prisma.user.create({
      data: {
        name: `${PREFIX} person`,
        email: `${PREFIX}-${stamp}@example.com`,
        emailVerified: true,
      },
    });
    userId = user.id;

    console.log('\n1. Past the gate, through onboarding, into the journey');
    for (const kind of ACKNOWLEDGEMENT_KINDS) await recordAcknowledgement(user.id, kind);
    check((await ensureJourneyStarted(user.id)) === 'started', 'the journey starts');
    const state = await getDiscoveryState(user.id);
    if (state === null) throw new Error('the discovery state could not be read');
    for (const question of state.set.questions) {
      if (question.core || !state.set.pacing.allowPartialCompletion) {
        await answerDiscoveryQuestion(user.id, state.set, question, {
          words: 'A smoke answer.',
          ...(question.conditionalFollowUp && { branch: 'no' as const }),
        });
      } else {
        await skipDiscoveryQuestion(user.id, question.id);
      }
    }
    check((await beginJourney(user.id)) === 'begun', 'the journey is begun');

    console.log('\n2. A session of substance: three exchanges, and a visible note');
    const first = await runAsOrg(INSTALL_ORG_ID, () => arriveSession(user.id));
    check(first.opened, 'arriving opens their session');
    for (const [index, words] of SAID.entries()) {
      const reply = await takeTurn(user.id, `${PREFIX}-${stamp}-${index}`, words);
      console.log(`    her reply ${index + 1}: ${reply.replace(/\s+/g, ' ').slice(0, 160)}…`);
    }
    const firstTurn = await prisma.appTurn.findUnique({
      where: { userId_turnId: { userId: user.id, turnId: `${PREFIX}-${stamp}-0` } },
    });
    if (!firstTurn) throw new Error('the first turn has no row');
    // Written as `fill_slot` would, so what the draft lists does not depend on
    // whether the model chose to record anything.
    const note = await runAsOrg(INSTALL_ORG_ID, () =>
      appendSlotValue({
        userId: user.id,
        slotSlug: NOTE_SLUG,
        value: NOTE_VALUE,
        confidence: 8,
        sourceType: 'unprompted',
        reasoningNote: 'You said it plainly, unprompted.',
        provenance: { conversationId: firstTurn.conversationId ?? undefined },
      })
    );
    await runAsOrg(INSTALL_ORG_ID, () =>
      prisma.appTurnSlotWrite.upsert({
        where: { turnId_slotSlug: { turnId: firstTurn.id, slotSlug: NOTE_SLUG } },
        create: { turnId: firstTurn.id, slotSlug: NOTE_SLUG, version: note.version, minted: false },
        update: {},
      })
    );

    console.log('\n3. The session goes quiet for thirteen hours, and they come back');
    await moveIntoThePast(user.id, QUIET_MS);
    const started = Date.now();
    const second = await runAsOrg(INSTALL_ORG_ID, () => arriveSession(user.id));
    const arrivalMs = Date.now() - started;
    check(
      second.opened && second.session.ordinal === first.session.ordinal + 1,
      'a new session opens'
    );
    check(arrivalMs < 5_000, `the arrival did not wait on the model (${arrivalMs}ms)`);

    console.log('\n4. The draft, written off the request path by the synopsis seat');
    const row = await waitForDraft(user.id, first.session.id);
    if (!row)
      throw new Error(`no draft within ${DRAFT_WAIT_MS / 1000}s — see the log for its outcome`);
    console.log(`\n    SUMMARY: ${row.summary}\n\n    ${row.body.replace(/\n+/g, '\n    ')}\n`);
    console.log(`    outcomes: ${JSON.stringify(row.outcomes)}`);
    console.log(
      `    modules: ${JSON.stringify(row.modules)}  notes: ${JSON.stringify(row.notes)}\n`
    );
    check(row.kind === 'synopsis' && row.state === 'draft', 'it is stored as a draft');
    check(row.keptAt === null, 'and not kept');
    check(
      row.occurredAt.getTime() === first.session.startedAt.getTime() - QUIET_MS,
      'it sits at the session’s start'
    );
    // Her turns may record notes of their own, so the list is checked for this
    // one, at a version the session wrote, not for being only this one.
    const listed = Array.isArray(row.notes) ? (row.notes as Array<Record<string, unknown>>) : [];
    check(
      listed.some((ref) => ref.slotSlug === NOTE_SLUG && typeof ref.version === 'number'),
      'it lists the visible note the session wrote'
    );
    check(
      listed.every((ref) => typeof ref.slotSlug === 'string' && !('value' in ref)),
      'as references, never readings'
    );

    const view = await runAsOrg(INSTALL_ORG_ID, () => getJourneyRecord(user.id));
    check(view.total === 0, 'the kept record does not show it');
    const withDrafts = await runAsOrg(INSTALL_ORG_ID, () =>
      getJourneyRecord(user.id, { drafts: true })
    );
    check(withDrafts.drafts === 1, 'what is waiting does');

    const charged = await prisma.aiCostLog.findMany({
      where: { userId: user.id, metadata: { path: ['kind'], equals: SYNOPSIS_COST_KIND } },
    });
    // The cost row is written without waiting; give it a moment.
    if (charged.length === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
    const chargedRows = await prisma.aiCostLog.count({
      where: { userId: user.id, metadata: { path: ['kind'], equals: SYNOPSIS_COST_KIND } },
    });
    check(chargedRows === 1, 'the person is charged for it, once');

    console.log('\n5. Asked again, the session is not drafted twice');
    const again = await runAsOrg(INSTALL_ORG_ID, () =>
      draftSynopsis(
        user.id,
        { ...first.session, closedAt: row.occurredAt, nextStartedAt: second.session.startedAt },
        new Date()
      )
    );
    check(again === 'exists', 'a second request finds the draft and calls nothing');

    console.log('\n✓ smoke:app-synopsis passed');
  } finally {
    if (userId) await cleanup(userId);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-synopsis failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
