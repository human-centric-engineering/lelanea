/**
 * The framework tier's owner classification (Sunrise §115, the owner layer).
 *
 * Sunrise 0.15.0 classifies every user-linked model as private to one person
 * (`personal`) or as a record of who did something (`not-personal`), and its
 * coverage guard (`tests/unit/lib/db/owner-classification.test.ts`) fails naming
 * any model in a fork schema file that links to a user and no tier classified.
 * These are the framework's, registered by {@link initFrameworkOwnerClassification}
 * from the `lib/app/owner-classification.ts` bridge — core runs that init lazily,
 * in whichever runtime builds the Prisma client, which `initFramework()` cannot
 * reach.
 *
 * **Classified, not enforced.** No `personal` row here carries `enforced: true`,
 * so the data layer does not yet refuse a narrowed caller's read of another
 * member's journeys or slot values: the framework's routes scope those reads to
 * the caller, as they did before 0.15.0. Switching enforcement on changes what
 * every framework read path may return under a guarded session, so it is its own
 * reviewed change, not part of a sync.
 *
 * The guard sees a `userId` / `createdBy` column and, since Sunrise 0.16.0, a `String` named
 * `…UserId`; a user id named any other way needs a `/// owner-classification: user-id` doc line.
 * (Through Sunrise 0.15.0 its parser also skipped any line whose comment mentioned `@relation`,
 * which hid eight of these ten models until their comments were reworded — Sunrise #1067.)
 *
 * Imports nothing but core's registrar: this runs while the Prisma client is
 * being built, so it must not reach `@/lib/db`.
 *
 * @see lib/db/owner-classification.ts — core's classification and the registrar
 */

import {
  registerAppOwnerClassification,
  type OwnerClassification,
} from '@/lib/db/owner-classification';

export const FRAMEWORK_OWNER_CLASSIFICATION: Readonly<Record<string, OwnerClassification>> = {
  // ── A person's own journey through a map, and what it captured ──
  UserJourney: { kind: 'personal', owner: { column: 'userId' } },
  UserNodeState: {
    kind: 'personal',
    owner: { through: { field: 'journey', parent: 'UserJourney' } },
  },
  JourneyEvent: { kind: 'personal', owner: { column: 'userId' } },
  FrameworkJourneyNudge: { kind: 'personal', owner: { column: 'userId' } },
  SlotValue: { kind: 'personal', owner: { column: 'userId' } },

  // ── Authored, org-owned configuration: the user column is who wrote it ──
  FacilitationGraph: {
    kind: 'not-personal',
    because: 'An org’s facilitation map; createdBy is the admin who authored it.',
  },
  FacilitationGraphVersion: {
    kind: 'not-personal',
    because: 'A published version of an org’s map; createdBy is its author (a user or an agent).',
  },
  FacilitationPolicy: {
    kind: 'not-personal',
    because: 'An org’s facilitation policy; createdBy is the admin who authored it.',
  },
  ModuleVersion: {
    kind: 'not-personal',
    because: 'A module configuration version; createdBy is the admin who saved it.',
  },
  ModuleWorkflowBinding: {
    kind: 'not-personal',
    because: 'Binds a workflow to a module for the org; createdBy is the admin who bound it.',
  },
  StructureChangeProposal: {
    kind: 'not-personal',
    because:
      'A proposed change to org configuration; createdBy is its author (a user or an agent) and reviewedBy the admin who decided it.',
  },
};

/** Register the framework's classifications with core. Synchronous, as core's seam requires. */
export function initFrameworkOwnerClassification(): void {
  registerAppOwnerClassification({ tier: 'framework', models: FRAMEWORK_OWNER_CLASSIFICATION });
}
