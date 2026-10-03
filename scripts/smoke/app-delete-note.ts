/**
 * Smoke: removing one note, on the real development database (f-memory t-78).
 *
 * The unit tests run Daybreak's value engine against a Prisma fake. What the
 * fake cannot prove is the part this design rests on: that the placeholder
 * survives a real round trip through `framework_slot_value` — its Json columns,
 * its tenancy stamp — and that the next capture of the same slug lands as the
 * next version against the table's **real** unique index
 * `(orgId, userId, slotSlug, version)`. A removed head that stopped being the
 * head would make that capture a second version 1, and only a real index says
 * whether it collides.
 *
 * Flow:
 *   1. A throwaway person with two versions of one note and a sibling note.
 *   2. Remove the note. Assert both rows are placeholders with their version
 *      numbers, the sibling is untouched, and the panel shows a placeholder.
 *   3. Assert the placeholder head fails a journey gate a live reading passes.
 *   4. Capture the same slug again. Assert it lands as version 3, the only head.
 *
 * No server and no model: everything runs in this process. Skips (exit 0, says
 * so) with no database.
 *
 * Self-cleaning: one `smoke-app-delete-note-*` user, and every slot value keyed
 * on it, removed on every path. Never unscoped deletes.
 *
 * Usage: `npm run smoke:app-delete-note` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { appendSlotValue, getSlotHeads } from '@/lib/framework/data-slots';
import { evaluateCondition } from '@/lib/framework/facilitation/engine/conditions';
import { deleteNote } from '@/lib/app/slots/delete-note';
import { getNotes } from '@/lib/app/slots/notes';
import { isRemoved, REMOVED_VALUE } from '@/lib/app/slots/removed';

const PREFIX = 'smoke-app-delete-note';
const stamp = Date.now();
/** Not in the taxonomy, so no definition can hide it or retire it mid-run. */
const SLUG = 'smoke_delete_note_life';
const SIBLING = 'smoke_delete_note_sibling';

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

async function capture(userId: string, slotSlug: string, value: string) {
  return appendSlotValue({
    userId,
    slotSlug,
    value,
    valueJson: value,
    confidence: 8,
    sourceType: 'direct',
    reasoningNote: `They said it plainly: ${value}`,
    provenance: { conversationId: `${PREFIX}-conversation` },
  });
}

function rows(userId: string, slotSlug: string) {
  return prisma.slotValue.findMany({ where: { userId, slotSlug }, orderBy: { version: 'asc' } });
}

/** The gate a journey edge would carry: "this slot reads as `value`". */
function passes(row: { slotSlug: string; valueJson: unknown; confidence: number }, value: string) {
  return evaluateCondition(
    { family: 'slot', slug: row.slotSlug, op: 'eq', value },
    {
      nodeState: () => undefined,
      slot: () => row,
      now: new Date(),
      target: undefined,
    }
  );
}

async function main(): Promise<void> {
  console.log('\nsmoke:app-delete-note\n');
  if (!(await dbReachable())) {
    console.log('skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }

  let userId: string | null = null;
  try {
    const user = await prisma.user.create({
      data: { name: `${PREFIX} person`, email: `${PREFIX}-${stamp}@example.com` },
    });
    userId = user.id;

    console.log('1. A note with two versions, and a sibling beside it');
    await capture(user.id, SLUG, 'teaches part-time');
    await capture(user.id, SLUG, 'retraining as a nurse');
    await capture(user.id, SIBLING, 'an early riser');
    check((await rows(user.id, SLUG)).length === 2, 'two versions of the note are stored');

    console.log('\n2. Remove it');
    const removed = await deleteNote({ userId: user.id, slotSlug: SLUG });
    check(removed.versions === 2, 'the removal reports both versions');
    const after = await rows(user.id, SLUG);
    check(
      after.map((row) => row.version).join(',') === '1,2',
      'both rows remain, with their version numbers'
    );
    check(after.every(isRemoved), 'both are placeholders');
    check(
      after.every((row) => row.value === REMOVED_VALUE && row.reasoningNote !== '') &&
        !JSON.stringify(after).includes('nurse') &&
        !JSON.stringify(after).includes('teaches') &&
        !JSON.stringify(after).includes(`${PREFIX}-conversation`),
      'nothing of the words or the conversation survives in either row'
    );
    const [sibling] = await rows(user.id, SIBLING);
    check(sibling?.value === 'an early riser', 'the sibling note is untouched');
    const view = await getNotes(user.id);
    const card = view.notes.find((note) => note.slotSlug === SLUG);
    check(card?.removed === true && card.value === '', 'the panel shows a placeholder');

    console.log('\n3. A journey gate reads it as unknown');
    const [head] = await getSlotHeads(user.id, { slotSlugs: [SLUG] });
    check(head !== undefined && isRemoved(head), 'the placeholder is still the head');
    check(passes(sibling, 'an early riser'), 'a live reading passes its gate');
    check(!passes(head, 'retraining as a nurse'), 'the placeholder passes none');

    console.log('\n4. The next capture lands after the placeholder');
    const next = await capture(user.id, SLUG, 'nursing, after all');
    check(next.version === 3, 'it is version 3, not a second version 1');
    const heads = (await rows(user.id, SLUG)).filter((row) => row.supersededAt === null);
    check(heads.length === 1 && heads[0].version === 3, 'it is the only head');

    console.log('\n✓ smoke:app-delete-note passed');
  } finally {
    if (userId) {
      await prisma.slotValue.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-delete-note failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
