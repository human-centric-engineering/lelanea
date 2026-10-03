/**
 * Smoke: the guiding and teaching registers, on the real development database
 * and a real model (§12, t-125).
 *
 * The unit tests mock the journey, the module config and the turn row, so they
 * prove the rules and the calls. What they cannot prove is the wiring: that a
 * person handed off into Values is read as being in Values; that Values'
 * stored config starts it at teaching; that the claim stamps the turn row; that
 * the context block the real `buildContext` frames for the facilitator seat
 * carries that register's overlay; that the `done` frame and the transcript
 * read say the same register; and that the same question, asked once the
 * module says guiding, gets a reply in the other register. Then the person
 * asks to be met gently (t-126): the AI records the lean, and the next turn is
 * guiding because they asked. Then a crisis
 * recorded for the person holds the next turn at guiding whatever the module
 * says.
 *
 * Both replies are printed. Whether each sounds like its register is a human
 * judgement, made by the owner at ship and by Lelañea at project end (idea
 * #46); this asserts what a script can: which overlay the prompt carried and
 * what the record says.
 *
 * Needs a seeded, migrated database (the map published, Onboarding and Values
 * active, the gate's documents, the guiding and teaching overlays from
 * `20261007100100_app_voice_register_overlays`) and a provider for her pinned
 * model: six small turns. Skips (exit 0, says so) with no database.
 *
 * Self-cleaning: creates one `smoke-app-register-*` user and removes it and
 * every row keyed on it, on every path, and puts Values' config back exactly
 * as it found it. Never unscoped deletes.
 *
 * FORK NOTE — this runs the real `lib/app/leaf-bootstrap` seam (`initLeafApp()`),
 * because the journey and the module config it reads come from the module
 * registry that seam fills. It asserts Lelañea's map, its Values module and the
 * guiding and teaching overlays; a fork with other modules or no registers
 * should replace this script rather than pin ours.
 *
 * Usage: `npm run smoke:app-register` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { ACKNOWLEDGEMENT_KINDS } from '@/lib/app/gateway/kinds';
import { recordAcknowledgement } from '@/lib/app/gateway/acknowledgements';
import { JOURNEY_MAP_SLUG, VALUES_NODE_KEY } from '@/lib/app/journey/map-definition';
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
import { streamChat } from '@/lib/orchestration/chat';
import { buildContext, clearContextCache } from '@/lib/orchestration/chat/context-builder';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { getVoiceOverlays } from '@/lib/app/content/voice-overlay-store';
import { resolveRegister } from '@/lib/app/voice/register-store';
import { readTranscript } from '@/lib/app/conversation/transcript';
import type { AuthenticatedSession } from '@/lib/auth/guards';
import { DEFAULT_USER_ROLE } from '@/lib/auth/roles';
import { runAsOrg } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import type { ChatEvent } from '@/types/orchestration';

const PREFIX = 'smoke-app-register';
const stamp = Date.now();
/** The same question in both registers: one that could be held or pushed. */
const QUESTION =
  'I keep saying honesty is my most important value, but I lied to my manager last week to avoid a hard conversation. What do I do with that?';

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
  await prisma.appSafetyEvent.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId } } }).catch(() => undefined);
  await prisma.aiCostLog.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.appTurn.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.aiConversation.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
}

/** One person's turn on the facilitator seat, through the real turn hook and model. */
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
  let text = '';
  let done: (ChatEvent & { type: 'done' }) | null = null;
  let ended: string | null = null;
  for await (const event of events) {
    if (event.type === 'content') text += event.delta;
    if (event.type === 'content_reset') text = '';
    if (event.type === 'done') done = event;
    if (event.type === 'error') ended = `error ${event.code}`;
  }
  if (done === null) throw new Error(`the turn did not complete: ${ended ?? 'no done frame'}`);
  // The platform embeds the turn and logs its cost after the stream; let it land.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const row = await prisma.appTurn.findUnique({
    where: { userId_turnId: { userId, turnId } },
  });
  return { text, done: done as ChatEvent & { register?: string; registerSource?: string }, row };
}

/**
 * A fresh conversation for the next question. Asked twice in one conversation,
 * the model reads its first answer and repeats it, which compares the history
 * rather than the register. Turn rows are kept: the record is what is asserted.
 */
async function freshConversation(userId: string): Promise<void> {
  // The platform embeds and costs a turn after its stream; let that land first.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId } } });
  await prisma.aiConversation.deleteMany({ where: { userId } });
}

/** The facilitator block a turn's prompt carries, as `buildContext` frames it. */
async function facilitatorBlock(userId: string): Promise<string> {
  clearContextCache();
  return runAsOrg(INSTALL_ORG_ID, () =>
    buildContext(FACILITATION_CONTEXT_TYPE, CONVERSATION_SEAT, { userId })
  );
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:app-register skipped — no database reachable.');
    return;
  }

  let userId: string | null = null;
  let valuesRow: { id: string; config: Prisma.JsonValue } | null = null;
  try {
    await initLeafApp();
    if ((await getPublishedMapVersion(JOURNEY_MAP_SLUG)) === null) {
      throw new Error(`the map "${JOURNEY_MAP_SLUG}" is not published — run npm run db:seed`);
    }
    const overlays = await runAsOrg(INSTALL_ORG_ID, () => getVoiceOverlays());
    const heading = (situation: string) => {
      const overlay = overlays.overlays.find((o) => o.situation === situation);
      if (!overlay) {
        throw new Error(`no "${situation}" overlay — run npm run db:migrate:deploy`);
      }
      return overlay.heading;
    };
    const guidingHeading = heading('guiding');
    const teachingHeading = heading('teaching');

    const values = await prisma.module.findFirst({ where: { slug: VALUES_NODE_KEY } });
    if (!values) throw new Error('no Values module row — run npm run db:seed');
    valuesRow = { id: values.id, config: values.config };

    const user = await prisma.user.create({
      data: { name: `${PREFIX} person`, email: `${PREFIX}-${stamp}@example.com` },
    });
    userId = user.id;

    console.log('\n1. Past the gate, through onboarding, into Values');
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
    check((await beginJourney(user.id)) === 'begun', 'the journey is begun, into Values');

    console.log('\n2. Values, as it starts: teaching');
    // As an operator would find it: nothing stored, so the module's start applies.
    await prisma.module.update({ where: { id: values.id }, data: { config: {} } });
    check(
      (await resolveRegister(user.id, CONVERSATION_SEAT))?.register === 'teaching',
      'the person is read as in Values, and Values starts at teaching'
    );
    const teaching = await takeTurn(user.id, `${PREFIX}-${stamp}-teaching`, QUESTION);
    console.log(`    the reply: ${teaching.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    check(
      teaching.row?.register === 'teaching' && teaching.row.registerSource === 'module',
      'the turn row says teaching, from the module'
    );
    check(teaching.done.register === 'teaching', 'and so does the done frame');

    console.log('\n3. The same question, once Values says guiding');
    await prisma.module.update({
      where: { id: values.id },
      data: { config: { register: 'guiding' } },
    });
    await freshConversation(user.id);
    const guiding = await takeTurn(user.id, `${PREFIX}-${stamp}-guiding`, QUESTION);
    console.log(`    the reply: ${guiding.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    check(
      guiding.row?.register === 'guiding' && guiding.row.registerSource === 'module',
      'the turn row says guiding, from the module'
    );
    check(guiding.done.register === 'guiding', 'and so does the done frame');
    check(guiding.text !== teaching.text, 'and the two replies differ');

    console.log('\n4. The prompt carries the register it was steered to');
    // Outside a turn, the block decides as a claim would.
    const guidingBlock = await facilitatorBlock(user.id);
    check(
      guidingBlock.includes(guidingHeading) && !guidingBlock.includes(teachingHeading),
      'with Values at guiding, the facilitator block is the guiding overlay alone'
    );
    await prisma.module.update({ where: { id: values.id }, data: { config: {} } });
    const teachingBlock = await facilitatorBlock(user.id);
    check(
      teachingBlock.includes(teachingHeading) && !teachingBlock.includes(guidingHeading),
      'with Values at its start, the teaching overlay alone'
    );

    console.log('\n5. The person asks to be met gently (t-126)');
    // Values back at its start, so the ask is what moves it.
    await prisma.module.update({ where: { id: values.id }, data: { config: {} } });
    await freshConversation(user.id);
    const asked = await takeTurn(
      user.id,
      `${PREFIX}-${stamp}-ask`,
      'Please be gentle with me today. I can’t take being pushed right now.'
    );
    console.log(`    the reply: ${asked.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    const reply = asked.row?.assistantMessageId
      ? await prisma.aiMessage.findUnique({ where: { id: asked.row.assistantMessageId } })
      : null;
    check(
      JSON.stringify(reply?.provenance ?? {}).includes('set_register'),
      'the AI called set_register when the person asked'
    );
    const node = await prisma.userNodeState.findFirst({
      where: { journey: { userId: user.id }, nodeKey: VALUES_NODE_KEY },
    });
    check(
      JSON.stringify(node?.progress ?? {}).includes('"registerLean"'),
      'the lean is on the Values node’s own ledger'
    );
    const after = await takeTurn(user.id, `${PREFIX}-${stamp}-after-ask`, QUESTION);
    console.log(`    the next reply: ${after.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    check(
      after.row?.register === 'guiding' && after.row.registerSource === 'asked',
      'the next turn in Values is guiding, because they asked'
    );

    console.log('\n6. Something hard holds it at guiding, whatever the module says');
    await prisma.appSafetyEvent.create({
      data: {
        kind: 'crisis',
        userId: user.id,
        seat: CONVERSATION_SEAT,
        detectedTier: 'soft',
        actedTier: 'soft',
        categories: [],
      },
    });
    const held = await takeTurn(user.id, `${PREFIX}-${stamp}-held`, 'Can we keep going?');
    check(
      held.row?.register === 'guiding' && held.row.registerSource === 'safety',
      'the next turn in Values is guiding, from safety'
    );

    console.log('\n7. The transcript says what the stream said');
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
    const read = await readTranscript(session, CONVERSATION_SEAT);
    const registers = read.entries.flatMap((entry) =>
      entry.kind === 'reply' && entry.turn ? [entry.turn.register] : []
    );
    check(
      JSON.stringify(registers) === JSON.stringify(['teaching', 'guiding', 'guiding']),
      `this conversation's replies read back as teaching, guiding, guiding (${registers.join(', ')})`
    );

    console.log('\n✓ smoke:app-register passed');
  } finally {
    if (valuesRow !== null) {
      await prisma.module
        .update({
          where: { id: valuesRow.id },
          data: { config: valuesRow.config as Prisma.InputJsonValue },
        })
        .catch(() => undefined);
    }
    if (userId) await cleanup(userId);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-register failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
