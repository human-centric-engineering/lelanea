/**
 * The merge-field conventions her documents use.
 *
 * Kept apart from the loader and the seed module so the renderer
 * (`components/app/content/authored-document.tsx`) and the seed can share it
 * without either one pulling in the other's imports. `@/lib/app/content`
 * re-exports both names.
 */

/**
 * Matches the two merge-field conventions the authored copy uses: `{{snake}}`
 * for a value the app substitutes (`{{first_name}}`), and `[Title Case]` for a
 * value a human still has to fill in before launch (`[Support Email]`).
 *
 * Kept as a source of truth for both the renderer and
 * `tests/unit/lib/app/content/placeholders.test.ts`, which scans the real prose
 * with it and fails if a bracket appears that the documents do not declare.
 *
 * It carries the `g` flag, so it is stateful: reach for `findPlaceholders` or
 * `String.prototype.match`, both of which reset `lastIndex`. A bare
 * `PLACEHOLDER_PATTERN.test(...)` in a loop alternates true and false.
 */
export const PLACEHOLDER_PATTERN = /\{\{[a-z0-9_]+\}\}|\[[^\]\n]+\]/g;

/** Every placeholder occurring in a string, in order, without duplicates. */
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_PATTERN) ?? [])];
}
