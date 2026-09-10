/**
 * Joining the waitlist, and the two GDPR duties that come with keeping the row.
 *
 * The table is the leaf's first, and the only one a visitor can write to. What
 * it holds is a person's email plus, optionally, their name, where they heard
 * about us, and what they would want to achieve — so all three of Art. 15
 * (they can ask for it), Art. 17 (they can have it removed) and the honest
 * handling of a repeat submission live here rather than in the route.
 *
 * @see lib/app/leaf-data-export.ts — the Art. 15 declaration and collector
 * @see lib/app/leaf-bootstrap.ts — where the Art. 17 hook is registered
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { registerErasureCleanupHook } from '@/lib/privacy/erasure-hooks';

/** What a caller supplies to join. Email is already normalised by the schema. */
export interface JoinWaitlistInput {
  email: string;
  name?: string;
  heardFrom?: string;
  intent?: string;
  /** BCP-47 tag resolved from the request — see `./locale`. */
  locale: string;
}

export interface JoinWaitlistResult {
  /** True on a first join, false when an existing entry was updated. */
  created: boolean;
  entryId: string;
}

/**
 * Record a join, or update the answers on one that already exists.
 *
 * ## A repeat is an update, not a conflict
 *
 * `email` is unique, so a second submission from the same address could have
 * been a 409. It is not: someone re-submitting is almost always someone who
 * wanted to change or add an answer, or who is not sure the first one landed.
 * Telling them "you are already on the list" in an error register would be
 * accurate and unkind, and it would throw away the better answer they just
 * typed. So the answers are updated and the caller is told it existed.
 *
 * ## A BLANK optional field on a repeat leaves the stored answer alone
 *
 * This is the correction that a smoke run against a real database produced, and
 * it is not obvious from the code that caused it. The first shape wrote every
 * optional field on the update, so a blank one wrote `NULL`.
 *
 * The form always renders empty. So someone who joined with their name and a
 * paragraph about what they wanted, then came back and re-submitted just their
 * email — because they were not sure the first one landed, which is the single
 * commonest reason anyone re-submits anything — silently lost both. They could
 * not see what they had said, so they could not know it had gone, and Lelañea
 * reads these herself: the answer is simply not there any more.
 *
 * So a blank leaves the stored value untouched, and only a value actually typed
 * overwrites one. The cost is that this route cannot CLEAR an answer, which is
 * a thing nobody can currently ask for — the form shows no existing value to
 * clear, and erasure removes the whole row.
 *
 * **`consentedAt` is refreshed on the update, `createdAt` is not.** They record
 * different facts: when this person first asked to be told, and when they most
 * recently agreed to the notice printed above the button. A resubmission is a
 * fresh act of consent under the same notice, so the consent timestamp moves;
 * their place in the queue does not.
 *
 * ## What an update deliberately does NOT touch
 *
 * `userId` and `source` are left alone. A repeat submission through the public
 * form must not unlink an entry that has been attached to an account, and must
 * not relabel an entry that arrived some other way — `upsert`'s update clause
 * names only the fields the form owns.
 */
export async function joinWaitlist(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
  const { email, name, heardFrom, intent, locale } = input;
  const now = new Date();

  // Prisma has no "did this upsert insert or update?" flag, so the row is read
  // first. The race — two submissions of the same address arriving together —
  // resolves correctly either way: the unique index makes one of them the
  // insert, `upsert` turns the loser into an update, and the only thing that can
  // be wrong is the 201-vs-200 on the response. Paying for a transaction to make
  // a status code exact would be the wrong trade.
  const existing = await prisma.appWaitlistEntry.findUnique({
    where: { email },
    select: { id: true },
  });

  const entry = await prisma.appWaitlistEntry.upsert({
    where: { email },
    create: {
      email,
      // On a CREATE a blank is stored as NULL rather than as an empty string,
      // so `heardFrom IS NOT NULL` counts people who answered.
      name: name ?? null,
      heardFrom: heardFrom ?? null,
      intent: intent ?? null,
      locale,
      consentedAt: now,
    },
    update: {
      // Spread, not `?? null` — an absent answer is OMITTED from the update, so
      // Prisma leaves the column alone. See the note above: writing null here
      // means a returning visitor re-submitting just their email loses what
      // they told her the first time, with nothing on screen to show it went.
      ...(name === undefined ? {} : { name }),
      ...(heardFrom === undefined ? {} : { heardFrom }),
      ...(intent === undefined ? {} : { intent }),
      locale,
      consentedAt: now,
    },
    select: { id: true },
  });

  return { created: existing === null, entryId: entry.id };
}

/**
 * Every waitlist entry belonging to a data subject.
 *
 * Matched on email — the table has no user id for anyone who joined before
 * signing up, which is everyone today. Case-insensitively, because the stored
 * value is lower-cased on write and the subject's account email may not be.
 *
 * `userId` is matched too, so an entry that was linked to the account and then
 * had its address changed still reaches its owner.
 */
export function findWaitlistEntriesForSubject(subject: {
  userId: string;
  email: string;
}): Promise<unknown[]> {
  return prisma.appWaitlistEntry.findMany({
    where: {
      OR: [{ userId: subject.userId }, { email: { equals: subject.email, mode: 'insensitive' } }],
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** The erasure hook's name, exported so the wiring test can name it too. */
export const WAITLIST_ERASURE_HOOK = 'lelanea:waitlist-entry';

/**
 * Remove a subject's waitlist entries when their account is erased.
 *
 * ## Why a hook is needed at all, when the FK already has a policy
 *
 * The hand-written FK is `ON DELETE SET NULL`, which is right for the link and
 * wrong on its own for the row: the entry survives the account holding their
 * email, their name and what they said they wanted, pointed at by nothing. That
 * is precisely the residual PII `lib/privacy/erasure-hooks.ts` exists for.
 *
 * ## Why it re-reads the email inside the transaction
 *
 * The hook context carries only `userId`, and almost every row is matched by
 * email rather than by that id — nothing writes `userId` yet. The hook runs
 * INSIDE the erasure transaction and BEFORE `tx.user.delete()`, so the user row
 * is still there to read the address from. Matching on both is what makes this
 * work for an entry that was linked and one that never was.
 *
 * A throw here rolls the whole erasure back, which is the contract for the
 * in-transaction phase and is the right failure: an erasure that reported
 * success while leaving the person's email on a public-form table would be
 * worse than one that failed loudly.
 */
export async function eraseWaitlistEntriesForUser(ctx: {
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const { tx, userId } = ctx;

  const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });

  const match: Prisma.AppWaitlistEntryWhereInput = user?.email
    ? { OR: [{ userId }, { email: { equals: user.email, mode: 'insensitive' } }] }
    : { userId };

  const { count } = await tx.appWaitlistEntry.deleteMany({ where: match });

  if (count > 0) {
    // No email, no id — the point of the erasure is that neither survives it.
    logger.info('Waitlist entries erased with user', { userId, count });
  }
}

/**
 * Wire the erasure hook. Called from `initLeafApp()` at server startup;
 * `registerErasureCleanupHook` is idempotent by name, so a repeated import
 * under HMR replaces rather than duplicates.
 */
export function registerWaitlistErasureHook(): void {
  registerErasureCleanupHook({
    name: WAITLIST_ERASURE_HOOK,
    scrubInTransaction: eraseWaitlistEntriesForUser,
  });
}
