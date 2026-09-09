/**
 * Freeze a parsed content file, and everything reachable from it.
 *
 * Its own module for one reason: `index.ts` and `values.ts` both need it and
 * must **not** import each other. `values.ts` exists to keep 271KB of value
 * explorations out of the bundles that only want a document, and routing this
 * helper through `index.ts` would drag the three served JSON files into
 * `values.ts`'s graph — undoing exactly the split it exists for. (Contrast the
 * cache-directive constant that briefly lived in its own file: every consumer of
 * that already imported the loader, so the separation bought nothing.)
 *
 * @see lib/app/content/index.ts — why the parse is frozen at all
 */

/**
 * Recursively `Object.freeze` a value, returning it for chaining.
 *
 * Cycle-safe via the `isFrozen` short-circuit, though parsed JSON has none.
 */
export function deepFreezeParsed<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    // The cast is to index a value the compiler already knows is a non-null
    // object; TypeScript has no index signature for it otherwise. Not the
    // unsafe-assertion-on-external-data pattern the anti-pattern scan hunts —
    // everything reaching here has already been through a Zod schema.
    deepFreezeParsed((value as Record<string, unknown>)[key]);
  }
  return value;
}
