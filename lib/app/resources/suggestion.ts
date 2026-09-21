/**
 * A resource suggested in conversation — the shape the client, the account and
 * the transcript read (f-resources t-77).
 *
 * Import-light on purpose: the browser reads a suggestion off a
 * `capability_result` frame, so this module carries the schema and nothing
 * that would pull the content loader into the client bundle. The capability
 * that produces one, and the server-side resolver that rebuilds one from a
 * stored trace, are in `suggest.ts`.
 *
 * **Everything here is the library's, never the model's.** A suggestion is
 * looked up by id server-side; the title and what it is for are the file's
 * words. The client renders what is here as React children and nothing the
 * model wrote reaches the page as if it were Lelañea Fulton's.
 */

import { z } from 'zod';

/** The capability's slug — the tool name the model calls. */
export const SUGGEST_RESOURCE_SLUG = 'suggest_resource';

export const resourceSuggestionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['film', 'reading']),
  title: z.string().min(1),
  /** What it is for, in her words — the file's `subtitle`. */
  subtitle: z.string().min(1),
  /** `6:12` for a film, `8 min` for a reading — as the file writes it. */
  length: z.string().min(1),
});

export type ResourceSuggestion = z.infer<typeof resourceSuggestionSchema>;

/** A capability result whose `data` is a suggestion — what the frame carries live. */
const suggestionResultSchema = z.object({
  success: z.literal(true),
  data: resourceSuggestionSchema,
});

/**
 * The suggestion a `suggest_resource` result carries, or `null` for a result
 * that refused, failed, or is not one — the same rule as
 * `capabilityAnswered`: only a call that answered is something the turn did.
 */
export function suggestionFromResult(result: unknown): ResourceSuggestion | null {
  const parsed = suggestionResultSchema.safeParse(result);
  return parsed.success ? parsed.data.data : null;
}

/**
 * One offer per resource. A turn that answers the tool twice for the same id
 * — a retry after a refusal, a duplicate in a parallel batch — offered one
 * thing; two chips and “X” and “X” in the account would say otherwise
 * (`/code-review`). Order is first-seen.
 */
export function uniqueSuggestions(
  suggestions: readonly ResourceSuggestion[]
): ResourceSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}
