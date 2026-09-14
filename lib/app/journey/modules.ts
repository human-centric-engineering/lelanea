/**
 * The leaf's read surface over the framework's module registry and rows.
 *
 * The app shell — pages under `app/(lelanea)/`, components under
 * `components/app/` — never imports `@/lib/framework`. The boundary check
 * (`npm run framework:boundary`) exempts `lib/app/**` and the reserved leaf
 * route namespaces, but the decision this feature holds is stricter than the
 * lint: the framework reaches the shell only through `lib/app/journey/*` and
 * the leaf's own routes, so the day Daybreak reshapes a module type there is
 * one place to follow it. This file is that place for modules; the published
 * map gets its own beside it.
 *
 * Two reads, because the framework keeps two halves (see
 * `lib/framework/modules/definition.ts`): what the **code** registered, and
 * what the **operator** controls on the row. Both are projected to plain leaf
 * shapes — no `ModuleDefinition`, no Prisma `Module` — so the shell's types
 * stay ours.
 *
 * @see lib/app/modules/definitions.ts — what gets registered
 */

import { getRegisteredModules, getRegisteredModule } from '@/lib/framework/modules/registry';
import { listModules } from '@/lib/framework/modules/queries';

/** A module as the running code registered it. */
export interface RegisteredModuleView {
  slug: string;
  name: string;
  description: string;
}

/**
 * A module's operator-controlled row. `status` is the framework's free-form
 * lifecycle vocabulary (`draft | active | scheduled | retired`); this phase
 * reads it for display only — every module is open regardless, because
 * per-user gating is the facilitation engine's job and Lelañea has not
 * switched it on.
 */
export interface ModuleRowView {
  slug: string;
  name: string;
  status: string;
  /** `false` = the code no longer registers this slug; the row is kept for audit. */
  isRegistered: boolean;
}

function toRegisteredView(definition: {
  slug: string;
  name: string;
  description: string;
}): RegisteredModuleView {
  return { slug: definition.slug, name: definition.name, description: definition.description };
}

/**
 * Every module the running code registered, in registration order — for the
 * journey that is the numbered order, because `initLeafApp()` registers them
 * so. Synchronous and DB-free: this is the in-memory registry.
 */
export function listRegisteredModules(): RegisteredModuleView[] {
  return getRegisteredModules().map(toRegisteredView);
}

/**
 * One registered module by slug, or `null` when the code registers no such
 * slug. `null` rather than a throw keeps the 404 decision with the caller.
 */
export function getRegisteredModuleBySlug(slug: string): RegisteredModuleView | null {
  const definition = getRegisteredModule(slug);
  return definition ? toRegisteredView(definition) : null;
}

/**
 * Every `framework_module` row, ordered by slug — including rows whose code
 * has since been removed, flagged `isRegistered: false`, so a caller can show
 * the whole picture or filter. Errors propagate; an empty list means an empty
 * table, never a swallowed failure.
 */
export async function listModuleRows(): Promise<ModuleRowView[]> {
  const rows = await listModules();
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    status: row.status,
    isRegistered: row.isRegistered,
  }));
}
