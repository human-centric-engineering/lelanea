/**
 * Release-2 authored content: the Values module and everything it references.
 *
 * Validated on the same terms as the rest — the CI schema test parses all six
 * files, and drift in these three fails just as loudly — but **not served**.
 * Module 01's authored interior, the exploration framework, and the sixteen
 * written value explorations are release 2; the API surface in
 * `app/api/v1/app/content` deliberately exposes only the public documents and
 * the journey structure.
 *
 * Kept in its own module rather than in `lib/app/content/index.ts` for a
 * mundane reason with real consequences: `content/value_explorations.json` is
 * 271KB, and a static import inside the shared entry point would pull it into
 * every bundle that only wanted a mission statement.
 *
 * @see lib/app/content/index.ts — the content that is served
 */

import rawValuesModule from '@/content/values_module.json';
import rawValuesReferenceFramework from '@/content/values_reference_framework.json';
import rawValueExplorations from '@/content/value_explorations.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';
import {
  valuesModuleFileSchema,
  valuesReferenceFrameworkFileSchema,
  valueExplorationsFileSchema,
  type ValuesModuleFile,
  type ValuesReferenceFrameworkFile,
  type ValueExplorationsFile,
} from '@/lib/app/content/schemas';

let valuesModuleCache: ValuesModuleFile | null = null;
let valuesReferenceFrameworkCache: ValuesReferenceFrameworkFile | null = null;
let valueExplorationsCache: ValueExplorationsFile | null = null;

/** The ten-step Values module: its lessons, the value library, the reflections. */
export function getValuesModule(): ValuesModuleFile {
  valuesModuleCache ??= deepFreezeParsed(valuesModuleFileSchema.parse(rawValuesModule));
  return valuesModuleCache;
}

/** The framework a value exploration is written against — lenses, structure, tests. */
export function getValuesReferenceFramework(): ValuesReferenceFrameworkFile {
  valuesReferenceFrameworkCache ??= deepFreezeParsed(
    valuesReferenceFrameworkFileSchema.parse(rawValuesReferenceFramework)
  );
  return valuesReferenceFrameworkCache;
}

/** The sixteen written value explorations. */
export function getValueExplorations(): ValueExplorationsFile {
  valueExplorationsCache ??= deepFreezeParsed(
    valueExplorationsFileSchema.parse(rawValueExplorations)
  );
  return valueExplorationsCache;
}
