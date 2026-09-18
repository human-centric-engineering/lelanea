/**
 * Leaf-app subject-data export seam (GDPR Art. 15) — FILLED by Lelañea.
 *
 * A leaf app (a fork of Daybreak) fills `collectLeafSubjectData()` with its own
 * `app_*` tables holding data about a person. Daybreak ships it empty: this is
 * the leaf's export seam, reserved so a leaf's collectors merge cleanly on
 * upgrade — the subject-access analogue of `lib/app/leaf-bootstrap.ts`,
 * `lib/app/leaf-admin-nav.ts` and `lib/app/leaf-db-drift.ts`. Lelañea declares
 * `AppWaitlistEntry`, `AppAcknowledgement` and `AppUserBudget` here; the guidance below is
 * upstream's and still applies to every table added after them.
 *
 * Called by `lib/app/data-export.ts`'s `collectAppSubjectData()` alongside the
 * framework tier's own collector. Whatever you return lands under `app.<section>`
 * in the export bundle.
 *
 * ```ts
 * export async function collectLeafSubjectData({ userId }: AppSubjectQuery): Promise<AppSubjectData> {
 *   const bookings = await prisma.appBooking.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
 *   return { bookings };
 * }
 * ```
 *
 * **Declare what you return, in `initLeafSubjectSources()` below.** Since Sunrise
 * 0.10.0 core holds every fork-tier schema file to full accounting: each model in
 * `prisma/schema/app.prisma` must be declared a source or excluded with a reason,
 * or `tests/unit/lib/privacy/export-sources.test.ts` fails naming it. Declaring is
 * also a promise — `exportUserData()` throws if a declared section is missing from
 * what you return, so return the key with an empty array rather than omitting it.
 *
 * **The framework tier's section names are taken** — its sources are declared in
 * the same registry, which refuses a section another tier already claimed. See
 * `lib/framework/privacy/export-sources.ts` for the current list.
 *
 * A table holding no personal data is not left out silently — it is an `excluded`
 * row with a reason, and that reason is shown to the data subject verbatim in the
 * bundle's `meta.excluded`. It is what lets them tell "we hold nothing about you"
 * apart from "we decided not to give it to you", so write it for that reader.
 *
 * @see lib/app/data-export.ts · .context/privacy/data-export.md · CUSTOMIZATION.md §4
 */

import type { AppSubjectData, AppSubjectQuery } from '@/lib/app/data-export';
import { registerAppSubjectSources } from '@/lib/privacy/subject-source-registry';
import { findWaitlistEntriesForSubject } from '@/lib/app/waitlist/service';
import { findAcknowledgementsForSubject } from '@/lib/app/gateway/acknowledgements';
import { findUserBudgetsForSubject } from '@/lib/app/agent/settings';

/**
 * Declare the leaf app's own models to core's subject-source registry.
 *
 * Called (synchronously) by `lib/app/data-export.ts`'s `initAppSubjectSources()`
 * after the framework tier declares, so both tiers land in the same registry
 * without either consuming the other's slot.
 *
 * ```ts
 * export function initLeafSubjectSources(): void {
 *   registerAppSubjectSources({
 *     tier: 'app',
 *     sources: [
 *       {
 *         model: 'AppBooking',
 *         section: 'bookings',
 *         disposition: 'export',
 *         description: 'Bookings you made through the app.',
 *       },
 *     ],
 *     excluded: [
 *       { model: 'AppRoomType', reason: 'Reference list of room types — holds no personal data.' },
 *     ],
 *   });
 * }
 * ```
 */
export function initLeafSubjectSources(): void {
  registerAppSubjectSources({
    tier: 'app',
    sources: [
      {
        model: 'AppWaitlistEntry',
        section: 'waitlist',
        disposition: 'export',
        description:
          'Your waitlist entry — the email address you gave, and anything you told us about where you heard about Lelañea and what you would want to achieve.',
      },
      {
        model: 'AppAcknowledgement',
        section: 'acknowledgements',
        disposition: 'export',
        description:
          'What you acknowledged at the gate — the disclaimer, the terms of use, and that you are eighteen or over — with the version of each you agreed to and when.',
      },
      {
        model: 'AppUserBudget',
        section: 'budget',
        disposition: 'export',
        description:
          'A monthly spending limit an administrator set for you personally, if there is one, and when it was set. Empty means you are on the limit that applies to everyone.',
      },
    ],
    excluded: [
      {
        // The reason is read by the data subject, so it has to be true for
        // EVERY subject who could read it \u2014 including an administrator. The
        // row carries `designatedBy`, the id of the admin who last set the
        // designation, deliberately without an FK so the note survives that
        // person's account. "It holds nothing about you" was therefore wrong
        // for exactly the people who work here, and the reason is what lets a
        // subject tell "we hold nothing" apart from "we decided not to give it
        // to you" \u2014 so it says what is actually retained.
        model: 'AppKnowledgeDesignation',
        reason:
          'A note about one of Lela\u00f1ea\u2019s own uploaded documents \u2014 what it is for, and on what terms we may use it. It says nothing about you; if you are an administrator here, it retains the account id of whoever last set that note, and nothing else.',
      },
      {
        // Unlike the designation row above, this pair genuinely retains nothing
        // about anybody \u2014 not even an administrator's id. The admin who queued a
        // comparison is recorded by the platform on the evaluation run itself,
        // which is where a subject's own export already reaches it from; copying
        // it down here would have created a second disclosure obligation for a
        // fact already covered.
        model: 'AppVoiceComparison',
        reason:
          'A record that somebody listened to Lela\u00f1ea\u2019s fixed set of test questions to check how she sounds \u2014 which version of her voice, and when. It holds no information about any person.',
      },
      {
        model: 'AppVoiceComparisonArm',
        reason:
          'One half of such a check: the instructions the assistant was given before it answered the test questions, and nothing else. The questions are ours, not anyone\u2019s, and no answer or account is recorded here.',
      },
      {
        // Who changed these numbers is in the admin audit log, deliberately not
        // on the row, so this reason is true for every reader — administrators
        // included.
        model: 'AppAgentSettings',
        reason:
          'The app\u2019s own settings: how long the assistant may take to answer, and the monthly spending limit that applies to everyone by default. It holds no information about any person.',
      },
    ],
  });
}

/**
 * Collect Lelañea's own data about one subject.
 *
 * Three sections: `waitlist`, `acknowledgements` and `budget`. Each is returned whether or
 * not the subject has a row — an empty array, never an omitted key. A declared
 * section missing from this object makes `exportUserData()` throw, and a key
 * set to `undefined` counts as missing because `JSON.stringify` drops it.
 *
 * The waitlist rows are matched by EMAIL as well as by user id, because the
 * waitlist is the one thing a stranger can do before there is an account: for
 * everyone on it today there is no user id to match on. That makes it the same
 * case as core's `ContactSubmission`, and the same reason the coverage guard
 * could never have found this table for us. Acknowledgements are matched by
 * user id alone — there is no row without an account — and include those
 * against superseded document versions, because we still hold them.
 */
export async function collectLeafSubjectData(subject: AppSubjectQuery): Promise<AppSubjectData> {
  const [waitlist, acknowledgements, budget] = await Promise.all([
    findWaitlistEntriesForSubject(subject),
    findAcknowledgementsForSubject(subject),
    findUserBudgetsForSubject(subject),
  ]);
  return { waitlist, acknowledgements, budget };
}
