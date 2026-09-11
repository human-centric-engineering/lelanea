/**
 * Joining the waitlist, being taken off it, and the two GDPR duties either way.
 *
 * The table is the leaf's first, and the only one a visitor can write to. What
 * it holds is a person's email plus, optionally, their name, where they heard
 * about us, and what they would want to achieve — so all three of Art. 15
 * (they can ask for it), Art. 17 (they can have it removed) and the honest
 * handling of a repeat submission live here rather than in the route.
 *
 * **Removal is not erasure, and this file is where that is enforced.** An admin
 * can take someone off the list (`removedAt`), and the row survives holding their
 * email, name and answers — so neither GDPR path may treat a removed entry as
 * gone. `findWaitlistEntriesForSubject` still returns it and
 * `eraseWaitlistEntriesForUser` still deletes it, both deliberately without a
 * `removedAt` filter. See the notes on each.
 *
 * @see lib/app/leaf-data-export.ts — the Art. 15 declaration and collector
 * @see lib/app/leaf-bootstrap.ts — where the Art. 17 hook is registered
 * @see lib/app/waitlist/admin.ts — the admin read, and the removal write
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { isRecord } from '@/lib/utils';
import { registerErasureCleanupHook } from '@/lib/privacy/erasure-hooks';

/**
 * Whether a rejected write is the unique-index violation on `email`.
 *
 * Duck-typed on the code rather than `instanceof
 * Prisma.PrismaClientKnownRequestError`, because that needs a VALUE import of
 * `@prisma/client` and the ESLint boundary forbids one from `lib/app/**` —
 * "the extension surface stays storage-agnostic", and a type-only import is
 * explicitly allowed while a runtime one is not. The code string is the part
 * that carries the meaning; `lib/api/errors.ts` keys on the same one.
 *
 * P2002 means somebody is already at that address — whether from last week or
 * from a request that beat this one by a millisecond. Every other code is a
 * real failure and belongs to the caller.
 */
function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === 'P2002';
}

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
  /**
   * True when the address is on the list but REMOVED, so nothing was written
   * except the record of the attempt.
   *
   * Logged, never returned to the caller — the same rule as `created`, and for
   * the same reason. A response that differed here would answer "is this person
   * on your list, and did they ask to be taken off it", which is a more personal
   * question than the one the status code used to leak.
   */
  removed: boolean;
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
 * **The rule is enforced in the WRITE, not by a read that precedes it.** That
 * distinction is the whole of it: a rule this one holds under concurrency and
 * a check-then-act version does not, and "never overwrite" with a race in it is
 * not a weaker control, it is the absence of one. See the numbered steps below.
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

  // 1. Try the INSERT first, and let the unique index arbitrate.
  //
  //    An earlier version read the row, then decided, then upserted — and the
  //    "never overwrite" rule above is a security control, so a check-then-act
  //    gap in it is the whole rule. Two POSTs for the same fresh address could
  //    both read `null`, both conclude every column was empty, and the loser's
  //    `ON CONFLICT DO UPDATE` would then overwrite the winner's answers: the
  //    exact write this function exists to refuse, reachable by racing it.
  try {
    const created = await prisma.appWaitlistEntry.create({
      data: {
        email,
        // A blank is stored as NULL rather than as an empty string, so
        // `heardFrom IS NOT NULL` counts people who answered.
        name: name ?? null,
        heardFrom: heardFrom ?? null,
        intent: intent ?? null,
        locale,
        consentedAt: new Date(),
      },
      select: { id: true },
    });
    return { created: true, removed: false, entryId: created.id };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  // 2. The row exists. Read it once to tell a removed entry from a live one —
  //    then put every CONDITION in the WHERE of the write, so Postgres evaluates
  //    it while holding the row lock rather than this process evaluating it a
  //    round trip earlier.
  //
  //    `locale` and `consentedAt` are absent on purpose: both are provenance
  //    about the join, and an unverified repeat is not evidence about it.
  //    `updatedAt` still moves, which is what records that something touched
  //    the row.
  return prisma.$transaction(async (tx) => {
    const existing = await tx.appWaitlistEntry.findUnique({
      where: { email },
      select: { id: true, removedAt: true },
    });

    // Erased between the failed insert and this read. Vanishingly unlikely, and
    // reporting a made-up id would be worse than saying so.
    if (!existing) {
      throw new Error('Waitlist entry disappeared between insert conflict and update');
    }

    // 3. The address is on the list but REMOVED. Record that they asked again and
    //    write nothing else — not the removal cleared, not an answer filled.
    //
    //    D9 (owner, 11 September 2026). Clearing `removedAt` here is the obvious
    //    reading of "they submitted the form, so they want to be on the list",
    //    and it is wrong for the reason the whole additive rule above exists:
    //    nothing on this route proves the submitter owns the address. With a
    //    resurrect-on-rejoin rule, anyone who knows a victim's address can undo
    //    the victim's own removal, repeatedly, and the victim cannot tell —
    //    a worse version of the overwrite problem, because it defeats a request
    //    the person actually made. Staying removed SILENTLY was the other option
    //    and loses the honest case: someone who removed themselves by mistake
    //    would have no way back and no signal would reach anyone.
    //
    //    `removedAt: { not: null }` is in the WHERE rather than read first, for
    //    the same reason as every other condition in this function: a
    //    check-then-act version races a concurrent restore. If the row WAS
    //    restored in that window the update matches nothing, and falling through
    //    to the additive fill below is then the correct behaviour rather than a
    //    failure — they are back on the list, so their answers are wanted.
    // A truthy check, not `!== null`. Prisma returns `null` for a selected nullable
    // column, but a narrowed `select` elsewhere — or a test fixture that omits the
    // field — yields `undefined`, and `undefined !== null` would take the REMOVED
    // branch for a live entry: silently refusing to record what someone said and
    // counting their join as a re-join attempt. A `Date` is always truthy, so this
    // cannot be fooled either way.
    if (existing.removedAt) {
      const { count } = await tx.appWaitlistEntry.updateMany({
        where: { email, removedAt: { not: null } },
        data: { rejoinRequests: { increment: 1 }, rejoinRequestedAt: new Date() },
      });

      if (count > 0) return { created: false, removed: true, entryId: existing.id };
    }

    // 4. On the list. Fill only the columns that are still NULL.
    //
    //    `removedAt: null` is in every WHERE below, so a removal landing between
    //    the read above and these writes cannot be followed by an answer being
    //    written onto a removed row. Same discipline, same reason.
    if (name !== undefined) {
      await tx.appWaitlistEntry.updateMany({
        where: { email, name: null, removedAt: null },
        data: { name },
      });
    }
    if (heardFrom !== undefined) {
      await tx.appWaitlistEntry.updateMany({
        where: { email, heardFrom: null, removedAt: null },
        data: { heardFrom },
      });
    }
    if (intent !== undefined) {
      await tx.appWaitlistEntry.updateMany({
        where: { email, intent: null, removedAt: null },
        data: { intent },
      });
    }

    return { created: false, removed: false, entryId: existing.id };
  });
}

/**
 * How a subject's own rows are matched, on both the Art. 15 and Art. 17 paths.
 *
 * The table has no user id for anyone who joined before signing up — which is
 * everyone today — so email is the real handle, and `userId` is matched as well
 * so an entry that was linked to an account and then had its address changed
 * still reaches its owner.
 *
 * ## Lower-cased exact match, NOT `mode: 'insensitive'`
 *
 * This is the important line in the file. `{ equals, mode: 'insensitive' }`
 * compiles to Postgres `ILIKE` on the Prisma Postgres connector, and Prisma does
 * not escape the value — so `_` and `%`, both legal in an email local part,
 * become wildcards. Measured against the development database:
 *
 *     equals 'john_doe@example.com' insensitive  ->  john_doe@…  AND  johnxdoe@…
 *     equals 'a%@example.com'       insensitive  ->  a%@…        AND  ab@…
 *
 * On the export that hands the subject a stranger's address, name and stated
 * intent. On the erasure it silently DELETES that stranger's row, inside the
 * transaction, reporting only `count: 2`. Neither surfaces as an error.
 *
 * An exact match is available because `email` is lower-cased on write by
 * `waitlistEmailSchema`, so the stored value is already normalised and only the
 * comparison side needs it — the subject's account address is whatever they
 * typed at signup. It is also the faster query: exact equality uses the unique
 * index, `ILIKE` cannot.
 *
 * **Anything that writes this table must keep the address lower-cased**, or this
 * match silently starts missing rows — which on the erasure path means retaining
 * data after reporting it erased.
 */
function subjectMatch(subject: {
  userId: string;
  email: string;
}): Prisma.AppWaitlistEntryWhereInput {
  return { OR: [{ userId: subject.userId }, { email: subject.email.trim().toLowerCase() }] };
}

/**
 * Every waitlist entry belonging to a data subject (GDPR Art. 15).
 *
 * **No `removedAt` filter, and that is not an oversight.** Art. 15 is about what
 * we HOLD, and a removed entry is held in full — the email, the name, the stated
 * intent, and now the record of any attempt to re-join. Filtering it out would
 * hand the subject a bundle that omits a row sitting in the database, which is
 * the failure mode the `meta.excluded` machinery exists to prevent elsewhere.
 * `removedAt` travels with the row, so the bundle says so rather than being
 * silent about it.
 */
export function findWaitlistEntriesForSubject(subject: {
  userId: string;
  email: string;
}): Promise<unknown[]> {
  return prisma.appWaitlistEntry.findMany({
    where: subjectMatch(subject),
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
 *
 * ## A REMOVED entry is erased too, and the matcher must stay blind to `removedAt`
 *
 * An admin taking someone off the list sets `removedAt` and keeps the row. That
 * is a product state, not a deletion, so it has nothing to say about an erasure
 * request: adding `removedAt: null` to this `deleteMany` would leave every
 * removed person's email and answers in the database while reporting the erasure
 * complete — and it would look like a sensible filter to whoever added it, which
 * is why it is called out here rather than left to read as an omission.
 */
export async function eraseWaitlistEntriesForUser(ctx: {
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const { tx, userId } = ctx;

  const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });

  // The same matcher the export uses, for the same reason — see `subjectMatch`.
  // A `mode: 'insensitive'` clause here is an `ILIKE` behind a `deleteMany`,
  // which destroys a third party's row and reports it as a larger `count`.
  const match: Prisma.AppWaitlistEntryWhereInput = user?.email
    ? subjectMatch({ userId, email: user.email })
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
