/**
 * The acknowledgement ledger — what a person acknowledged, which version, when.
 *
 * The Terms require eighteen, and both legal documents must be explicitly
 * acknowledged before the app opens (§06). This module owns the three questions
 * that follow from that: what is CURRENTLY required, what one person has
 * satisfied against it, and how to record one more acknowledgement. The gate
 * that redirects on the answer is t-16's layout; the routes in
 * `app/api/v1/app/acknowledgements/` are the API in front of this.
 *
 * ## A kind is satisfied by a version, not by ever having been acknowledged
 *
 * Each row carries the version it was given against. For `disclaimer` and
 * `terms` that is the foundational collection's own `version` — the two
 * documents are versioned together, in the file, by their author. For `age_18`
 * it is `AGE_18_VERSION`, a constant naming the threshold. A kind counts as
 * satisfied only when a row exists for the version required NOW, so bumping the
 * collection re-gates both documents by construction and nothing here has to
 * notice that it happened. The old rows stay: they are the record of what was
 * agreed before, and the Art. 15 export returns all of them.
 *
 * That version is COLLECTION-wide — the content schema has no per-document
 * version, and the same string covers the five non-legal documents too. So the
 * authoring rule, recorded in `.context/app/gateway.md`: any edit to the
 * Disclaimer or the Terms text MUST bump `collection.version`, and a bump for
 * any other reason re-gates everyone. A per-document version is the change to
 * make if either side of that becomes a problem; it is a content-schema change
 * first and a one-line change here second.
 *
 * ## Storage-agnostic on purpose
 *
 * A type-only import of `@prisma/client` is allowed from `lib/app/**`; a value
 * import is not (the ESLint boundary), so the unique-violation check below
 * duck-types on the code the same way `lib/app/waitlist/service.ts` does.
 *
 * @see prisma/schema/app.prisma — `AppAcknowledgement`, and why it is insert-only
 * @see lib/app/leaf-data-export.ts — the Art. 15 declaration and collector
 * @see lib/app/leaf-db-drift.ts — the hand-written CASCADE FK, pinned
 */

import type { AppAcknowledgement } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { isRecord } from '@/lib/utils';
import { getFoundationalCollectionMeta, listFoundationalDocuments } from '@/lib/app/content';
import { ACKNOWLEDGEMENT_KINDS, type AcknowledgementKind } from '@/lib/app/gateway/kinds';

export { ACKNOWLEDGEMENT_KINDS, type AcknowledgementKind };

/**
 * The "version" an `age_18` acknowledgement is recorded against.
 *
 * There is no document behind the age rule, so this names the threshold
 * instead. It changes only if the rule does — a different age, or a different
 * form of confirmation — and changing it re-gates everyone, which is the point.
 */
export const AGE_18_VERSION = '18';

/**
 * Which foundational document each document-backed kind stands for.
 *
 * Explicit rather than derived from `requiresAcknowledgement` in the content
 * file, because the kind is a database enum and the mapping has to be stable
 * across content edits. The test in `tests/unit/lib/app/gateway/` pins the
 * other direction: every document that requires acknowledgement has a kind
 * here, so an author cannot add a third legal document that nobody is asked to
 * agree to.
 */
export const DOCUMENT_FOR_KIND = {
  disclaimer: 'disclaimer',
  terms: 'terms_of_use',
} as const satisfies Partial<Record<AcknowledgementKind, string>>;

/** The version each kind must currently be acknowledged against. */
export type RequiredVersions = Record<AcknowledgementKind, string>;

/**
 * What every kind currently requires — read from the content loader on each
 * call so a version bump is live without a restart of anything but the loader.
 */
export function getRequiredVersions(): RequiredVersions {
  const { version } = getFoundationalCollectionMeta();
  return { disclaimer: version, terms: version, age_18: AGE_18_VERSION };
}

/**
 * The ids of every foundational document that requires acknowledgement, as the
 * authored file declares them. Exposed for the mapping test; the gate itself
 * reads `DOCUMENT_FOR_KIND`.
 */
export function listAcknowledgementRequiredDocumentIds(): string[] {
  return listFoundationalDocuments()
    .documents.filter((document) => document.requiresAcknowledgement)
    .map((document) => document.id);
}

/** One kind's standing for one person, against what is required now. */
export interface KindStatus {
  kind: AcknowledgementKind;
  /** The version a row must carry to satisfy this kind today. */
  requiredVersion: string;
  /** For `disclaimer` and `terms`, the document to read; `null` for `age_18`. */
  documentId: string | null;
  /** True when a row exists for exactly `requiredVersion`. */
  satisfied: boolean;
  /** When that row was recorded, or `null` when the kind is outstanding. */
  acknowledgedAt: Date | null;
}

/** Where one person stands at the gate. */
export interface GateStatus {
  /** True when every kind is satisfied against its current version. */
  complete: boolean;
  /** Every kind, in presentation order. */
  kinds: KindStatus[];
  /** The kinds still outstanding, in the same order — empty when complete. */
  outstanding: AcknowledgementKind[];
}

/**
 * Where one person stands at the gate: which kinds are satisfied against the
 * current versions, and which are outstanding.
 *
 * Reads every row the person has, not just the current-version ones, and
 * matches in memory — the table holds a handful of rows per person for life,
 * and reading them all means a version bump needs no query change. A row for
 * an OLD version is neither satisfied nor an error; it is simply not the one
 * being asked for.
 */
export async function getGateStatus(userId: string): Promise<GateStatus> {
  const required = getRequiredVersions();
  const rows = await prisma.appAcknowledgement.findMany({
    where: { userId },
    select: { kind: true, documentVersion: true, acknowledgedAt: true },
  });

  const kinds = ACKNOWLEDGEMENT_KINDS.map((kind): KindStatus => {
    const requiredVersion = required[kind];
    const match = rows.find((row) => row.kind === kind && row.documentVersion === requiredVersion);
    return {
      kind,
      requiredVersion,
      documentId: kind === 'age_18' ? null : DOCUMENT_FOR_KIND[kind],
      satisfied: match !== undefined,
      acknowledgedAt: match?.acknowledgedAt ?? null,
    };
  });

  const outstanding = kinds.filter((entry) => !entry.satisfied).map((entry) => entry.kind);
  return { complete: outstanding.length === 0, kinds, outstanding };
}

/** What `recordAcknowledgement` answers: the row, and whether this call made it. */
export interface RecordAcknowledgementResult {
  /** True when this call inserted the row; false when it already existed. */
  created: boolean;
  row: Pick<AppAcknowledgement, 'id' | 'kind' | 'documentVersion' | 'acknowledgedAt'>;
}

/**
 * Whether a rejected write is the unique-index violation on
 * `(userId, kind, documentVersion)` — the same person, the same kind, the same
 * version, from last week or from a double-click a millisecond ago. Every other
 * code is a real failure and belongs to the caller.
 */
function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === 'P2002';
}

/**
 * Record that `userId` acknowledged `kind` against the version required NOW.
 *
 * The version is never supplied by the caller: what they are agreeing to is
 * what is currently served, and letting a client name an older version would
 * let it satisfy the gate without reading the current text.
 *
 * Insert-first, and the unique index arbitrates. A repeat is answered with the
 * existing row and `created: false` rather than an error — acknowledging twice
 * is not a mistake a person should be told about — and the existing row's
 * `acknowledgedAt` is what stands, because the record is of the FIRST time
 * they agreed to this version, not the latest click.
 */
export async function recordAcknowledgement(
  userId: string,
  kind: AcknowledgementKind
): Promise<RecordAcknowledgementResult> {
  const documentVersion = getRequiredVersions()[kind];
  const select = { id: true, kind: true, documentVersion: true, acknowledgedAt: true } as const;

  try {
    const row = await prisma.appAcknowledgement.create({
      data: { userId, kind, documentVersion },
      select,
    });
    logger.info('Acknowledgement recorded', { userId, kind, documentVersion });
    return { created: true, row };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const row = await prisma.appAcknowledgement.findUnique({
    where: { userId_kind_documentVersion: { userId, kind, documentVersion } },
    select,
  });
  // The unique violation says the row exists, so `null` here means it was
  // erased between the two statements — an account deletion racing an
  // acknowledgement. Treat it as the failure it is rather than inventing a row.
  if (!row) {
    throw new Error(`Acknowledgement for ${kind} vanished between insert and read`);
  }
  return { created: false, row };
}

/**
 * Every acknowledgement one person has ever given, oldest first, for the
 * Art. 15 export — including rows against superseded versions, because we
 * still hold them and they are the record of what was agreed when.
 */
export function findAcknowledgementsForSubject(subject: {
  userId: string;
}): Promise<AppAcknowledgement[]> {
  return prisma.appAcknowledgement.findMany({
    where: { userId: subject.userId },
    orderBy: { acknowledgedAt: 'asc' },
  });
}
