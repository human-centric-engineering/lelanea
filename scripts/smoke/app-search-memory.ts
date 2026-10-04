/**
 * Smoke: the AI's search of a person's own past, on the real development
 * database, with the real embedder and the real dispatcher (f-memory t-130).
 *
 * The unit tests run the tool over a fake that answers the index's SQL by
 * shape. What they cannot prove is the wiring: that the capability's row and
 * its grant to the guide are on the database (the migration), that the
 * dispatcher hands this slug to our handler, that Postgres ranks by meaning
 * and filters by person, and that what goes back to the model, the tool
 * message the chat handler builds, carries a kept phrase and never a deleted
 * one.
 *
 * Flow:
 *   1. Two throwaway people with seat conversations. One has two exchanges, one
 *      about their father and one about their garden; the other has said
 *      something about their own father, closer in wording to the query than
 *      the first person's.
 *   2. Through the dispatcher, as the guide on the facilitator seat: the first
 *      person's search for "my dad" returns their own father sentence, labelled
 *      as theirs with a date, and never the other person's.
 *   3. Delete the father exchange (t-127's `deleteExchanges`). The same search
 *      no longer returns it, and the garden sentence is still found by meaning.
 *   4. Notes (t-107). Each person has a note about their father, and the other's
 *      is again the closer match; the search returns the caller's, labelled as
 *      a note. Revising it replaces its vector. A hidden slot is never embedded.
 *      Then three ways a note goes, each leaving a sibling's vector: removing
 *      it, deleting the exchange that wrote it, and erasing the person.
 *
 * "Into the prompt" is read as the chat handler builds it: the tool message's
 * content is `JSON.stringify` of the dispatch result (`streaming-handler.ts`).
 *
 * No server and no model: everything runs in this process. Needs a migrated
 * database (`20261009100000_app_search_person_memory_capability`), the guide
 * agent, and the embedding provider `.env.local` configures. Skips (exit 0,
 * says so) with no database, no guide, no embedder, or no row.
 *
 * Self-cleaning: two `smoke-app-search-memory-*` users and everything keyed on
 * them, removed on every path. Never unscoped deletes.
 *
 * Usage: `npm run smoke:app-search-memory` (reads `.env.local`). Exit 0 on
 * every assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { embedText } from '@/lib/orchestration/knowledge/embedder';
import { capabilityDispatcher } from '@/lib/orchestration/capabilities/dispatcher';
import { registerBuiltInCapabilities } from '@/lib/orchestration/capabilities/registry';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';
import { appendSlotValue } from '@/lib/framework/data-slots';
import { eraseUser } from '@/lib/privacy/erase-user';
import { deleteExchanges } from '@/lib/app/memory/delete-exchange';
import {
  indexMessage,
  indexNote,
  listMemoryEntriesForSubject,
  searchMemory,
} from '@/lib/app/memory/memory-index';
import { deleteNote } from '@/lib/app/slots/delete-note';
import { SEARCH_PERSON_MEMORY_SLUG } from '@/lib/app/memory/search-capability';
import { CLEARED_SEARCH_RESULT } from '@/lib/app/memory/stored-results';

const PREFIX = 'smoke-app-search-memory';
const stamp = Date.now();

const MY_FATHER = 'My father taught me to sail on the lake every summer when I was small.';
const MY_GARDEN = 'Lately I have been spending my evenings in the allotment, growing beans.';
const THEIR_FATHER = 'My dad and I used to sail together; I miss my dad so much.';
const QUERY = 'my dad';

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

async function main(): Promise<void> {
  console.log('\nsmoke:app-search-memory\n');
  if (!(await dbReachable())) {
    console.log('skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }
  const agent = await prisma.aiAgent.findFirst({
    where: { slug: VOICE_AGENT_SLUG, deletedAt: null },
    select: { id: true, slug: true },
  });
  if (!agent) {
    console.log(`skipped — no ${VOICE_AGENT_SLUG} agent in this database (run db:seed).`);
    return;
  }
  const row = await prisma.aiCapability.findUnique({
    where: { slug: SEARCH_PERSON_MEMORY_SLUG },
    select: { id: true },
  });
  if (!row) {
    console.log(`skipped — no ${SEARCH_PERSON_MEMORY_SLUG} row (run db:migrate:deploy).`);
    return;
  }
  if (!(await embedderReachable())) {
    console.log('skipped — no embedding provider answers (check the provider in .env.local).');
    return;
  }
  registerBuiltInCapabilities();

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
    const turn = (
      userId: string,
      conversationId: string,
      label: string,
      userMessageId: string,
      assistantMessageId: string
    ) =>
      prisma.appTurn.create({
        data: {
          userId,
          turnId: `${PREFIX}-${stamp}-${label}`,
          clientSupplied: true,
          requestHash: `${PREFIX}-hash-${label}`,
          seat: CONVERSATION_SEAT,
          agentSlug: agent.slug,
          status: 'completed',
          conversationId,
          userMessageId,
          assistantMessageId,
        },
      });

    console.log('1. Two people; the other’s sentence is the closer match');
    const mine = await conversation(me.id);
    const theirs = await conversation(them.id);
    const father = await say(mine.id, 'user', MY_FATHER, 1);
    const fatherReply = await say(mine.id, 'assistant', 'What a lovely thing to remember.', 2);
    const garden = await say(mine.id, 'user', MY_GARDEN, 10);
    const gardenReply = await say(mine.id, 'assistant', 'That sounds peaceful.', 11);
    const theirFather = await say(theirs.id, 'user', THEIR_FATHER, 1);
    const fatherTurn = await turn(me.id, mine.id, 'father', father.id, fatherReply.id);
    const gardenTurn = await turn(me.id, mine.id, 'garden', garden.id, gardenReply.id);
    // The message being answered now. Indexed like any other, so the search
    // must leave it out rather than hand the person's question straight back.
    const now = await say(mine.id, 'user', 'I keep thinking about my dad today.', 20);
    const nowReply = await say(mine.id, 'assistant', 'Tell me about him.', 21);
    const nowTurn = await turn(me.id, mine.id, 'now', now.id, nowReply.id);

    for (const [userId, message] of [
      [me.id, father],
      [me.id, garden],
      [me.id, now],
      [them.id, theirFather],
    ] as const) {
      check(
        (await indexMessage({ userId }, message.id)) === 'indexed',
        `indexed ${message.content.slice(0, 32)}…`
      );
    }

    // The distances, for whoever tunes MEMORY_MAX_DISTANCE.
    for (const hit of await searchMemory({ userId: me.id }, QUERY, { limit: 10 })) {
      console.log(`    distance ${hit.distance.toFixed(3)}  ${hit.text.slice(0, 50)}`);
    }
    for (const hit of await searchMemory({ userId: them.id }, QUERY, { limit: 10 })) {
      console.log(`    (theirs) distance ${hit.distance.toFixed(3)}  ${hit.text.slice(0, 50)}`);
    }

    const ask = async (query: string, turnId: string) => {
      const result = await capabilityDispatcher.dispatch(
        SEARCH_PERSON_MEMORY_SLUG,
        { query },
        {
          userId: me.id,
          agentId: agent.id,
          conversationId: mine.id,
          costLogMetadata: { turnId, seat: CONVERSATION_SEAT },
        }
      );
      // What the chat handler sends the model back (`streaming-handler.ts`).
      return { result, toolMessage: JSON.stringify(result) };
    };

    console.log('\n2. The guide searches, through the dispatcher');
    // Under the garden turn, so the message it leaves out is not the father one.
    const before = await ask(QUERY, gardenTurn.turnId);
    check(before.result.success, `the dispatcher ran ${SEARCH_PERSON_MEMORY_SLUG} for the guide`);
    check(before.toolMessage.includes(MY_FATHER), 'their own father sentence reaches the prompt');
    check(
      !before.toolMessage.includes(THEIR_FATHER),
      'the other person’s nearer sentence never does'
    );
    check(
      before.toolMessage.includes('The person’s own words, said by them on'),
      'labelled as the person’s own words, with the date they said them'
    );

    // Stored as the chat handler stores a tool result, in the turn answering now:
    // a copy of the father sentence that the deletion below never touches.
    const stored = await prisma.aiMessage.create({
      data: {
        conversationId: mine.id,
        role: 'tool',
        content: before.toolMessage,
        capabilitySlug: SEARCH_PERSON_MEMORY_SLUG,
        toolCallId: `${PREFIX}-${stamp}-call`,
        metadata: { result: before.toolMessage },
        createdAt: at(22),
      },
    });
    check(
      stored.content.includes(MY_FATHER),
      'the stored search result quotes the father sentence'
    );

    console.log('\n3. Delete the father exchange');
    const deleted = await deleteExchanges({ userId: me.id, exchangeIds: [fatherTurn.id] });
    check(deleted.exchanges === 1, 'one exchange deleted');
    const cleared = await prisma.aiMessage.findUniqueOrThrow({ where: { id: stored.id } });
    check(
      cleared.content === CLEARED_SEARCH_RESULT && !JSON.stringify(cleared).includes(MY_FATHER),
      'the stored search result that quoted it is cleared, and kept as a row'
    );
    const after = await ask(QUERY, nowTurn.turnId);
    check(after.result.success, 'the search still runs');
    check(
      !after.toolMessage.includes(MY_FATHER),
      'the deleted phrase no longer reaches the prompt'
    );
    check(
      !after.toolMessage.includes('I keep thinking about my dad today.'),
      'nor does the message the turn is answering'
    );
    const kept = await ask('vegetables I grow', nowTurn.turnId);
    check(kept.toolMessage.includes(MY_GARDEN), 'a kept phrase is still found by meaning');

    console.log('\n4. Notes');
    const FAMILY = 'life_family';
    const WORK = 'life_work';
    const HIDDEN = 'development_stage';
    const note = (userId: string, slotSlug: string, value: string) =>
      appendSlotValue({
        userId,
        slotSlug,
        value,
        valueJson: value,
        confidence: 8,
        sourceType: 'direct',
        reasoningNote: `SMOKE REASONING, never embedded: ${value}`,
        provenance: { conversationId: mine.id },
      });
    const vectors = async (userId: string) =>
      (await listMemoryEntriesForSubject({ userId }))
        .map((entry) => entry.slotValueId)
        .filter((id): id is string => id !== null);
    const idOf = async (userId: string, slotSlug: string) =>
      (
        await prisma.slotValue.findFirstOrThrow({
          where: { userId, slotSlug, supersededAt: null },
          select: { id: true },
        })
      ).id;

    await note(me.id, FAMILY, 'Their father taught them to sail; he has been unwell since spring.');
    await note(me.id, WORK, 'Started a demanding new job at the hospital this year.');
    await note(me.id, HIDDEN, 'Reads as early in the work; a tuning signal, never shown.');
    await note(them.id, FAMILY, 'Misses their dad terribly; they used to sail together.');
    for (const [userId, slug] of [
      [me.id, FAMILY],
      [me.id, WORK],
      [me.id, HIDDEN],
      [them.id, FAMILY],
    ] as const) {
      await indexNote({ userId }, slug);
    }
    const familyV1 = await idOf(me.id, FAMILY);
    const work = await idOf(me.id, WORK);
    check(
      (await vectors(me.id)).sort().join() === [familyV1, work].sort().join(),
      'their two open notes are embedded, and the hidden one is not'
    );

    const notes = await ask('my dad', nowTurn.turnId);
    check(
      notes.toolMessage.includes('he has been unwell since spring'),
      'their own note reaches the prompt'
    );
    check(
      !notes.toolMessage.includes('Misses their dad terribly'),
      'the other person’s nearer note never does'
    );
    check(!notes.toolMessage.includes('SMOKE REASONING'), 'no reasoning note reaches it');
    check(!notes.toolMessage.includes('tuning signal'), 'nor the hidden note');
    check(
      notes.toolMessage.includes('A note kept about the person') &&
        notes.toolMessage.includes('"kind":"note"'),
      'labelled as a note, not as their words'
    );

    await note(me.id, FAMILY, 'Their father is home again and recovering well.');
    await indexNote({ userId: me.id }, FAMILY);
    const familyV2 = await idOf(me.id, FAMILY);
    check(
      (await vectors(me.id)).sort().join() === [familyV2, work].sort().join(),
      'a revision replaces the old version’s vector, and leaves the sibling’s'
    );

    await deleteNote({ userId: me.id, slotSlug: FAMILY });
    check(
      (await vectors(me.id)).join() === work,
      'removing the note takes its vector, and the sibling’s stays'
    );
    const afterRemoval = await ask('my father recovering at home', nowTurn.turnId);
    check(
      !afterRemoval.toolMessage.includes('recovering well'),
      'a removed note is not found by meaning'
    );

    // A note a turn wrote, deleted with its exchange.
    const said = await say(
      mine.id,
      'user',
      'I have started running in the mornings before work.',
      30
    );
    const saidReply = await say(mine.id, 'assistant', 'That sounds like a good start.', 31);
    const runTurn = await turn(me.id, mine.id, 'run', said.id, saidReply.id);
    const written = await note(
      me.id,
      'aspirations',
      'Wants to keep running every morning before work.'
    );
    await prisma.appTurnSlotWrite.create({
      data: {
        turnId: runTurn.id,
        slotSlug: 'aspirations',
        version: written.version,
        minted: false,
      },
    });
    await indexNote({ userId: me.id }, 'aspirations');
    check((await vectors(me.id)).length === 2, 'the turn’s note is embedded beside the sibling');
    await deleteExchanges({ userId: me.id, exchangeIds: [runTurn.id] });
    check(
      (await vectors(me.id)).join() === work,
      'deleting the exchange that wrote it takes its vector, and the sibling’s stays'
    );

    const theirFamily = await idOf(them.id, FAMILY);
    check(
      (await vectors(them.id)).join() === theirFamily,
      'the other person’s note is still embedded'
    );
    await eraseUser({
      userId: them.id,
      userEmail: them.email,
      actorUserId: them.id,
      reason: 'self_service',
    });
    check((await vectors(them.id)).length === 0, 'erasing them takes their note’s vector');
    check((await vectors(me.id)).join() === work, 'and leaves everyone else’s');

    console.log('\n✓ smoke:app-search-memory passed');
  } finally {
    for (const userId of userIds) {
      await prisma.appTurn.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.aiConversation.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.slotValue.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-search-memory failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
