/**
 * Which seats already carry an escalation policy for which guard (f-safety t-60).
 *
 * Pure, and shared by the seed that creates her policies
 * (`prisma/seeds/app-lelanea/009-misuse-observed.ts`) and the smoke that checks
 * them (`scripts/app/smoke-misuse.ts`). They have to agree on what "covered"
 * means. If they didn't, the seed could skip a seat the smoke then reports
 * missing, or the reverse.
 *
 * A malformed payload covers nothing. Daybreak's escalation contributor skips
 * it the same way, so it would never fire.
 */

import { escalationPayloadSchema } from '@/lib/framework/facilitation/policies/kinds';

export { FACILITATION_SURFACE_CONTEXT_TYPE as SEAT_SURFACE } from '@/lib/framework/facilitation/agents/surface';

/** One seat and one guard, as a set key. */
export function escalationKey(seat: string, guard: string): string {
  return `${seat}:${guard}`;
}

/** The `seat:guard` pairs a set of stored escalation payloads covers. */
export function coveredEscalations(payloads: readonly unknown[]): Set<string> {
  return new Set(
    payloads.flatMap((payload) => {
      const parsed = escalationPayloadSchema.safeParse(payload);
      return parsed.success ? [escalationKey(parsed.data.scope.id, parsed.data.signal.guard)] : [];
    })
  );
}
