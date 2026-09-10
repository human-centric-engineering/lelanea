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
 * ## A repeat is an update, not a conflict — but a strictly ADDITIVE one
 *
 * `email` is unique, so a second submission from the same address could have
 * been a 409. It is not: someone re-submitting is almost always someone who
 * wanted to add an answer, or who is not sure the first one landed. Telling
 * them "you are already on the list" in an error register would be accurate and
 * unkind. So a repeat fills in what is still empty and the caller is told the
 * entry existed.
 *
 * **An update never overwrites a stored answer, and never moves `consentedAt`.**
 * That is not squeamishness about lost text — it is the only defence this route
 * has, because **nothing here proves the submitter owns the address.** There is
 * no confirmation email this phase (A8) and no token, so `email` is simply a
 * string a stranger typed. Two things follow, and the security review of this
 * task named both:
 *
 * - **An overwrite is a write primitive aimed at someone else.** `intent` is up
 *   to 2000 characters that Lelañea reads herself, and that are meant to seed
 *   that person's profile. With overwrite allowed, anyone who knows a victim's
 *   address can replace what they said with anything they like — abuse, a fake
 *   request, a misleading claim — attributed to the victim, in her own reading
 *   queue. The victim cannot tell: the form never shows a stored value.
 * - **`consentedAt` is an audit fact, not a heartbeat.** It records that *this
 *   person* agreed to the notice above the button. A third party's POST is not
 *   that act, so moving the timestamp would record a consent that did not
 *   happen — under Art. 7(1) the one field whose entire job is to be true.
 *   An earlier version of this function refreshed it on every repeat, reasoning
 *   that a resubmission is a fresh act of consent. It is, when it is the same
 *   person. Nothing here can tell.
 *
 * The cost is the correction case: someone who wants to CHANGE an answer they
 * already gave cannot do it through this route. That is the right way round
 * while there is no proof of ownership — she reads these by hand and can be
 * written to — and the honest fix is a signed confirmation link, which is the
 * same mechanism the first waitlist email will need anyway.
 *
 * `createdAt` and `locale` are untouched on an update for the same reason:
 * they are provenance about the join, and a stranger's browser is not it.
 *
 * ## What an update deliberately does NOT touch
 *
 * `userId` and `source` are left alone as well. A repeat submission through the
 * public form must not unlink an entry that has been attached to an account, and
 * must not relabel an entry that arrived some other way — `upsert`'s update
 * clause names only the fields the form owns and only where they are empty.
 */
export async function joinWaitlist(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
  const { email, name, heardFrom, intent, locale } = input;
  const now = new Date();

  // The stored answers are read first, because the update below is built from
  // them: a field that already holds something is not offered to the update at
  // all. Reading also answers "insert or update?", which Prisma's upsert does
  // not report.
  //
  // The race — two submissions of the same address arriving together — resolves
  // correctly either way: the unique index makes one of them the insert and
  // `upsert` turns the loser into an update. The worst outcome is that both see
  // the row as absent and the second one's answers fill fields the first had
  // just filled, which is the same shape as two honest people typing at once.
  const existing = await prisma.appWaitlistEntry.findUnique({
    where: { email },
    select: { id: true, name: true, heardFrom: true, intent: true },
  });

  /**
   * Offer a value to the update ONLY when the caller supplied one and the column
   * is still empty. See the note above: without the second half this is an
   * unauthenticated overwrite of somebody else's words.
   */
  const fillIfEmpty = (
    field: 'name' | 'heardFrom' | 'intent',
    value: string | undefined
  ): Record<string, string> =>
    value !== undefined && (existing?.[field] ?? null) === null ? { [field]: value } : {};

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
      ...fillIfEmpty('name', name),
      ...fillIfEmpty('heardFrom', heardFrom),
      ...fillIfEmpty('intent', intent),
      // `locale` and `consentedAt` are absent on purpose, not by oversight —
      // both are provenance about the join, and an unverified repeat is not
      // evidence about it. `updatedAt` still moves, which is what records that
      // something touched the row.
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
