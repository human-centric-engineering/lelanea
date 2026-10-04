/**
 * Smoke: a person's leanings at their extremes, on the real development
 * database and a real model (f-leanings t-136; §5 "User preference is a filter").
 *
 * The unit tests prove the selection rules, that a leaning only adds, and the
 * wiring piece by piece against mocks. What they cannot prove is the chain:
 * that a dial set through the real settings service is read at the real claim,
 * stamped on the turn row, read back into the block the real `buildContext`
 * frames, and named on the `done` frame and the transcript read alike. Nor can
 * they say whether every dial pushed to its extreme still sounds like her, and
 * whether a refusal or a decline holds there. That last is a human judgement,
 * so every reply is printed in full, for the owner at ship and Lelañea at
 * project end (idea #46).
 *
 * Four configurations, each in Values (which starts at teaching):
 *
 * 1. Every dial at its left extreme.
 * 2. Every dial at its right extreme (the drafted bounds stop warm ↔ cool and
 *    question-led ↔ guidance-led at 1, so those two are as far as a person can
 *    take them).
 * 3. and 4. The same two after a crisis is recorded for the person: the
 *    register holds at guiding from safety, and the harder poles are held at
 *    rest and named.
 *
 * Each configuration asks the register smoke's question and the golden set's
 * own `refusal` and `decline` prompts (all of them at 1 and 2; one of each at 3
 * and 4), each in a fresh conversation, read from the golden set file rather
 * than typed here.
 *
 * Needs a seeded, migrated database (the map published, Onboarding and Values
 * active, the leaning rows from `20261011100100_app_voice_leaning_overlays`)
 * and a provider for her pinned model: about twenty turns. Skips (exit 0, says
 * so) with no database.
 *
 * Self-cleaning: creates one `smoke-app-leanings-*` user and removes it and
 * every row keyed on it, on every path, and puts Values' config back exactly as
 * it found it. Never unscoped deletes.
 *
 * FORK NOTE — this runs the real `lib/app/leaf-bootstrap` seam, and asserts
 * Lelañea's map, its Values module and its leaning rows; a fork should replace
 * it rather than pin ours.
 *
 * Usage: `npm run smoke:app-leanings` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

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
import { getLeanings, setLeaning } from '@/lib/app/voice/leanings-store';
import {
  HELD_WHEN_HARD,
  LEANING_FRAMING_SITUATION,
  leaningSituation,
  parseLeaningsStamp,
  type LeaningsStamp,
} from '@/lib/app/voice/leanings-select';
import { LEANING_DIMENSIONS, type LeaningStop } from '@/lib/app/voice/leanings';
import { leaningsSentences, registerSentence } from '@/lib/app/conversation/account';
import { readTranscript, type TurnAccount } from '@/lib/app/conversation/transcript';
import type { AuthenticatedSession } from '@/lib/auth/guards';
import { DEFAULT_USER_ROLE } from '@/lib/auth/roles';
import { runAsOrg } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import type { ChatEvent } from '@/types/orchestration';

const PREFIX = 'smoke-app-leanings';
const stamp = Date.now();
/** The register smoke's question: one that could be held or pushed. */
const QUESTION =
  'I keep saying honesty is my most important value, but I lied to my manager last week to avoid a hard conversation. What do I do with that?';

interface GoldenPrompt {
  kind: string;
  prompt: string;
}

/** The golden set's refusal and decline prompts, as authored. */
function goldenPrompts(): { refusals: string[]; declines: string[] } {
  const file = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'seed-data/drafted/lelanea_voice_golden_set.json'),
      'utf8'
    )
  ) as { prompts: GoldenPrompt[] };
  const of = (kind: string) => file.prompts.filter((p) => p.kind === kind).map((p) => p.prompt);
  return { refusals: of('refusal'), declines: of('decline') };
}

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

type Done = ChatEvent & { type: 'done'; leanings?: unknown; register?: string };

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
  let done: Done | null = null;
  let ended: string | null = null;
  let crisis = false;
  for await (const event of events) {
    if (event.type === 'content') text += event.delta;
    if (event.type === 'content_reset') text = '';
    if (event.type === 'done') done = event;
    if (event.type === 'error') ended = `error ${event.code}`;
    if (event.type === 'warning' && event.code === 'crisis') crisis = true;
  }
  if (done === null) throw new Error(`the turn did not complete: ${ended ?? 'no done frame'}`);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const row = await prisma.appTurn.findUnique({ where: { userId_turnId: { userId, turnId } } });
  return { text, done, row, crisis };
}

/** A fresh conversation for the next prompt; turn rows are kept, they are what is asserted. */
async function freshConversation(userId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId } } });
  await prisma.aiConversation.deleteMany({ where: { userId } });
}

/** The facilitator block a prompt carries, as `buildContext` frames it outside a turn. */
async function facilitatorBlock(userId: string): Promise<string> {
  clearContextCache();
  return runAsOrg(INSTALL_ORG_ID, () =>
    buildContext(FACILITATION_CONTEXT_TYPE, CONVERSATION_SEAT, { userId })
  );
}

/** Every dial as far toward one side as the bounds allow, through the real service. */
async function setEveryDial(userId: string, side: -2 | 2): Promise<void> {
  for (const dimension of LEANING_DIMENSIONS) {
    await setLeaning({ userId, key: dimension.key, stop: side, via: 'settings' });
  }
}

/** What selection should stamp for every dial at `side`, given today's bounds. */
async function expectedStamp(
  userId: string,
  side: -2 | 2,
  holding: boolean
): Promise<LeaningsStamp> {
  const view = await getLeanings(userId);
  const applied: LeaningsStamp['applied'] = [];
  const held: LeaningsStamp['held'] = [];
  const hardSide = side < 0 ? 'left' : 'right';
  for (const dial of view.dials) {
    if (dial.position === 0) continue;
    if (holding && HELD_WHEN_HARD.get(dial.key) === hardSide) held.push(dial.key);
    else applied.push({ key: dial.key, stop: dial.position });
  }
  return { applied, held };
}

function print(label: string, text: string): void {
  console.log(`\n    ── ${label} ──`);
  for (const line of text.trim().split('\n')) console.log(`    │ ${line}`);
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:app-leanings skipped — no database reachable.');
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
    const rowHeading = (situation: string) => {
      const row = overlays.overlays.find((o) => o.situation === situation);
      if (!row) throw new Error(`no "${situation}" row — run npm run db:migrate:deploy`);
      return row.heading;
    };
    const framingHeading = rowHeading(LEANING_FRAMING_SITUATION);
    const golden = goldenPrompts();
    if (golden.refusals.length === 0 || golden.declines.length === 0) {
      throw new Error('the golden set has no refusal or decline prompts to ask');
    }

    const values = await prisma.module.findFirst({ where: { slug: VALUES_NODE_KEY } });
    if (!values) throw new Error('no Values module row — run npm run db:seed');
    valuesRow = { id: values.id, config: values.config };
    // As an operator would find it: nothing stored, so Values starts at teaching.
    await prisma.module.update({ where: { id: values.id }, data: { config: {} } });

    const user = await prisma.user.create({
      data: { name: `${PREFIX} person`, email: `${PREFIX}-${stamp}@example.com` },
    });
    userId = user.id;

    console.log('\n0. Past the gate, through onboarding, into Values');
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

    const configurations = [
      { n: 1, side: -2 as const, crisis: false, name: 'every dial at its left extreme' },
      { n: 2, side: 2 as const, crisis: false, name: 'every dial at its right extreme' },
      { n: 3, side: -2 as const, crisis: true, name: 'left extreme, after a crisis' },
      { n: 4, side: 2 as const, crisis: true, name: 'right extreme, after a crisis' },
    ];
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

    for (const config of configurations) {
      console.log(`\n${config.n}. ${config.name[0].toUpperCase()}${config.name.slice(1)}`);
      await setEveryDial(user.id, config.side);
      if (config.crisis) {
        const existing = await prisma.appSafetyEvent.count({
          // Crises only: a refusal prompt above may have recorded a misuse event.
          where: { userId: user.id, kind: 'crisis' },
        });
        if (existing === 0) {
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
        }
      }
      const want = await expectedStamp(user.id, config.side, config.crisis);
      check(
        want.applied.length > 0 && (!config.crisis || want.held.length > 0),
        `the population is real: ${want.applied.length} applied, ${want.held.length} to hold`
      );

      // The block, decided as a claim would, carries the framing and every applied pole.
      const block = await facilitatorBlock(user.id);
      check(block.includes(framingHeading), 'the facilitator block carries the leanings framing');
      check(
        want.applied.every(({ key, stop }) =>
          block.includes(rowHeading(leaningSituation(key, stop)!))
        ),
        'and every applied pole row'
      );
      const heldHeadings = want.held.flatMap((key) => {
        const hard = HELD_WHEN_HARD.get(key) === 'right' ? 1 : -1;
        return [hard, hard * 2].map((stop) =>
          rowHeading(leaningSituation(key, stop as LeaningStop)!)
        );
      });
      const leaked = heldHeadings.filter((heading) => block.includes(heading));
      if (leaked.length > 0) {
        const running = await prisma.appTurn.findMany({
          where: { userId: user.id, status: 'running' },
          select: { turnId: true, startedAt: true, leanings: true },
        });
        console.log('    held headings in the block:', leaked);
        console.log('    running turn rows:', JSON.stringify(running));
      }
      check(leaked.length === 0, 'and none of a held pole');
      check(
        block.includes(rowHeading(config.crisis ? 'guiding' : 'teaching')),
        `under the ${config.crisis ? 'guiding' : 'teaching'} register, which is still whole`
      );

      const prompts = config.crisis
        ? [QUESTION, golden.refusals[0], golden.declines[0]]
        : [QUESTION, ...golden.refusals, ...golden.declines];
      for (const [index, prompt] of prompts.entries()) {
        await freshConversation(user.id);
        const turn = await takeTurn(user.id, `${PREFIX}-${stamp}-${config.n}-${index}`, prompt);
        const stored = parseLeaningsStamp(turn.row?.leanings);
        check(
          JSON.stringify(stored) === JSON.stringify(want),
          `turn ${config.n}.${index + 1}: the row is stamped with the leanings selected`
        );
        check(
          JSON.stringify(turn.done.leanings) === JSON.stringify(stored),
          'and the done frame says the same'
        );
        check(
          turn.row?.register === (config.crisis ? 'guiding' : 'teaching') &&
            turn.row.registerSource === (config.crisis ? 'safety' : 'module'),
          `and the register is ${config.crisis ? 'guiding, from safety' : 'teaching, from the module'}`
        );
        const transcript = await readTranscript(session, CONVERSATION_SEAT);
        const account = transcript.entries.flatMap((e) =>
          e.kind === 'reply' && e.turn ? [e.turn] : []
        )[0] as TurnAccount | undefined;
        check(
          JSON.stringify(account?.leanings) === JSON.stringify(stored),
          'and so does the transcript read'
        );
        print(`asked: ${prompt.slice(0, 110)}${prompt.length > 110 ? '…' : ''}`, turn.text);
        console.log(
          `    account: ${[registerSentence(account ?? null), ...leaningsSentences(account ?? null)]
            .filter(Boolean)
            .join(' ')}`
        );
      }
    }

    console.log('\n✓ smoke:app-leanings passed');
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
  console.error('\n✗ smoke:app-leanings failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
