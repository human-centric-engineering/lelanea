/**
 * Which capability calls answered — the one fact the account under a reply
 * needs about them (§10 t-66, review rounds 1 and 2).
 *
 * The platform calls tools the model asks for, refuses the ones it should
 * not (`tool_not_advertised` — a name the model invented; `tool_unavailable`
 * — the breaker open), and some throw (`execution_error`). Counting a refused
 * or failed call as something the turn *did* would tell a person a lookup
 * happened when it did not — the wrong kind of honest. So only a call whose
 * result says `success` counts, on every path:
 *
 * - **Live**, the `capability_result(s)` frames carry the result —
 *   {@link capabilityAnswered}.
 * - **Stored**, the terminal assistant row's `provenance.capabilityCalls`
 *   carries one trace per call — `slug`, `success`, a truncated preview —
 *   written always-on by the platform as its audit substrate
 *   (`streaming-handler.ts` → `buildToolCallTrace`). That is what the
 *   transcript read and a replay ask — {@link answeredCapabilities} — rather
 *   than the `tool` rows, whose content is the whole result (every chunk a
 *   search returned) and would be pulled on every pane open for one boolean.
 *
 * Import-light: the browser asks it of the frames.
 */

import { z } from 'zod';

const answeredSchema = z.object({ success: z.literal(true) });

/** A capability result that answered. Anything else — refused, failed, unreadable — did not. */
export function capabilityAnswered(result: unknown): boolean {
  return answeredSchema.safeParse(result).success;
}

/**
 * One call's trace, read as far as this needs: the slug, whether it answered,
 * and the redacted arguments — which a capability that resolves a suggestion
 * from its own `{ id }` reads back (`lib/app/resources/suggest.ts`).
 */
const callSchema = z.object({
  slug: z.string(),
  success: z.boolean(),
  arguments: z.unknown().optional(),
});

/** An answered call: its slug and whatever the trace kept of its arguments. */
export interface AnsweredCall {
  slug: string;
  arguments: unknown;
}
const provenanceSchema = z.object({
  // Each entry on its own, so one trace this cannot read costs that trace, not the list.
  capabilityCalls: z.array(z.unknown()),
});

/**
 * The capabilities that answered, in order, from a terminal assistant row's
 * provenance. Empty where there is none — a turn that called nothing, or a
 * row from before the platform recorded traces.
 */
export function answeredCapabilities(provenance: unknown): string[] {
  return answeredCalls(provenance).map((call) => call.slug);
}

/**
 * The same calls, with their arguments — for a reader that needs to know WHAT
 * a call did, not only that it did (t-77's suggestions). Same rule: only a
 * call that answered, and a trace this cannot read costs that trace alone.
 */
export function answeredCalls(provenance: unknown): AnsweredCall[] {
  const parsed = provenanceSchema.safeParse(provenance);
  if (!parsed.success) return [];
  return parsed.data.capabilityCalls.flatMap((raw) => {
    const call = callSchema.safeParse(raw);
    return call.success && call.data.success
      ? [{ slug: call.data.slug, arguments: call.data.arguments }]
      : [];
  });
}
