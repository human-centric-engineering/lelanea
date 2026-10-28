/**
 * The framework tier's part in account erasure (GDPR Art. 17) — reached through the
 * `lib/app/erasure.ts` bridge (Sunrise 0.16.0, §122).
 *
 * A module workflow binding's `inputTemplate` is the operator's static input to a bound
 * workflow, the `AiWorkflowSchedule.inputTemplate` precedent (`framework-modules.prisma`). Core
 * erasure blanks an erased person's address in every schedule template (`eraseFromRunInputs`,
 * t-804) and has no idea a binding template exists, so before this a person typed into one
 * survived their erasure there, and was written into every run the binding started. Two things
 * close that, as they do for a schedule:
 *
 *  1. **Erasure blanks the address in every binding template** — {@link eraseFromBindingTemplates},
 *     a `scrubInTransaction` hook, so it commits or rolls back with the rest of the erasure. Only
 *     the address, and only for a verified account, by core's rule: an unverified address may be a
 *     stranger's (`webhookDeliveriesAddressedTo`), and an id in a free-form template is not a
 *     recipient erasure has a disposition for (`blankAddressInTemplate`). Blanked to `''`, so the
 *     step it feeds fails as one with no recipient.
 *  2. **The dispatcher leaves out anyone erased since it read the binding** — declared here as a
 *     stale writer, because Sunrise's `stale-writers.test.ts` reads the registrations this init
 *     makes and fails on a writer of a scrubbed column that has not said how it knows its copy is
 *     stale. The mechanism is in `lib/framework/modules/workflow-bindings/dispatch.ts`.
 *
 * **And an operator's save of a binding template is versioned** (Hub t-151). It writes the whole
 * template from the request (`updateWorkflowBinding`), so a copy read before an erasure would put
 * the address back; it sends the version it read and is refused once the template moved on, under
 * the row lock this scrub takes — core's protocol for its own configuration (t-899). Daybreak's
 * binding is not one of core's scrubbed columns, so no core guard asks for that; its tests do.
 *
 * Registered from `initAppErasureHooks()`, not from `initFramework()` at boot: core's registry
 * runs that lazily before its first read and re-runs it after a reset, so a boot-time
 * registration would be lost — and the stale-writer test never runs `initFramework()`.
 *
 * @see lib/app/erasure.ts — the bridge · lib/privacy/erasure-hooks.ts — the registry
 * @see lib/privacy/run-recipients.ts — `eraseFromSchedules`, which this mirrors
 */

import type { Prisma } from '@prisma/client';
import { blankAddressInTemplate } from '@/lib/privacy/run-recipients';
import { asciiSearchTerm } from '@/lib/privacy/config-recipients';
import {
  registerErasureCleanupHook,
  registerStaleWriter,
  type ErasureTxContext,
} from '@/lib/privacy/erasure-hooks';
import { normaliseAddress } from '@/lib/orchestration/webhooks/destination';

/** The binding's audit `entityType`, as `lib/framework/modules/workflow-bindings/service.ts` writes it. */
const ENTITY_TYPE = 'module_workflow_binding';

const ERASURE_REASON = 'A person this binding named was erased.';

/** Bindings read per page. A binding is configuration, so there are few; paged all the same. */
export const BINDING_PAGE_SIZE = 200;

/** The hook's `name`: the registry is keyed by it, so a re-run replaces rather than duplicates. */
export const BINDING_TEMPLATES_HOOK = 'framework:module-workflow-binding-templates';

/** The dispatcher, as the stale-writer test names a file. */
export const DISPATCH_FILE = 'lib/framework/modules/workflow-bindings/dispatch.ts';

/**
 * The substring the SQL narrows by: the address, else its domain, else nothing (read every
 * template). Core's private `searchTermFor` (`lib/privacy/run-recipients.ts`), on the same rule.
 */
function searchTermFor(address: string): { term: string | null; scanAll: boolean } {
  const whole = asciiSearchTerm(address);
  if (whole) return { term: whole, scanAll: false };
  const at = address.lastIndexOf('@');
  const domain = at >= 0 && at < address.length - 1 ? address.slice(at + 1) : null;
  const byDomain = domain ? asciiSearchTerm(domain) : null;
  return byDomain ? { term: byDomain, scanAll: false } : { term: null, scanAll: true };
}

/**
 * Blank the erased person's address in every module workflow binding's input template, inside
 * the erasure transaction, each change audited. Returns how many bindings changed.
 *
 * Every org's bindings, deliberately: erasure runs in the system scope at `multi` and a person's
 * address can sit in any org's configuration, as core's schedule pass reads every schedule. Matched
 * on the address the user row stores, normalised as core matches it; nothing for an unverified
 * account.
 */
export async function eraseFromBindingTemplates({
  tx,
  email,
  emailVerified,
}: ErasureTxContext): Promise<number> {
  if (!emailVerified) return 0;
  const address = normaliseAddress(email);
  const { term, scanAll } = searchTermFor(address);
  let changed = 0;
  let after = '';
  for (;;) {
    // Core's schedule pass, on the framework's table (`eraseFromSchedules`): narrowed in SQL to
    // templates whose text holds the address (folded as `normaliseAddress` folds it, so a superset
    // of the matches), and locked as read, so an operator's save waits for the erasure rather than
    // being overwritten by it, or committing an address the read missed.
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        moduleId: string;
        eventType: string;
        workflowId: string;
        orgId: string | null;
        inputTemplate: Prisma.JsonValue;
      }>
    >`SELECT b.id, b."moduleId", b."eventType", b."workflowId", b."orgId", b."inputTemplate"
       FROM framework_module_workflow b
       CROSS JOIN LATERAL (SELECT translate(b."inputTemplate"::text,
         'ABCDEFGHIJKLMNOPQRSTUVWXYZK', 'abcdefghijklmnopqrstuvwxyzk') AS folded) f
       WHERE b.id > ${after}
         AND b."inputTemplate" IS NOT NULL
         AND (${scanAll} OR (${term}::text IS NOT NULL AND strpos(f.folded, ${term}::text) > 0))
       ORDER BY b.id LIMIT ${BINDING_PAGE_SIZE} FOR NO KEY UPDATE OF b`;
    for (const row of rows) {
      const change = blankAddressInTemplate(row.inputTemplate, address);
      if (!change) continue;
      await tx.moduleWorkflowBinding.update({
        where: { id: row.id },
        data: { inputTemplate: change.value ?? {} },
      });
      // Unattributed: a cleanup hook is not told who asked for the erasure. The erasure's own
      // receipt and audit row name them.
      await tx.aiAdminAuditLog.create({
        data: {
          userId: null,
          action: 'module_workflow_binding.recipient_erased',
          entityType: ENTITY_TYPE,
          entityId: row.id,
          entityName: `${row.eventType} → ${row.workflowId}`,
          changes: { inputTemplateValuesCleared: { from: change.removed, to: 0 } },
          metadata: {
            reason: ERASURE_REASON,
            moduleId: row.moduleId,
            workflowId: row.workflowId,
            orgId: row.orgId,
          },
        },
      });
      changed += 1;
    }
    if (rows.length < BINDING_PAGE_SIZE) break;
    after = rows[rows.length - 1].id;
  }
  return changed;
}

/**
 * Register the framework's erasure hook and its stale writer. Synchronous and idempotent: both
 * registries are keyed, so the re-run after a registry reset replaces what it registered.
 */
export function initFrameworkErasureHooks(): void {
  registerErasureCleanupHook({
    name: BINDING_TEMPLATES_HOOK,
    scrubInTransaction: async (ctx) => {
      await eraseFromBindingTemplates(ctx);
    },
  });
  registerStaleWriter({
    file: DISPATCH_FILE,
    model: 'AiWorkflowExecution',
    anchor: 'taken-at',
    how:
      "Creates a run from a binding's template and the workflow's published definition, with " +
      "anyone erased since it read them blanked and taken out, under erasure's locks: the " +
      "scheduler's rule; the member the event names is checked the same way. The rest of the " +
      "event payload is the request's own (intent).",
  });
}
