/**
 * Module config read side (f-module-config t-2).
 *
 * The GET half of the config API: the descriptors a client renders a generic form from
 * (derived from the registered module's `configSchema`) plus the module's current stored
 * values (`Module.config`). Separated from the write service so the route delegates to one
 * testable fn (the `queries.ts` / `service.ts` split every framework domain uses).
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';
import { getRegisteredModule } from '@/lib/framework/modules/registry';
import {
  describeConfigSchema,
  type FieldDescriptor,
} from '@/lib/framework/modules/config/schema-descriptors';

export interface ModuleConfigForm {
  /** Whether the module's code is still registered (its schema is available). A retired
   *  module has no descriptors — its stored values remain readable as raw JSON. */
  registered: boolean;
  /** Field descriptors for the generic form; `[]` when the module is unregistered. */
  descriptors: FieldDescriptor[];
  /** The module's current stored config values. */
  values: Prisma.JsonValue;
}

/**
 * The config form for a module: the registered schema's descriptors + the live stored
 * values. 404s for an unknown slug (so an empty form is never confused with a missing
 * module). An unregistered module returns `registered: false` with no descriptors.
 */
export async function getModuleConfigForm(slug: string): Promise<ModuleConfigForm> {
  const row = await prisma.module.findFirst({ where: { slug }, select: { config: true } });
  if (!row) throw new NotFoundError(`Module "${slug}" not found`);

  const def = getRegisteredModule(slug);
  return {
    registered: def !== undefined,
    descriptors: def ? describeConfigSchema(def.configSchema) : [],
    values: row.config,
  };
}
