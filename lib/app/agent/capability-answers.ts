/**
 * Whether a capability call answered — the one fact the account under a reply
 * needs about it (§10 t-66, review round 1).
 *
 * The platform writes a `tool` row, with `capabilitySlug`, for every call the
 * model made: the ones that ran, and the ones it refused (`tool_not_advertised`
 * — a name the model invented; `tool_unavailable` — the breaker open) or that
 * threw (`execution_error`). Counting those as things the turn *did* would tell
 * a person a lookup happened when it did not — the wrong kind of honest. Every
 * result carries `success`, live on the `capability_result(s)` frames and
 * stored as the row's content and `metadata.result`, so both paths ask the
 * same question here.
 *
 * Import-light: the browser asks it of the frames.
 */

import { z } from 'zod';

const answeredSchema = z.object({ success: z.literal(true) });

/** A capability result that answered. Anything else — refused, failed, unreadable — did not. */
export function capabilityAnswered(result: unknown): boolean {
  return answeredSchema.safeParse(result).success;
}

const rowMetadataSchema = z.object({ result: z.unknown() });

/**
 * The same, for a stored `tool` row: `metadata.result` where the platform kept
 * it, else the content, which is the result serialised.
 */
export function toolRowAnswered(row: { content: string; metadata: unknown }): boolean {
  const metadata = rowMetadataSchema.safeParse(row.metadata);
  if (metadata.success && metadata.data.result !== undefined) {
    return capabilityAnswered(metadata.data.result);
  }
  try {
    return capabilityAnswered(JSON.parse(row.content));
  } catch {
    return false;
  }
}
