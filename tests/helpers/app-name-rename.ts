/**
 * `pg_temp.app_name_rename` from `20261119100000_app_name_lelanea`, in
 * TypeScript, with its `keep` phrases read off the migration itself
 * (f-content-polish t-193).
 *
 * The data migrations before it are frozen and still say "Lelañea" for the
 * app. Their pins compare them with today's seed through this: the frozen
 * rows, renamed exactly as the follow-up migration renames them, must equal
 * what the seed builds now. That is the follow-up migration's whole claim.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const APP_NAME_MIGRATION = 'prisma/migrations/20261119100000_app_name_lelanea/migration.sql';

/** The migration's `keep` array, with its `''` escapes undone, in its order. */
export function appNameKeepPhrases(): string[] {
  const sql = readFileSync(path.join(process.cwd(), APP_NAME_MIGRATION), 'utf8');
  const block = /keep text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql);
  if (!block?.[1]) throw new Error(`No keep array in ${APP_NAME_MIGRATION}`);
  return [...block[1].matchAll(/'((?:[^']|'')*)'/g)].map((match) =>
    (match[1] ?? '').replace(/''/g, "'")
  );
}

/** The app's name renamed, her phrases kept, step for step as the SQL does it. */
export function renameAppName(
  text: string,
  keep: readonly string[] = appNameKeepPhrases()
): string {
  if (!text.includes('Lelañea')) return text;
  let out = text;
  keep.forEach((phrase, i) => {
    out = out.split(phrase).join(`\u0001${i + 1}\u0002`);
  });
  out = out.split('Lelañea').join('Lelanea');
  for (let i = keep.length; i >= 1; i--) {
    out = out.split(`\u0001${i}\u0002`).join(keep[i - 1] ?? '');
  }
  return out;
}
