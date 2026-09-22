/**
 * How the stored voice overlays are served (f-content-seeds t-88).
 *
 * The served shape and the one projection from rows to it. Pure, with no
 * database import, so the store, the seed's tests and the fake store all build
 * the overlays the same way.
 *
 * **Validated on the way out.** `provenance`, `exemplars` and `coreOnly` are
 * JSON columns, and every string in the last two reaches a model. A row that
 * fails throws rather than composing a prompt out of half a block — a partial
 * `exemplars` would be worse than none, because `originLabel` is what tells the
 * model her writing from the person's.
 *
 * @see lib/app/content/voice-overlay-store.ts — the reads and writes
 */

import { z } from 'zod';
import type { ContentCollectionMeta } from '@/lib/app/content/document-view';

// ============================================================================
// Served shape
// ============================================================================

/** Whether she has signed a piece of her register off. */
export type VoiceContentStatus = 'draft' | 'signed_off';

/**
 * One register overlay: the situation it answers to, and the beats it adds.
 *
 * `situation` is the key a chat request carries as its `contextId`, so it is the
 * wire vocabulary as well as the authored one. `when` is a note to whoever
 * reviews the overlays and is deliberately NOT part of what reaches a prompt —
 * served because a reviewer needs it, emitted nowhere. It is stored as
 * `reviewerNote`, `when` being a reserved word in SQL.
 */
export interface VoiceOverlay {
  situation: string;
  label: string;
  when: string;
  heading: string;
  /** Each entry is a beat. Joined with a newline, never with a space. */
  lines: readonly string[];
  /** What her voice material is searched for in this moment. Authored, not derived. */
  exemplarQuery: string;
  status: VoiceContentStatus;
  /** Counts every write to this overlay. */
  revision: number;
}

/** The copy that labels a retrieved passage as hers. */
export interface VoiceExemplarCopy {
  readonly heading: string;
  readonly originLabel: string;
  readonly lines: readonly string[];
  /** After a search that came back empty. */
  readonly noneFoundNote: string;
  /** After a search that could not be run — a different fact, and said so. */
  readonly unavailableNote: string;
}

/** A headed block of authored beats. */
export interface VoiceCoreSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

/** What the file's `provenance` block says about who drafted this and who must sign it off. */
export interface VoiceProvenance {
  readonly status: string;
  readonly awaitingSignOffFrom: string;
  readonly note: string;
}

/**
 * The context-selected layer of the fingerprint: the overlays, the copy that
 * labels a retrieved passage as hers, and the body used when no overlay matches.
 *
 * A prompt ingredient rather than a screen payload. `provenance` is served
 * because these lines were drafted in her register and are a proposal until she
 * has signed them off; `status` is the operator's sign-off beside it, and the
 * two answer different questions.
 */
export interface VoiceOverlays {
  collection: ContentCollectionMeta & {
    status: VoiceContentStatus;
    /** Counts every write to the set's framing. */
    revision: number;
  };
  provenance: VoiceProvenance;
  overlays: readonly VoiceOverlay[];
  exemplars: VoiceExemplarCopy;
  coreOnly: VoiceCoreSection;
}

// ============================================================================
// Stored JSON
// ============================================================================

const nonEmpty = z.string().trim().min(1);
const beats = z.array(nonEmpty).min(1);

export const storedProvenanceSchema = z.strictObject({
  status: nonEmpty,
  awaitingSignOffFrom: nonEmpty,
  note: nonEmpty,
});

export const storedExemplarsSchema = z.strictObject({
  heading: nonEmpty,
  originLabel: nonEmpty,
  lines: beats,
  noneFoundNote: nonEmpty,
  unavailableNote: nonEmpty,
});

export const storedCoreOnlySchema = z.strictObject({ heading: nonEmpty, lines: beats });

// ============================================================================
// Rows
// ============================================================================

export interface VoiceOverlaySetRow {
  id: string;
  title: string;
  version: string;
  locale: string;
  provenance: unknown;
  exemplars: unknown;
  coreOnly: unknown;
  status: string;
  revision: number;
}

export interface VoiceOverlayRow {
  situation: string;
  position: number;
  label: string;
  reviewerNote: string;
  heading: string;
  lines: string[];
  exemplarQuery: string;
  status: string;
  revision: number;
}

const statusSchema = z.enum(['draft', 'signed_off']);

// ============================================================================
// Projection
// ============================================================================

/** One stored overlay as served. @throws when its status is not a known one. */
export function toVoiceOverlay(row: VoiceOverlayRow): VoiceOverlay {
  const status = statusSchema.safeParse(row.status);
  if (!status.success) {
    throw new Error(`Voice overlay "${row.situation}" has an unknown status "${row.status}"`);
  }
  return {
    situation: row.situation,
    label: row.label,
    when: row.reviewerNote,
    heading: row.heading,
    lines: row.lines,
    exemplarQuery: row.exemplarQuery,
    status: status.data,
    revision: row.revision,
  };
}

/**
 * The set as served, its overlays in authored order.
 *
 * @throws when the set's JSON or status fails validation, or two overlays claim
 * the same situation. A duplicate is a selection bug rather than a display one:
 * `selectOverlay` takes the first match, so the second overlay would silently
 * never be used.
 */
export function toVoiceOverlays(
  set: VoiceOverlaySetRow,
  overlayRows: readonly VoiceOverlayRow[]
): VoiceOverlays {
  const provenance = storedProvenanceSchema.safeParse(set.provenance);
  const exemplars = storedExemplarsSchema.safeParse(set.exemplars);
  const coreOnly = storedCoreOnlySchema.safeParse(set.coreOnly);
  const status = statusSchema.safeParse(set.status);
  if (!provenance.success || !exemplars.success || !coreOnly.success || !status.success) {
    throw new Error(`Voice overlay set "${set.id}" failed validation on read`);
  }

  const overlays = [...overlayRows].sort((a, b) => a.position - b.position).map(toVoiceOverlay);
  const seen = new Set<string>();
  for (const overlay of overlays) {
    if (seen.has(overlay.situation)) {
      throw new Error(`Voice overlay set "${set.id}": "${overlay.situation}" is listed twice`);
    }
    seen.add(overlay.situation);
  }

  return {
    collection: {
      id: set.id,
      title: set.title,
      version: set.version,
      locale: set.locale,
      status: status.data,
      revision: set.revision,
    },
    provenance: provenance.data,
    overlays,
    exemplars: exemplars.data,
    coreOnly: coreOnly.data,
  };
}
