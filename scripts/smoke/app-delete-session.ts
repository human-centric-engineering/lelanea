/**
 * Smoke: deleting a whole session, and a module's worth, on the real
 * development database (f-forget-session t-153, t-155).
 *
 * The unit tests run the deletion against a Prisma fake. What the fake cannot
 * prove is the wiring underneath it: that the session's turns are found by
 * their real `sessionId` stamp, that the recap which looked back on the
 * session is found by its account on a real `app_turn` row, that the kept
 * account goes with its row, and that what the next recap would be given holds
 * nothing of the deleted session while the kept one is all still there.
 *
 * Flow:
 *   1. A throwaway person with three sessions in one conversation. The first is
 *      kept: one exchange. The second is deleted: opened by a recap of the
 *      first, then an exchange that writes a note, with a kept account quoting
 *      it. The third is opened by a recap drawn from that account.
 *   2. Delete the second session, taking its account. Assert its messages,
 *      turns, note version and account are gone, the third session's recap
 *      with them, and the session rows all stay.
 *   3. Assert what the AI reads next: no message, note or recap material
 *      holds the deleted session's words, and the kept session's are all
 *      still there.
 *   4. A fourth session, kept, with one exchange stamped with one module and
 *      one with another. Delete the first module's worth. Assert its exchange,
 *      messages and note version are gone by their real `moduleSlug` stamp,
 *      the other module's exchange and the unstamped first session stay, and
 *      the kept account is flagged rather than removed.
 *
 * The person's memory vectors are not written here: only `memory-index.ts`
 * touches that table (`index-boundary.test.ts`). They go with their messages
 * by the `messageId` FK cascade, which `smoke:app-memory-index` proves for a
 * deleted exchange; this proves the messages go.
 *
 * No server and no model: everything runs in this process. Skips (exit 0, says
 * so) with no database or no agent to hang a conversation on.
 *
 * Self-cleaning: one `smoke-app-delete-session-*` user, and everything keyed on
 * it, removed on every path. Never unscoped deletes.
 *
 * Usage: `npm run smoke:app-delete-session` (reads `.env.local`). Exit 0 on
 * every assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { appendSlotValue, getSlotHeads } from '@/lib/framework/data-slots';
import { deleteSession } from '@/lib/app/memory/delete-session';
import { deleteModuleExchanges } from '@/lib/app/memory/delete-module';
import { isRemoved } from '@/lib/app/slots/removed';
import { recapTurnId } from '@/lib/app/conversation/opening-id';
import { readRecapMaterial } from '@/lib/app/conversation/recap';
import { SESSION_EVENT_TYPE, sessionEventId } from '@/lib/app/sessions/store';

const PREFIX = 'smoke-app-delete-session';
const stamp = Date.now();
/** A taxonomy slug, open and standard, so the heading stays whatever happens. */
const SLUG = 'current_circumstances';
const SAID_KEPT = 'I walk the dog by the river every morning';
const SAID_GONE = 'I am thinking of leaving my job at the bank';
const SAID_IN_MODULE = 'What I value most is being trusted by my sister';
const SAID_ELSEWHERE = 'I trust my own judgement more than I used to';
/** A taxonomy heading of its own, so the module's version is not a later reading of `SLUG`. */
const MODULE_SLOT = 'values_named';

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

/** Moments a second apart, so the window bounds are unambiguous. */
function at(seconds: number): Date {
  return new Date(stamp + seconds * 1000);
}

async function main(): Promise<void> {
  console.log('\nsmoke:app-delete-session\n');
  if (!(await dbReachable())) {
    console.log('skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }
  const agent = await prisma.aiAgent.findFirst({ select: { id: true, slug: true } });
  if (!agent) {
    console.log('skipped — no agent in this database to hang a conversation on (run db:seed).');
    return;
  }

  let userId: string | null = null;
  try {
    const user = await prisma.user.create({
      data: { name: `${PREFIX} person`, email: `${PREFIX}-${stamp}@example.com` },
    });
    userId = user.id;

    console.log('1. Three sessions in one conversation, the second to be deleted');
    const conversation = await prisma.aiConversation.create({
      data: { userId: user.id, agentId: agent.id, title: SAID_KEPT.slice(0, 80) },
    });
    const say = (role: string, content: string, seconds: number) =>
      prisma.aiMessage.create({
        data: { conversationId: conversation.id, role, content, createdAt: at(seconds) },
      });
    const m1 = await say('user', SAID_KEPT, 1);
    const m2 = await say('assistant', 'That sounds like a good start to the day.', 2);
    const r2 = await say('assistant', `Last time you said "${SAID_KEPT}". What has shifted?`, 101);
    const m3 = await say('user', SAID_GONE, 110);
    const m4 = await say('assistant', 'That is a big thing to be weighing.', 111);
    const r3 = await say(
      'assistant',
      `You kept that you are "${SAID_GONE}". Where is it now?`,
      201
    );

    const session = async (ordinal: number, seconds: number) => {
      const id = await sessionEventId(user.id, ordinal, 'started');
      return prisma.journeyEvent.create({
        data: {
          id,
          userId: user.id,
          type: SESSION_EVENT_TYPE.started,
          occurredAt: at(seconds),
          payload: { ordinal },
        },
      });
    };
    const [one, two, three] = [await session(1, 0), await session(2, 100), await session(3, 200)];

    const turn = (
      turnId: string,
      userMessageId: string | null,
      assistantMessageId: string,
      sessionId: string,
      seconds: number,
      recap?: { since: Date; source: 'words' | 'synopsis' },
      moduleSlug: string | null = null
    ) =>
      prisma.appTurn.create({
        data: {
          userId: user.id,
          turnId,
          clientSupplied: true,
          requestHash: `${PREFIX}-hash-${turnId}`,
          seat: 'facilitator',
          agentSlug: agent.slug,
          status: 'completed',
          startedAt: at(seconds),
          conversationId: conversation.id,
          userMessageId,
          assistantMessageId,
          sessionId,
          moduleSlug,
          ...(recap
            ? {
                recap: {
                  since: recap.since.toISOString(),
                  source: recap.source,
                  words: recap.source === 'words' ? 1 : 0,
                  notes: [],
                  journey: 0,
                },
              }
            : {}),
        },
      });
    const kept = await turn(`${PREFIX}-${stamp}-a`, m1.id, m2.id, one.id, 1);
    await turn(recapTurnId(two.id), null, r2.id, two.id, 100.5, {
      since: one.occurredAt,
      source: 'words',
    });
    const gone = await turn(`${PREFIX}-${stamp}-b`, m3.id, m4.id, two.id, 110);
    const recapThree = await turn(recapTurnId(three.id), null, r3.id, three.id, 200.5, {
      since: two.occurredAt,
      source: 'synopsis',
    });

    const written = await appendSlotValue({
      userId: user.id,
      slotSlug: SLUG,
      value: SAID_GONE,
      valueJson: SAID_GONE,
      confidence: 8,
      sourceType: 'direct',
      reasoningNote: `They said it plainly: ${SAID_GONE}`,
      provenance: { conversationId: conversation.id },
    });
    await prisma.appTurnSlotWrite.create({
      data: { turnId: gone.id, slotSlug: SLUG, version: written.version, minted: false },
    });
    const account = await prisma.appJourneyEntry.create({
      data: {
        userId: user.id,
        kind: 'synopsis',
        state: 'kept',
        sessionId: two.id,
        summary: 'A job to leave',
        body: `You said ${SAID_GONE}.`,
        occurredAt: at(100),
        keptAt: at(150),
      },
    });
    const before = await readRecapMaterial(user.id, { id: two.id, startedAt: two.occurredAt });
    check(
      before.text.includes(SAID_GONE),
      'before: the material a recap of the second session gets holds its words'
    );

    console.log('\n2. Delete the second session, and its kept account');
    const result = await deleteSession({ userId: user.id, sessionId: two.id, removeAccount: true });
    check(
      result.exchanges === 2 &&
        result.messages === 4 &&
        result.versions === 1 &&
        result.recaps === 1 &&
        result.account === 'removed',
      'its exchange and its own recap, their four messages, one version, the later recap, and the account'
    );
    const left = await prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    check(
      left.map((row) => row.id).join() === [m1.id, m2.id].join(),
      'only the kept session’s messages are left'
    );
    check(
      (await prisma.appTurn.count({ where: { userId: user.id } })) === 1 &&
        (await prisma.appTurn.count({ where: { id: kept.id } })) === 1 &&
        (await prisma.appTurn.count({ where: { id: recapThree.id } })) === 0,
      'its turns and the recap drawn from its account are gone, and the kept turn stays'
    );
    check(
      (await prisma.appJourneyEntry.count({ where: { id: account.id } })) === 0,
      'its kept account is gone'
    );
    check(
      (await prisma.journeyEvent.count({
        where: { userId: user.id, type: SESSION_EVENT_TYPE.started },
      })) === 3,
      'all three session rows stay: a sitting that happened still happened'
    );

    console.log('\n3. What the AI reads next');
    const versions = await prisma.slotValue.findMany({
      where: { userId: user.id, slotSlug: SLUG },
    });
    check(versions.length === 1 && isRemoved(versions[0]), 'the note it wrote is a placeholder');
    const [head] = await getSlotHeads(user.id, { slotSlugs: [SLUG] });
    const material = await readRecapMaterial(user.id, { id: two.id, startedAt: two.occurredAt });
    const keptMaterial = await readRecapMaterial(user.id, {
      id: one.id,
      startedAt: one.occurredAt,
    });
    const everything = JSON.stringify({ left, head, material });
    check(
      !everything.includes(SAID_GONE) && !everything.includes('big thing to be weighing'),
      'nothing of the deleted session is in the conversation, the note or a recap’s material'
    );
    check(
      keptMaterial.text.includes(SAID_KEPT) && left.some((row) => row.content === SAID_KEPT),
      'the kept session’s words are still in the conversation and a recap’s material'
    );

    console.log("\n4. Delete a module's worth from a fourth, kept session");
    const four = await session(4, 300);
    const v1 = await say('user', SAID_IN_MODULE, 310);
    const v2 = await say('assistant', 'Being trusted matters to you.', 311);
    const o1 = await say('user', SAID_ELSEWHERE, 320);
    const o2 = await say('assistant', 'That is a real change.', 321);
    const inModule = await turn(
      `${PREFIX}-${stamp}-v`,
      v1.id,
      v2.id,
      four.id,
      310,
      undefined,
      'values'
    );
    const elsewhere = await turn(
      `${PREFIX}-${stamp}-o`,
      o1.id,
      o2.id,
      four.id,
      320,
      undefined,
      'inner-authority'
    );
    const valued = await appendSlotValue({
      userId: user.id,
      slotSlug: MODULE_SLOT,
      value: SAID_IN_MODULE,
      valueJson: SAID_IN_MODULE,
      confidence: 8,
      sourceType: 'direct',
      reasoningNote: `They said it plainly: ${SAID_IN_MODULE}`,
      provenance: { conversationId: conversation.id },
    });
    await prisma.appTurnSlotWrite.create({
      data: { turnId: inModule.id, slotSlug: MODULE_SLOT, version: valued.version, minted: false },
    });
    const fourAccount = await prisma.appJourneyEntry.create({
      data: {
        userId: user.id,
        kind: 'synopsis',
        state: 'kept',
        sessionId: four.id,
        summary: 'Trust',
        body: `You said ${SAID_IN_MODULE}.`,
        occurredAt: at(300),
        keptAt: at(350),
      },
    });

    const worth = await deleteModuleExchanges({ userId: user.id, moduleSlug: 'values' });
    check(
      worth.exchanges === 1 && worth.messages === 2 && worth.versions === 1,
      "the module's one exchange, its two messages and its one version"
    );
    check(
      (await prisma.appTurn.count({ where: { id: inModule.id } })) === 0 &&
        (await prisma.appTurn.count({ where: { id: elsewhere.id } })) === 1 &&
        (await prisma.appTurn.count({ where: { id: kept.id } })) === 1,
      'its turn is gone; the other module’s and the unstamped turn stay'
    );
    const afterModule = await prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    check(
      afterModule.map((row) => row.id).join() === [m1.id, m2.id, o1.id, o2.id].join(),
      'only the unstamped session’s and the other module’s messages are left'
    );
    const [moduleVersion] = await prisma.slotValue.findMany({
      where: { userId: user.id, slotSlug: MODULE_SLOT },
    });
    check(isRemoved(moduleVersion), 'the note it wrote is a placeholder');
    const flagged = await prisma.appJourneyEntry.findUnique({ where: { id: fourAccount.id } });
    check(
      flagged?.state === 'kept' && flagged.sourceRemovedAt !== null,
      'the session’s kept account stays, flagged as written from something since deleted'
    );
    check(
      !JSON.stringify(afterModule).includes(SAID_IN_MODULE) &&
        afterModule.some((row) => row.content === SAID_ELSEWHERE),
      'nothing said in the module is left, and what was said elsewhere is'
    );
    const nothingLeft = await deleteModuleExchanges({
      userId: user.id,
      moduleSlug: 'values',
    }).then(
      () => 'deleted',
      (error: unknown) => (error instanceof Error ? error.name : 'other')
    );
    check(nothingLeft === 'NotFoundError', 'a second ask finds nothing, and says so');

    console.log('\n✓ smoke:app-delete-session passed');
  } finally {
    if (userId) {
      await prisma.appTurn.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.appJourneyEntry.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.aiConversation.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.slotValue.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.journeyEvent.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-delete-session failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
