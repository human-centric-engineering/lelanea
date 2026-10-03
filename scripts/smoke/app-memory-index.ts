/**
 * Smoke: the memory index on the real development database, with the real
 * embedder (f-memory t-129).
 *
 * The unit tests run the index against a fake that answers its SQL by shape.
 * What the fake cannot prove is Postgres: that the vectors land in a
 * `vector(1536)` column with their CHECKs satisfied, that the HNSW-backed
 * search ranks by meaning and filters by person, and that the hand-written
 * `ON DELETE CASCADE` keys take a vector with its message, its exchange, its
 * conversation and its person, while a sibling's survives each time.
 *
 * Flow:
 *   1. Two throwaway people, each with a seat conversation. Both have said
 *      something about their father; one of them has said three more things
 *      across two exchanges and a second conversation. The turn path's index
 *      call embeds the first four; the backfill job's function picks up the
 *      fifth, which the turn path "missed".
 *   2. Search: each person finds their own sentence about their father, and
 *      never the other's.
 *   3. Delete one exchange (t-127's `deleteExchanges`), then a whole
 *      conversation, then the other person's account (`eraseUser`). After
 *      each, the deleted words are gone from the index and from search, and
 *      everything else is still there.
 *
 * No server and no model: everything runs in this process, but the embedder is
 * real, so it needs the embedding provider `.env.local` configures. Skips
 * (exit 0, says so) with no database, no agent, or no embedder.
 *
 * Self-cleaning: two `smoke-app-memory-index-*` users and everything keyed on
 * them, removed on every path. Never unscoped deletes.
 *
 * Usage: `npm run smoke:app-memory-index` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { embedText } from '@/lib/orchestration/knowledge/embedder';
import { eraseUser } from '@/lib/privacy/erase-user';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { deleteExchanges } from '@/lib/app/memory/delete-exchange';
import {
  backfillMemoryIndex,
  indexMessage,
  listMemoryEntriesForSubject,
  searchMemory,
} from '@/lib/app/memory/memory-index';

const PREFIX = 'smoke-app-memory-index';
const stamp = Date.now();

const MY_FATHER = 'My father taught me to sail on the lake every summer when I was small.';
const MY_JOB = 'I started a new job at the hospital in the spring and it has been hard.';
const MY_SISTER = 'My sister and I have not spoken since the funeral last winter.';
const MY_GARDEN = 'Lately I have been spending my evenings in the allotment, growing beans.';
const MY_MOVE = 'We are thinking about moving to the coast to be nearer my mother.';
const THEIR_FATHER = 'My father loved sailing boats on the lake more than anything else.';

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function embedderReachable(): Promise<boolean> {
  try {
    await embedText('a smoke check that the embedder answers', 'query');
    return true;
  } catch {
    return false;
  }
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function at(seconds: number): Date {
  return new Date(stamp + seconds * 1000);
}

async function indexed(userId: string): Promise<string[]> {
  return (await listMemoryEntriesForSubject({ userId })).map((entry) => entry.messageId ?? '');
}

async function found(userId: string, query: string): Promise<string[]> {
  return (await searchMemory({ userId }, query, { limit: 10 })).map((hit) => hit.text);
}

async function main(): Promise<void> {
  console.log('\nsmoke:app-memory-index\n');
  if (!(await dbReachable())) {
    console.log('skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }
  const agent = await prisma.aiAgent.findFirst({ select: { id: true, slug: true } });
  if (!agent) {
    console.log('skipped — no agent in this database to hang a conversation on (run db:seed).');
    return;
  }
  if (!(await embedderReachable())) {
    console.log('skipped — no embedding provider answers (check the provider in .env.local).');
    return;
  }

  const userIds: string[] = [];
  try {
    const person = async (label: string) => {
      const user = await prisma.user.create({
        data: { name: `${PREFIX} ${label}`, email: `${PREFIX}-${label}-${stamp}@example.com` },
      });
      userIds.push(user.id);
      return user;
    };
    const me = await person('me');
    const them = await person('them');

    const conversation = (userId: string) =>
      prisma.aiConversation.create({
        data: {
          userId,
          agentId: agent.id,
          contextType: FACILITATION_SURFACE_CONTEXT_TYPE,
          contextId: CONVERSATION_SEAT,
        },
      });
    const say = (conversationId: string, role: string, content: string, seconds: number) =>
      prisma.aiMessage.create({ data: { conversationId, role, content, createdAt: at(seconds) } });

    console.log('1. Two people, five things said, embedded on the turn and by the backfill');
    const mine = await conversation(me.id);
    const mineElsewhere = await conversation(me.id);
    const theirs = await conversation(them.id);

    const father = await say(mine.id, 'user', MY_FATHER, 1);
    const fatherReply = await say(mine.id, 'assistant', 'What a lovely thing to remember.', 2);
    const job = await say(mine.id, 'user', MY_JOB, 10);
    const jobReply = await say(mine.id, 'assistant', 'That sounds like a lot to carry.', 11);
    const sister = await say(mineElsewhere.id, 'user', MY_SISTER, 20);
    const garden = await say(mineElsewhere.id, 'user', MY_GARDEN, 21);
    const theirFather = await say(theirs.id, 'user', THEIR_FATHER, 1);

    for (const [userId, message] of [
      [me.id, father],
      [me.id, job],
      [me.id, sister],
      [them.id, theirFather],
    ] as const) {
      check(
        (await indexMessage({ userId }, message.id)) === 'indexed',
        `the turn path indexes "${message.content.slice(0, 32)}…"`
      );
    }
    check(
      (await indexMessage({ userId: me.id }, fatherReply.id)) === 'skipped',
      'a reply is not indexed'
    );
    check(
      (await indexMessage({ userId: me.id }, theirFather.id)) === 'skipped',
      'my index call on their message adds nothing'
    );
    check(!(await indexed(me.id)).includes(theirFather.id), 'and their message is not in my index');

    // The backfill runs per org, over every seat conversation, so it may also
    // pick up other people's unindexed messages in this database. Loop until it
    // has reached the one this smoke left for it, which is the newest.
    let backfilled = false;
    for (let run = 0; run < 5 && !backfilled; run++) {
      await backfillMemoryIndex();
      backfilled = (await indexed(me.id)).includes(garden.id);
    }
    check(backfilled, 'the backfill indexes the message the turn path missed');
    check((await indexed(me.id)).length === 4, 'four of mine are indexed');

    console.log('\n2. Search is by meaning, and per person');
    const myFather = await found(me.id, 'sailing with my dad as a child');
    check(myFather[0] === MY_FATHER, 'my nearest match for my dad and sailing is what I said');
    check(!myFather.includes(THEIR_FATHER), 'their sentence about their father never reaches me');
    const theirSearch = await found(them.id, 'sailing with my dad as a child');
    check(
      theirSearch.length === 1 && theirSearch[0] === THEIR_FATHER,
      'their search finds their own sentence, and nothing of mine'
    );

    console.log('\n3a. Delete the exchange about my father');
    const firstTurn = await prisma.appTurn.create({
      data: {
        userId: me.id,
        turnId: `${PREFIX}-${stamp}-a`,
        clientSupplied: true,
        requestHash: `${PREFIX}-hash-a`,
        seat: CONVERSATION_SEAT,
        agentSlug: agent.slug,
        status: 'completed',
        conversationId: mine.id,
        userMessageId: father.id,
        assistantMessageId: fatherReply.id,
      },
    });
    await prisma.appTurn.create({
      data: {
        userId: me.id,
        turnId: `${PREFIX}-${stamp}-b`,
        clientSupplied: true,
        requestHash: `${PREFIX}-hash-b`,
        seat: CONVERSATION_SEAT,
        agentSlug: agent.slug,
        status: 'completed',
        conversationId: mine.id,
        userMessageId: job.id,
        assistantMessageId: jobReply.id,
      },
    });
    await deleteExchanges({ userId: me.id, exchangeIds: [firstTurn.id] });
    check(!(await indexed(me.id)).includes(father.id), 'its vector went with its message');
    check(
      !(await found(me.id, 'sailing with my dad as a child')).includes(MY_FATHER),
      'and no search of mine can find it'
    );
    check((await indexed(me.id)).includes(job.id), 'the next exchange’s vector is still there');
    check(
      (await found(them.id, 'sailing with my dad as a child'))[0] === THEIR_FATHER,
      'their sentence about their father is untouched'
    );

    console.log('\n3b. Delete my second conversation');
    await prisma.aiConversation.delete({ where: { id: mineElsewhere.id } });
    const left = await indexed(me.id);
    check(!left.includes(sister.id) && !left.includes(garden.id), 'both its vectors went with it');
    check(
      left.length === 1 && left[0] === job.id,
      'the other conversation’s vector is still there'
    );
    const sisterSearch = await found(me.id, 'my sister and the funeral');
    check(!sisterSearch.includes(MY_SISTER), 'no search of mine can find what it held');

    console.log('\n3c. Erase the other person');
    await eraseUser({
      userId: them.id,
      userEmail: them.email,
      actorUserId: them.id,
      reason: 'self_service',
    });
    check((await indexed(them.id)).length === 0, 'their vectors went with their account');
    check((await indexed(me.id)).join() === job.id, 'mine are still there');

    // One more kept phrase, found after everything else went: what the
    // feature's done-when asks of a kept exchange.
    const move = await say(mine.id, 'user', MY_MOVE, 30);
    await indexMessage({ userId: me.id }, move.id);
    const kept = await found(me.id, 'moving house to the seaside near mum');
    check(kept[0] === MY_MOVE, 'a kept phrase is still found by meaning');

    console.log('\n✓ smoke:app-memory-index passed');
  } finally {
    for (const userId of userIds) {
      await prisma.appTurn.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.aiConversation.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-memory-index failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
