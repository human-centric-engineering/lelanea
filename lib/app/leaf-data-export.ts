/**
 * Leaf-app subject-data export seam (GDPR Art. 15) — FILLED by Lelañea.
 *
 * A leaf app (a fork of Daybreak) fills `collectLeafSubjectData()` with its own
 * `app_*` tables holding data about a person. Daybreak ships it empty: this is
 * the leaf's export seam, reserved so a leaf's collectors merge cleanly on
 * upgrade — the subject-access analogue of `lib/app/leaf-bootstrap.ts`,
 * `lib/app/leaf-admin-nav.ts` and `lib/app/leaf-db-drift.ts`. Lelañea declares
 * `AppWaitlistEntry` here; the guidance below is upstream's and still applies to
 * every table added after it.
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
    ],
  });
}

/**
 * Collect Lelañea's own data about one subject.
 *
 * One section today: `waitlist`. It is returned whether or not the subject has
 * an entry — an empty array, never an omitted key. A declared section missing
 * from this object makes `exportUserData()` throw, and a key set to `undefined`
 * counts as missing because `JSON.stringify` drops it.
 *
 * The rows are matched by EMAIL as well as by user id, because the waitlist is
 * the one thing a stranger can do before there is an account: for everyone on
 * it today there is no user id to match on. That makes it the same case as
 * core's `ContactSubmission`, and the same reason the coverage guard could
 * never have found this table for us.
 */
export async function collectLeafSubjectData(subject: AppSubjectQuery): Promise<AppSubjectData> {
  const waitlist = await findWaitlistEntriesForSubject(subject);
  return { waitlist };
}
