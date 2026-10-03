/**
 * Smoke: deleting one exchange, on the real development database (f-memory
 * t-127).
 *
 * The unit tests run the deletion against a Prisma fake. What the fake cannot
 * prove is the wiring underneath it: that deleting an `ai_message` takes its
 * Sunrise embedding by the real FK cascade, that deleting an `app_turn` takes
 * its ledger rows the same way, that the conversation row's summary and title
 * clear on a real round trip, and that what the AI reads next (the
 * conversation's messages and the note heads `get_state` reads) holds nothing
 * of the deleted exchange while the kept one is all still there.
 *
 * Flow:
 *   1. A throwaway person with a conversation of two exchanges: the first calls
 *      a tool and writes a note, the second revises it. A reply embedding on
 *      the first exchange, a stored summary pinned inside it, and the title its
 *      first message gave.
 *   2. Delete the first exchange. Assert its messages, its embedding, its turn
 *      and its ledger rows are gone, the version it wrote is a placeholder, and
 *      the summary and title are cleared.
 *   3. Assert what the AI reads next: the conversation's messages hold only the
 *      kept exchange, and the note's head is the kept exchange's reading.
 *   4. Assert the panel offers nothing more for the deleted exchange and still
 *      lists the kept one.
 *
 * No server and no model: everything runs in this process. Skips (exit 0, says
 * so) with no database or no agent to hang a conversation on.
 *
 * Self-cleaning: one `smoke-app-delete-exchange-*` user, and the conversation,
 * turns and slot values keyed on it, removed on every path. Never unscoped
 * deletes.
 *
 * Usage: `npm run smoke:app-delete-exchange` (reads `.env.local`). Exit 0 on
 * every assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { appendSlotValue, getSlotHeads } from '@/lib/framework/data-slots';
import { deleteExchanges } from '@/lib/app/memory/delete-exchange';
import { getNotes } from '@/lib/app/slots/notes';
import { isRemoved } from '@/lib/app/slots/removed';

const PREFIX = 'smoke-app-delete-exchange';
const stamp = Date.now();
/** A taxonomy slug, open and standard, so the heading stays whatever happens. */
const SLUG = 'current_circumstances';
const SAID_FIRST = 'my father has been ill since the spring';
const SAID_SECOND = 'he is home again now';

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

/** Messages a second apart, so the window bounds are unambiguous. */
function at(seconds: number): Date {
  return new Date(stamp + seconds * 1000);
}

async function main(): Promise<void> {
  console.log('\nsmoke:app-delete-exchange\n');
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

    console.log('1. A conversation of two exchanges, the first writing a note');
    const conversation = await prisma.aiConversation.create({
      data: { userId: user.id, agentId: agent.id, title: SAID_FIRST.slice(0, 80) },
    });
    const say = (role: string, content: string, seconds: number) =>
      prisma.aiMessage.create({
        data: { conversationId: conversation.id, role, content, createdAt: at(seconds) },
      });
    const m1 = await say('user', SAID_FIRST, 1);
    const m2 = await say('assistant', 'Let me note that.', 2);
    const m3 = await say('tool', JSON.stringify({ value: SAID_FIRST }), 3);
    const m4 = await say('assistant', 'That sounds like a hard season.', 4);
    const m5 = await say('user', SAID_SECOND, 10);
    const m6 = await say('assistant', 'I am glad to hear it.', 11);

    await prisma.$executeRawUnsafe(
      `INSERT INTO ai_message_embedding (id, "messageId", embedding)
       VALUES ($1, $2, $3::vector)`,
      `${PREFIX}-${stamp}-embedding`,
      m4.id,
      `[${Array.from({ length: 1536 }, () => '0.001').join(',')}]`
    );
    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { summary: `They told Lelañea: ${SAID_FIRST}.`, summaryUpToMessageId: m2.id },
    });

    const turn = (turnId: string, userMessageId: string, assistantMessageId: string) =>
      prisma.appTurn.create({
        data: {
          userId: user.id,
          turnId,
          clientSupplied: true,
          requestHash: `${PREFIX}-hash-${turnId}`,
          seat: 'facilitator',
          agentSlug: agent.slug,
          status: 'completed',
          conversationId: conversation.id,
          userMessageId,
          assistantMessageId,
        },
      });
    const first = await turn(`${PREFIX}-${stamp}-a`, m1.id, m4.id);
    const second = await turn(`${PREFIX}-${stamp}-b`, m5.id, m6.id);

    const capture = (value: string) =>
      appendSlotValue({
        userId: user.id,
        slotSlug: SLUG,
        value,
        valueJson: value,
        confidence: 8,
        sourceType: 'direct',
        reasoningNote: `They said it plainly: ${value}`,
        provenance: { conversationId: conversation.id },
      });
    const v1 = await capture(SAID_FIRST);
    const v2 = await capture(SAID_SECOND);
    await prisma.appTurnSlotWrite.create({
      data: { turnId: first.id, slotSlug: SLUG, version: v1.version, minted: false },
    });
    await prisma.appTurnSlotWrite.create({
      data: { turnId: second.id, slotSlug: SLUG, version: v2.version, minted: false },
    });
    const before = (await getNotes(user.id)).notes.find((note) => note.slotSlug === SLUG);
    check(
      before?.exchanges.join() === [first.id, second.id].join(),
      'the panel lists both exchanges the note came from'
    );

    console.log('\n2. Delete the first exchange');
    const result = await deleteExchanges({ userId: user.id, exchangeIds: [first.id] });
    check(
      result.exchanges === 1 && result.messages === 4 && result.versions === 1,
      'one exchange, its four messages and one version'
    );
    const left = await prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    check(
      left.map((row) => row.id).join() === [m5.id, m6.id].join(),
      'every message in its window went, and the next exchange stayed'
    );
    check(
      (await prisma.aiMessage.count({ where: { id: m3.id } })) === 0,
      'the tool result, which echoed the person’s words, went with it'
    );
    const embeddings = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ai_message_embedding WHERE "messageId" = $1`,
      m4.id
    );
    check(embeddings[0].n === 0, 'the reply’s embedding went with it, by the FK cascade');
    check(
      (await prisma.appTurn.count({ where: { id: first.id } })) === 0 &&
        (await prisma.appTurnSlotWrite.count({ where: { turnId: first.id } })) === 0,
      'its turn record and ledger rows are gone'
    );
    check(
      (await prisma.appTurnSlotWrite.count({ where: { turnId: second.id } })) === 1,
      'the kept exchange’s ledger row is still there'
    );
    const versions = await prisma.slotValue.findMany({
      where: { userId: user.id, slotSlug: SLUG },
      orderBy: { version: 'asc' },
    });
    check(
      isRemoved(versions[0]) && !isRemoved(versions[1]) && versions[1].value === SAID_SECOND,
      'only the version it wrote is a placeholder'
    );
    const row = await prisma.aiConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    check(
      row.summary === null && row.summaryUpToMessageId === null && row.title === null,
      'the summary pinned inside it and the title its first message gave are cleared'
    );

    console.log('\n3. What the AI reads next');
    const everything = JSON.stringify({ left, versions, row });
    check(
      !everything.includes(SAID_FIRST) && !everything.includes('hard season'),
      'nothing of the deleted exchange is in the conversation, the note or the conversation row'
    );
    check(everything.includes(SAID_SECOND), 'the kept exchange is all still there');
    const [head] = await getSlotHeads(user.id, { slotSlugs: [SLUG] });
    check(head?.value === SAID_SECOND, 'the note’s head is the kept exchange’s reading');

    console.log('\n4. The panel');
    const after = (await getNotes(user.id)).notes.find((note) => note.slotSlug === SLUG);
    check(
      after?.exchanges.join() === second.id,
      'it no longer offers the deleted exchange, and still lists the kept one'
    );

    console.log('\n✓ smoke:app-delete-exchange passed');
  } finally {
    if (userId) {
      await prisma.appTurn.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.aiConversation.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.slotValue.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-delete-exchange failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
