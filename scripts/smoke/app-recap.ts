/**
 * Smoke: the session recap, on the real development database and a real model
 * (f-recap t-142).
 *
 * The unit tests fake the database and mock the hook, so they prove the rules
 * and the queries. What they cannot prove is the wiring: that a person who
 * said something specific in a session that went quiet is met with it, in her
 * voice, when they come back; that the material reaches the model and the
 * turn row keeps what it drew on; that the transcript stands the recap as its
 * own reply; and that a reload neither repeats it nor runs it again.
 *
 * 1. Seeds a person through onboarding, and a first session in which they say
 *    something specific (a real turn) and a note is captured.
 * 2. Moves that session more than twelve hours into the past.
 * 3. Arrives, as the pane's read does: a second session opens and the recap
 *    is owed.
 * 4. Runs the recap through the real hook and model, and prints it.
 *
 * Whether it reads like a coach opening a session is a human judgement, made
 * by the owner at ship; this asserts what a script can: that it names the
 * phrase and does not ask for the note's value.
 *
 * Needs a seeded, migrated database (the map published, Onboarding and Values
 * active, the gate's documents) and a provider for her pinned model: two
 * small turns. Skips (exit 0, says so) with no database.
 *
 * Self-cleaning: creates one `smoke-app-recap-*` user and removes it and every
 * row keyed on it, on every path. Never unscoped deletes.
 *
 * FORK NOTE — this runs the real `lib/app/leaf-bootstrap` seam (`initLeafApp()`)
 * and asserts Lelañea's map and slot taxonomy; a fork should replace it.
 *
 * Usage: `npm run smoke:app-recap` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import { isDeepStrictEqual } from 'node:util';

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
import { runFacilitationTurn } from '@/lib/framework/facilitation/agents/turn-hook';
import { appendSlotValue } from '@/lib/framework/data-slots/values';
import { streamChat } from '@/lib/orchestration/chat';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { readTranscript } from '@/lib/app/conversation/transcript';
import { accountParts } from '@/lib/app/conversation/account';
import { recapTurnId } from '@/lib/app/conversation/opening-id';
import { prepareRecap, recapDue, runRecap } from '@/lib/app/conversation/recap';
import { arriveSession } from '@/lib/app/sessions/store';
import type { AuthenticatedSession } from '@/lib/auth/guards';
import { DEFAULT_USER_ROLE } from '@/lib/auth/roles';
import { runAsOrg } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import type { ChatStream } from '@/lib/orchestration/chat/types';
import type { ChatEvent } from '@/types/orchestration';

const PREFIX = 'smoke-app-recap';
const stamp = Date.now();
/** The specific thing they say, and the word that names it when it is not quoted. */
const SAID =
  'I keep thinking about my grandmother’s lighthouse on the Cornish coast. She kept the light for thirty years and never once asked anyone for help.';
const PHRASE_WORD = 'lighthouse';
/** The note captured in that session: what she must not ask for again. */
const NOTE_SLUG = 'life_wealth';
const NOTE_VALUE = 'They are saving to buy a narrowboat and live on the canals.';
/** Thirteen hours: past the twelve-hour gap. */
const QUIET_MS = 13 * 60 * 60 * 1000;

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
  // Turns first: their session FK points at the event rows.
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

/** Read a stream to its end: the reply, and the `done` frame if it came. */
async function drain(events: ChatStream) {
  let text = '';
  let done: (ChatEvent & { type: 'done' } & Record<string, unknown>) | null = null;
  let ended: string | null = null;
  for await (const event of events) {
    if (event.type === 'content') text += event.delta;
    if (event.type === 'content_reset') text = '';
    if (event.type === 'done') done = event;
    if (event.type === 'error') ended = `error ${event.code}`;
  }
  if (done === null) throw new Error(`the turn did not complete: ${ended ?? 'no done frame'}`);
  // The platform embeds and costs a turn after its stream; let it land.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return { text, done };
}

/** One turn of the person's on the facilitator seat, through the real hook and model. */
async function takeTurn(userId: string, turnId: string, message: string) {
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

/**
 * Whether the recap quotes what they said — a span of at least three words in
 * quotation marks, found word for word in it — or names it.
 */
function namesWhatTheySaid(text: string): boolean {
  const plain = (words: string) => words.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const quotes = [...text.matchAll(/["“]([^"”]+)["”]/g)].map((match) => plain(match[1]));
  const quoted = quotes.some(
    (quote) => quote.split(' ').length >= 3 && plain(SAID).includes(quote.replace(/[.,]$/, ''))
  );
  return quoted || text.toLowerCase().includes(PHRASE_WORD);
}

/** A question that asks for what the note already holds: their money, their saving. */
function asksForTheNote(text: string): boolean {
  const questions = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.includes('?'));
  return questions.some((question) =>
    /\bwhat\b.*\b(money|finances?|financially|wealth|saving|savings)\b/i.test(question)
  );
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:app-recap skipped — no database reachable.');
    return;
  }

  let userId: string | null = null;
  try {
    await initLeafApp();
    if ((await getPublishedMapVersion(JOURNEY_MAP_SLUG)) === null) {
      throw new Error(`the map "${JOURNEY_MAP_SLUG}" is not published — run npm run db:seed`);
    }

    const user = await prisma.user.create({
      data: {
        name: `${PREFIX} person`,
        email: `${PREFIX}-${stamp}@example.com`,
        emailVerified: true,
      },
    });
    userId = user.id;
    const subject = { id: user.id, email: user.email, emailVerified: true };

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

    console.log('\n2. The first session: they say something specific, and a note is kept');
    const first = await arriveSession(user.id);
    check(first.opened && first.session.ordinal === 1, 'arriving opens their first session');
    const said = await takeTurn(user.id, `${PREFIX}-${stamp}-said`, SAID);
    console.log(`    her reply: ${said.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    const saidRow = await prisma.appTurn.findUnique({
      where: { userId_turnId: { userId: user.id, turnId: `${PREFIX}-${stamp}-said` } },
    });
    check(saidRow?.sessionId === first.session.id, 'the turn is stamped with that session');
    await appendSlotValue({
      userId: user.id,
      slotSlug: NOTE_SLUG,
      value: NOTE_VALUE,
      confidence: 8,
      sourceType: 'direct',
      reasoningNote: 'They said so in the first session.',
      provenance: { conversationId: saidRow?.conversationId ?? undefined },
    });
    check(
      (await recapDue(subject, first.session)) === null,
      'no recap is owed inside the session they are in'
    );

    console.log('\n3. That session goes quiet for thirteen hours, and they come back');
    await moveIntoThePast(user.id, QUIET_MS);
    const second = await arriveSession(user.id);
    check(second.opened && second.session.ordinal === 2, 'arriving opens a second session');
    const turnId = recapTurnId(second.session.id);
    check((await recapDue(subject, second.session)) === turnId, 'the recap is owed, keyed on it');

    console.log('\n4. The recap, through the real hook and model');
    const ready = await runAsOrg(INSTALL_ORG_ID, () => prepareRecap(subject));
    if (!ready.ready) throw new Error(`the recap was not ready: ${ready.reason}`);
    check(ready.turnId === turnId, 'it runs under the session’s recap id');
    check(ready.material.text.includes(PHRASE_WORD), 'its material carries what they said');
    check(ready.material.text.includes(NOTE_VALUE), 'and the note captured since, as it was kept');
    const recap = await runAsOrg(INSTALL_ORG_ID, async () =>
      drain(await runRecap(ready, { user: subject }))
    );
    console.log(`\n    THE RECAP:\n    ${recap.text.replace(/\n+/g, '\n    ')}\n`);
    check(namesWhatTheySaid(recap.text), 'it quotes or names what they said');
    check(!asksForTheNote(recap.text), 'it does not ask for what the note already holds');
    check(
      isDeepStrictEqual(recap.done.recap, ready.material.account),
      'its done frame says what it drew on'
    );
    const row = await prisma.appTurn.findUnique({
      where: { userId_turnId: { userId: user.id, turnId } },
    });
    check(
      row?.status === 'completed' && row.userMessageId === null,
      'the turn is recorded, with no words in their name'
    );
    check(row?.sessionId === second.session.id, 'stamped with the new session');
    check(
      // Compared as values: `jsonb` stores keys in its own order.
      isDeepStrictEqual(row?.recap, ready.material.account),
      'and keeps what it drew on'
    );

    console.log('\n5. A reload: the recap stands, and is not owed again');
    check((await recapDue(subject, second.session)) === null, 'the pane is not told to ask again');
    const session = {
      user: { id: user.id, role: DEFAULT_USER_ROLE },
      principal: { userId: user.id, role: DEFAULT_USER_ROLE, credential: 'session' },
      unattributedReads: {
        conversation: false,
        dataset: false,
        execution: false,
        experiment: false,
      },
    } as unknown as AuthenticatedSession;
    const read = await runAsOrg(INSTALL_ORG_ID, () => readTranscript(session, CONVERSATION_SEAT));
    const replies = read.entries.filter((entry) => entry.kind === 'reply');
    check(replies.length === 2, 'the transcript holds two replies: last session’s and the recap');
    const last = replies[replies.length - 1];
    check(
      last.kind === 'reply' && last.turnId === turnId && last.text === recap.text,
      'the recap stands as its own reply, word for word'
    );
    const parts =
      last.kind === 'reply'
        ? accountParts({
            at: last.at,
            capabilities: last.capabilities,
            citations: last.citations,
            suggestions: last.suggestions,
            leaningChanges: last.leaningChanges,
            turn: last.turn,
          })
        : [];
    console.log(`    the account: ${parts.map((part) => part.detail).join(' ')}`);
    check(parts[0]?.key === 'recap', 'and the account under it names the recap and its material');
    const replay = await runAsOrg(INSTALL_ORG_ID, async () => {
      const again = await prepareRecap(subject);
      if (!again.ready) throw new Error(`the replay was refused: ${again.reason}`);
      return drain(await runRecap(again, { user: subject }));
    });
    const replayed = await prisma.appTurn.findUnique({
      where: { userId_turnId: { userId: user.id, turnId } },
    });
    check(replay.text === recap.text, 'asked again, it is the same reply');
    check(replayed?.attempts === 1, 'with no second model call');

    console.log('\n✓ smoke:app-recap passed');
  } finally {
    if (userId) await cleanup(userId);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-recap failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
