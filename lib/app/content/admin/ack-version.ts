/**
 * The next acknowledgement version (f-content-seeds t-91). Its own module
 * because the editor's client components say, before a save, which version it
 * will mint, and `shared.ts` reaches the database.
 */

/**
 * The next acknowledgement version after `current`: `1.1` → `1.2`, `2` → `2.1`.
 *
 * A label, not arithmetic: the gate compares versions as strings (a row
 * satisfies a kind only for exactly the required string), so all this has to do
 * is produce one nobody has acknowledged yet. Minted labels only go up, so one
 * repeats only if an admin has typed an older label back by hand, and the
 * editor's version field says not to.
 */
export function nextAcknowledgementVersion(current: string): string {
  const match = /^(.*?)(\d+)$/.exec(current);
  const [, head, tail] = match ?? [];
  if (head !== undefined && tail !== undefined && head.endsWith('.')) {
    return `${head}${Number(tail) + 1}`;
  }
  return `${current}.1`;
}
