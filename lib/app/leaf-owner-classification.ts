/**
 * Leaf-app owner classification — FILLED by Lelañea.
 *
 * A leaf app (a fork of Daybreak) classifies its own user-linked models here: `personal` for a row
 * private to one person, `not-personal` (with the reason) for one that records who did something
 * (Sunrise §115; guide: `.context/auth/authorization.md`, "Owner classification"). Daybreak keeps
 * this empty: it is the leaf's seam, reserved so a leaf's classifications merge cleanly on upgrade.
 *
 * Called by `lib/app/owner-classification.ts`'s `initAppOwnerClassification()` AFTER the framework
 * tier registers its own (`lib/framework/privacy/owner-classification.ts`). A model the framework
 * already classifies is dropped with a log; the framework's row stands.
 * `tests/unit/lib/db/owner-classification.test.ts` fails naming any model in your schema file that
 * links to a user, or to a personal model, and no tier classified.
 *
 * ```ts
 * import { registerAppOwnerClassification } from '@/lib/db/owner-classification';
 *
 * export function initLeafOwnerClassification(): void {
 *   registerAppOwnerClassification({
 *     tier: 'app',
 *     models: {
 *       AppJournalEntry: { kind: 'personal', owner: { column: 'userId' }, enforced: true },
 *       AppInvoice: { kind: 'not-personal', because: 'Org billing record; userId is who raised it.' },
 *     },
 *   });
 * }
 * ```
 *
 * Classify every user-linked model whether or not the guard names it: it sees a `userId` /
 * `createdBy` column and a `String` named `…UserId`; mark a user id named any other way with a
 * `/// owner-classification: user-id` doc line above the field.
 *
 * Synchronous, and no Prisma import: this runs while the Prisma client is being built.
 *
 * @see lib/app/owner-classification.ts · lib/db/owner-classification.ts · CUSTOMIZATION.md §4
 */

import {
  registerAppOwnerClassification,
  type OwnerClassification,
} from '@/lib/db/owner-classification';

/** Why every content revision is not personal: one reason, eleven tables. */
const EDITOR =
  'A revision of the org’s content; editorId is the admin who made the edit, null for the seed or once that admin is erased.';

/**
 * Every Lelañea model that links to a person (Daybreak 0.9.0 sync, t-174).
 *
 * **Classified, not enforced**, as Daybreak's own are: no row carries
 * `enforced: true`, so the data layer does not yet refuse a narrowed caller's
 * read of another member's rows. Our routes scope those reads to the caller,
 * as they did before. Switching enforcement on changes what every read path of
 * these tables may return under a guarded session, so it is its own reviewed
 * change, not part of a sync.
 *
 * The content revision tables and the knowledge designations name their admin
 * in `editorId` / `designatedBy`, which the guard would not recognise as a
 * user id by name; `prisma/schema/app.prisma` marks each with
 * `/// owner-classification: user-id` so the guard checks them too.
 */
export const LEAF_OWNER_CLASSIFICATION: Readonly<Record<string, OwnerClassification>> = {
  // ── A person's own records ──
  AppWaitlistEntry: { kind: 'personal', owner: { column: 'userId' } },
  AppAcknowledgement: { kind: 'personal', owner: { column: 'userId' } },
  AppUserBudget: { kind: 'personal', owner: { column: 'userId' } },
  AppTurn: { kind: 'personal', owner: { column: 'userId' } },
  AppTurnSlotWrite: { kind: 'personal', owner: { through: { field: 'turn', parent: 'AppTurn' } } },
  AppMemoryEmbedding: { kind: 'personal', owner: { column: 'userId' } },
  AppJourneyEntry: { kind: 'personal', owner: { column: 'userId' } },
  AppSafetyEvent: { kind: 'personal', owner: { column: 'userId' } },

  // ── Authored, org-owned content: the user column is who wrote it ──
  AppKnowledgeDesignation: {
    kind: 'not-personal',
    because:
      'What an uploaded document is for, set by the org; designatedBy is the admin who designated it.',
  },
  AppSlotDefinitionRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppFoundationalDocumentRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppJourneyTierRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppJourneyModuleRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppQuestionSetRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppDiscoveryQuestionRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppResourceRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppResourceWordsRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppVoiceOverlaySetRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppVoiceOverlayRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
  AppVoiceGoldenSetRevision: {
    kind: 'not-personal',
    because: EDITOR,
  },
};

/** Register ours after the framework's. Synchronous, as core's seam requires. */
export function initLeafOwnerClassification(): void {
  registerAppOwnerClassification({ tier: 'app', models: LEAF_OWNER_CLASSIFICATION });
}
