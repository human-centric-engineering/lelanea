/**
 * Generated row ids by authored name (t-113).
 *
 * Since t-113 a content row's `id` is generated and its authored name is its
 * `slug`, unique per org. A child row points at its parent by the generated
 * id, so a write that creates parents and children together reads the
 * parents' ids back first (or reads them, for parents already stored), and
 * looks each one up here by the name the child was authored against.
 */
export function idsBySlug(
  rows: readonly { id: string; slug: string }[],
  what: string
): (slug: string) => string {
  const ids = new Map<string, string>();
  for (const row of rows) {
    // Two rows under one name means the rows came from more than one org, or
    // the caller read wider than it wrote. Keeping either would link a child
    // to a parent chosen by row order.
    if (ids.has(row.slug)) throw new Error(`More than one ${what} is named "${row.slug}"`);
    ids.set(row.slug, row.id);
  }
  return (slug) => {
    const id = ids.get(slug);
    // Throwing keeps a write from pointing a child at nothing, which the
    // foreign key refused when children named their parents directly.
    if (id === undefined) throw new Error(`There is no ${what} "${slug}"`);
    return id;
  };
}
