/**
 * Smoke: deleting a whole conversation, on the real development database
 * (f-memory t-128).
 *
 * The unit tests run the forgetting against a Prisma fake, and answer the
 * sweep's anti-join from the fake's world. What they cannot prove is the SQL
 * and the wiring underneath: that Sunrise's delete really leaves our turn rows
 * pointing at a conversation that is gone (no FK took them), that the sweep's
 * raw query finds exactly those, that deleting a turn takes its ledger rows by
 * the real cascade, and that the note heads the AI reads next hold nothing from
 * a deleted conversation while the kept one's reading is still there.
 *
 * Flow:
 *   1. A throwaway person with three conversations, each one exchange that
 *      wrote a version of the same note: A (deleted the way the person's own
 *      route does), C (deleted the way retention does) and B (kept, the
 *      latest reading).
 *   2. Delete A as `DELETE /api/v1/chat/conversations/:id` does: the row, then
 *      `onConversationsDeleted`. Assert A's turn and ledger row are gone and
 *      its version is a placeholder, and B's are untouched.
 *   3. Delete C as `enforceRetentionPolicies` does: `deleteMany`, no call to
 *      us. Assert its turn is still there, pointing at nothing, that the
 *      sweep's query finds C and not B, then forget C as the sweep does and
 *      assert its turn is gone and its version a placeholder.
 *   4. What the AI reads next: the note's head is B's reading, and no version
 *      holds A's or C's words.
 *
 * It never runs the whole sweep: on a shared dev database that would forget
 * what other people's deleted conversations left, which is the job's to do,
 * not a smoke's. It runs the sweep's query, then forgets only its own.
 *
 * No server and no model. Skips (exit 0, says so) with no database or no agent
 * to hang a conversation on.
 *
 * Self-cleaning: one `smoke-app-delete-conversation-*` user, and the
 * conversations, turns and slot values keyed on it, removed on every path.
 * Never unscoped deletes.
 *
 * Usage: `npm run smoke:app-delete-conversation` (reads `.env.local`). Exit 0
 * on every assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { appendSlotValue, getSlotHeads } from '@/lib/framework/data-slots';
import {
  findDeletedConversations,
  forgetDeletedConversations,
  onConversationsDeleted,
} from '@/lib/app/memory/delete-conversation';
import { isRemoved } from '@/lib/app/slots/removed';

const PREFIX = 'smoke-app-delete-conversation';
const stamp = Date.now();
/** A taxonomy slug, so the heading stays whatever happens to its readings. */
const SLUG = 'current_circumstances';
const SAID_A = 'my father has been ill since the spring';
const SAID_C = 'my sister moved back in to help';
const SAID_B = 'he is home again now';

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

async function main(): Promise<void> {
  console.log('\nsmoke:app-delete-conversation\n');
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

    console.log('1. Three conversations, each writing a version of one note');
    /** One conversation of one exchange that wrote `said` as the next version. */
    const exchange = async (label: string, said: string) => {
      const conversation = await prisma.aiConversation.create({
        data: { userId: user.id, agentId: agent.id, title: said.slice(0, 80) },
      });
      const asked = await prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'user', content: said },
      });
      const replied = await prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'assistant', content: 'I hear you.' },
      });
      const turn = await prisma.appTurn.create({
        data: {
          userId: user.id,
          turnId: `${PREFIX}-${stamp}-${label}`,
          clientSupplied: true,
          requestHash: `${PREFIX}-hash-${label}`,
          seat: 'facilitator',
          agentSlug: agent.slug,
          status: 'completed',
          conversationId: conversation.id,
          userMessageId: asked.id,
          assistantMessageId: replied.id,
        },
      });
      const written = await appendSlotValue({
        userId: user.id,
        slotSlug: SLUG,
        value: said,
        valueJson: said,
        confidence: 8,
        sourceType: 'direct',
        reasoningNote: `They said it plainly: ${said}`,
        provenance: { conversationId: conversation.id },
      });
      await prisma.appTurnSlotWrite.create({
        data: { turnId: turn.id, slotSlug: SLUG, version: written.version, minted: false },
      });
      return { conversation, turn, version: written.version };
    };
    const a = await exchange('a', SAID_A);
    const c = await exchange('c', SAID_C);
    const b = await exchange('b', SAID_B);
    const versionOf = async (version: number) =>
      prisma.slotValue.findFirstOrThrow({ where: { userId: user.id, slotSlug: SLUG, version } });
    const turnGone = async (id: string) =>
      (await prisma.appTurn.count({ where: { id } })) === 0 &&
      (await prisma.appTurnSlotWrite.count({ where: { turnId: id } })) === 0;
    check(
      (await prisma.appTurn.count({ where: { userId: user.id } })) === 3,
      'three turns, each with a ledger row'
    );

    console.log('\n2. Delete A the way the person’s own route does');
    await prisma.aiConversation.delete({ where: { id: a.conversation.id } });
    await onConversationsDeleted({ conversationIds: [a.conversation.id], userId: user.id });
    check(await turnGone(a.turn.id), 'its turn record and ledger row are gone');
    check(isRemoved(await versionOf(a.version)), 'the version it wrote is a placeholder');
    check(
      !(await turnGone(b.turn.id)) && (await versionOf(b.version)).value === SAID_B,
      'the kept conversation’s turn, ledger row and reading are untouched'
    );

    console.log('\n3. Delete C the way retention does, then find and forget it as the sweep does');
    await prisma.aiConversation.deleteMany({ where: { id: c.conversation.id } });
    check(
      (await prisma.appTurn.count({ where: { id: c.turn.id } })) === 1,
      'nothing told the app: its turn is still there, pointing at a conversation that is gone'
    );
    // Every deleted conversation in the org, not a batch, so C cannot be cut off.
    const found = await findDeletedConversations(Number.MAX_SAFE_INTEGER);
    check(
      found.includes(c.conversation.id) &&
        !found.includes(b.conversation.id) &&
        !found.includes(a.conversation.id),
      'the sweep’s query finds C, and neither the kept conversation nor the one already forgotten'
    );
    const swept = await forgetDeletedConversations([c.conversation.id]);
    check(
      swept.turns === 1 && swept.versions === 1,
      'forgetting it takes one turn and one version'
    );
    check(await turnGone(c.turn.id), 'its turn record and ledger row are gone');
    check(isRemoved(await versionOf(c.version)), 'the version it wrote is a placeholder');
    check(!(await turnGone(b.turn.id)), 'the kept conversation’s turn is still there');

    console.log('\n4. What the AI reads next');
    const [head] = await getSlotHeads(user.id, { slotSlugs: [SLUG] });
    check(head?.value === SAID_B, 'the note’s head is the kept conversation’s reading');
    const versions = JSON.stringify(
      await prisma.slotValue.findMany({ where: { userId: user.id, slotSlug: SLUG } })
    );
    check(
      !versions.includes(SAID_A) && !versions.includes(SAID_C),
      'no version holds the words of either deleted conversation'
    );
    check(versions.includes(SAID_B), 'the kept reading is still there');

    console.log('\n✓ smoke:app-delete-conversation passed');
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
  console.error('\n✗ smoke:app-delete-conversation failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
