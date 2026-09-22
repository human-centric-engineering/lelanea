/**
 * Leaf-app subject-data export seam (GDPR Art. 15) — FILLED by Lelañea.
 *
 * A leaf app (a fork of Daybreak) fills `collectLeafSubjectData()` with its own
 * `app_*` tables holding data about a person. Daybreak ships it empty: this is
 * the leaf's export seam, reserved so a leaf's collectors merge cleanly on
 * upgrade — the subject-access analogue of `lib/app/leaf-bootstrap.ts`,
 * `lib/app/leaf-admin-nav.ts` and `lib/app/leaf-db-drift.ts`. Lelañea declares
 * `AppWaitlistEntry`, `AppAcknowledgement`, `AppUserBudget`, `AppTurn` and `AppSafetyEvent` here; the guidance below is
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
import { findTurnsForSubject } from '@/lib/app/agent/turn-record';
import { findSafetyEventsForSubject } from '@/lib/app/safety/record';

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
      {
        // The words are not here — they are the conversation, which the
        // platform's own sections already return. This is the metering half.
        model: 'AppTurn',
        section: 'turns',
        disposition: 'export',
        description:
          'A record of each turn you took with the assistant: when, in which part of the app, which AI model answered and which version of her voice it was given, how much text it read and wrote, and what it cost. Your words and hers are in your conversations, not here.',
      },
      {
        // Never the words — see the model's docblock. Categories, tiers, the
        // region of the services shown and, for a misuse row, the guard that
        // flagged are the whole record.
        model: 'AppSafetyEvent',
        section: 'safety',
        disposition: 'export',
        description:
          'Each time something you wrote suggested you might be in danger and the app showed you where to find help: when, what kind of words it noticed, whether it stopped the conversation or let it carry on, and which country\u2019s helplines it showed you. It also records each time the app\u2019s automatic checks flagged a message of yours as a possible attempt to misuse the assistant: when, and which check flagged it. What you wrote is not stored here.',
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
      {
        // f-safety t-63. Who edited or signed off is in the admin audit log,
        // deliberately not on the row, so this is true for every reader.
        model: 'AppCrisisCopy',
        reason:
          'The words the app shows anyone who may be in danger, and the international helpline directory it points to. It holds no information about any person.',
      },
      {
        model: 'AppCrisisRegion',
        reason:
          'The helplines and emergency number the app shows for one country. It holds no information about any person.',
      },
      {
        // f-slots t-70. The authored taxonomy — what the app AIMS to learn.
        // What it has actually learned about this person is a slot VALUE, a
        // framework table, declared in `lib/framework/privacy/export-sources.ts`.
        // Keeping the two apart is the point: a subject reading their bundle
        // should get their own answers, not a catalogue of the questions.
        model: 'AppSlotDefinition',
        reason:
          'The list of things the app aims to understand about the people who use it, and what each one means. It is the same list for everyone and holds no information about you; what the app has actually learned about you is in your profile, which this bundle returns separately.',
      },
      {
        // Same situation as `AppKnowledgeDesignation`: the reason has to be
        // true for EVERY subject who could read it, administrators included,
        // and this row retains `editorId` — the account id of whoever made the
        // edit — so "it holds nothing about you" would have been false for
        // exactly the people who work here. It says what is actually retained.
        model: 'AppSlotDefinitionRevision',
        reason:
          'Every past version of that list — the wording as it stood on a given date, which is how an answer you gave is read back against the words you were actually asked under. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        // f-content-seeds t-86. Her documents as the app serves them. Who agreed
        // to which version is `AppAcknowledgement`, a source above, not this.
        model: 'AppDocumentCollection',
        reason:
          'The name, version and language of Lelañea\u2019s foundational documents. It is the same for everyone and holds no information about any person.',
      },
      {
        model: 'AppFoundationalDocument',
        reason:
          'Lelañea\u2019s foundational documents as the app currently shows them: the welcome, the pieces about Lelañea, the Disclaimer and the Terms of Use. They are the same for everyone and hold no information about any person. Which versions you agreed to is returned separately in this bundle.',
      },
      {
        // Retains `editorId`, so the reason says so, for the same reason as
        // `AppSlotDefinitionRevision` above.
        model: 'AppFoundationalDocumentRevision',
        reason:
          'Every past version of those documents, as they stood on a given date, which is how the Terms you agreed to can be read back as they were. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        // f-content-seeds t-87. The journey's text, the discovery questions and
        // the resource library, and their history. Words, not people: a
        // nothing here records who read or answered what. The six revision tables keep an editing admin's id, and say so.
        model: 'AppJourney',
        reason:
          'The name, version and language of the Lelañea journey. It is the same for everyone and holds no information about any person.',
      },
      {
        model: 'AppJourneyTier',
        reason:
          'The name of each stage of the journey and what it is for. It is the same for everyone and holds no information about any person.',
      },
      {
        model: 'AppJourneyTierRevision',
        reason:
          'Every past version of those stage names and descriptions. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        model: 'AppJourneyModule',
        reason:
          'The title of each module of the journey and the steps inside it. It is the same for everyone and holds no information about any person.',
      },
      {
        model: 'AppJourneyModuleRevision',
        reason:
          'Every past version of those module titles and steps. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        model: 'AppQuestionSet',
        reason:
          'The introduction to the discovery questions, and the note on taking them at your own pace. It is the same for everyone and holds no information about any person.',
      },
      {
        model: 'AppQuestionSetRevision',
        reason:
          'Every past version of that introduction. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        model: 'AppDiscoveryQuestion',
        reason:
          'The discovery questions themselves, as asked. They are the same for everyone and hold no information about any person.',
      },
      {
        model: 'AppDiscoveryQuestionRevision',
        reason:
          'Every past version of those questions, which is how an answer you gave can be read back against the words you were asked. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        model: 'AppResourceCollection',
        reason:
          'The name and version of Lelañea\u2019s library of films and reading, and whether she has signed it off. It is the same for everyone and holds no information about any person.',
      },
      {
        model: 'AppResource',
        reason:
          'The films and pieces of reading in that library. They are the same for everyone and hold no information about any person.',
      },
      {
        model: 'AppResourceRevision',
        reason:
          'Every past version of those films and pieces of reading. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        model: 'AppResourceWords',
        reason:
          'Short passages of Lelañea\u2019s own words shown beside each part of the journey. They are the same for everyone and hold no information about any person.',
      },
      {
        model: 'AppResourceWordsRevision',
        reason:
          'Every past version of those passages. It says nothing about you; if you are an administrator here, it retains the account id of whoever made each edit, and nothing else.',
      },
      {
        // f-slots t-72. A ledger of writes, not the writes themselves — it
        // exists so a retried turn cannot record one thing twice, and it holds
        // a slug, a version number and a timestamp. What was actually learned
        // is the slot VALUE, a framework table, and the turn it belongs to is
        // this bundle's `turns` section. Returning this as well would hand a
        // subject a third view of the same event, in the vocabulary of an
        // index rather than of anything they said.
        //
        // Erasure is the turn's: the row is a child of `AppTurn` with
        // `onDelete: Cascade`, and that turn cascades from `user`. There is no
        // second disposition to keep in step.
        model: 'AppTurnSlotWrite',
        reason:
          'A note that one of your conversation turns recorded something in your profile, kept only so that repeating a turn cannot record the same thing twice. What was recorded is in your profile, and the turn itself is in the conversations section of this bundle.',
      },
    ],
  });
}

/**
 * Collect Lelañea's own data about one subject.
 *
 * Five sections: `waitlist`, `acknowledgements`, `budget`, `turns` and `safety`. Each is returned whether or
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
  const [waitlist, acknowledgements, budget, turns, safety] = await Promise.all([
    findWaitlistEntriesForSubject(subject),
    findAcknowledgementsForSubject(subject),
    findUserBudgetsForSubject(subject),
    findTurnsForSubject(subject),
    findSafetyEventsForSubject(subject),
  ]);
  return { waitlist, acknowledgements, budget, turns, safety };
}
