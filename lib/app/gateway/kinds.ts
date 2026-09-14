/**
 * The acknowledgement kinds — the one piece of the gateway a client may import.
 *
 * Split from `acknowledgements.ts` so the validation schema, and t-16's gate
 * form after it, can name the kinds without pulling the ledger module — and
 * through it `@/lib/db/client` (a `pg.Pool`), the logger and the content loader
 * — into a browser bundle. Every other `lib/validations/*` file is
 * dependency-free for the same reason. Nothing here touches I/O.
 *
 * @see lib/app/gateway/acknowledgements.ts — what the kinds mean at runtime
 */

import type { AppAcknowledgementKind } from '@prisma/client';

/**
 * Every kind, in the order the gate presents them: read the disclaimer, read
 * the terms, confirm your age. The tuple is the validation schema's source of
 * truth as well, so the API cannot accept a kind the enum does not have.
 */
export const ACKNOWLEDGEMENT_KINDS = [
  'disclaimer',
  'terms',
  'age_18',
] as const satisfies readonly AppAcknowledgementKind[];

/**
 * The Prisma enum, re-exported under the gateway's name so nothing outside
 * the gateway imports `@prisma/client` for it. `getRequiredVersions()` is typed
 * as a `Record` over it, so an enum value the tuple above forgets is a compile
 * error there rather than a kind the gate silently never asks for.
 */
export type AcknowledgementKind = AppAcknowledgementKind;

/**
 * One kind's standing as the API answers it and the gate page receives it —
 * `GateStatus` (`acknowledgements.ts`) with its `Date` already a string. The
 * client form holds this shape, so the type lives here, beside the kinds.
 */
export interface KindStatusJson {
  kind: AcknowledgementKind;
  requiredVersion: string;
  documentId: string | null;
  satisfied: boolean;
  /** ISO 8601, or `null` while the kind is outstanding. */
  acknowledgedAt: string | null;
}

/** `GateStatus`, serialised. What `GET /api/v1/app/acknowledgements` returns. */
export interface GateStatusJson {
  complete: boolean;
  kinds: KindStatusJson[];
  outstanding: AcknowledgementKind[];
}
