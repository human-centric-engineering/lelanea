/**
 * Reading the waitlist back: the admin list query, and the CSV the export serves.
 *
 * §03 t-7 shipped the write and nothing that reads it. A row nobody can see is
 * indistinguishable from a row that was never written (`HB9`) — including to
 * whoever wrote it, and including in review — so this module and the two routes
 * over it are the other half of that task, not a convenience on top of it.
 *
 * Everything here is deliberately one layer below the routes: the `where`
 * builder, the row projection and the CSV serialiser are pure (or close to it)
 * so the CSV's shape can be asserted without constructing a request, and so the
 * list route and the export route cannot drift into filtering differently.
 *
 * **This is personal data about people with no account.** Two rules follow, and
 * both are enforced in the routes rather than here because that is where a
 * caller exists: the surface is admin-only, and nothing in it is logged. An
 * address in an application log is a copy of someone's personal data outside the
 * table the Art. 15 export and the Art. 17 erasure know about — the same reason
 * `app/api/v1/app/waitlist/route.ts` keeps the email out of its own log line.
 *
 * @see .context/app/waitlist.md
 * @see lib/app/waitlist/service.ts — the write, and the two GDPR duties
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { csvEscape } from '@/lib/api/csv';
import type { WaitlistAdminFilter } from '@/lib/validations/app-waitlist';

/**
 * Upper bound on rows one export file holds.
 *
 * A cap introduces a state the system did not have before — a file that is
 * silently short — so it has to ship with the remedy (`HB10`). Two things carry
 * it: the filename says `first-<N>` when it truncates, which is the one signal
 * that survives a plain browser download, and the page shows the real total
 * beside the button, so "4,000 entries" next to a file named `…-first-2000.csv`
 * reads as the cap rather than as the whole list. The remedy itself is the search
 * filter: narrow it and export again.
 *
 * The number is far above any realistic pre-launch list and exists to bound
 * memory — `intent` is up to 2000 characters per row, so an uncapped export of a
 * list that had gone viral would build a string measured in tens of megabytes.
 */
export const WAITLIST_EXPORT_MAX_ROWS = 2000;

/** The columns both reads select, and in the order the CSV writes them. */
const ENTRY_SELECT = {
  id: true,
  email: true,
  name: true,
  heardFrom: true,
  intent: true,
  source: true,
  locale: true,
  consentedAt: true,
  userId: true,
  createdAt: true,
} satisfies Prisma.AppWaitlistEntrySelect;

/**
 * One entry as the admin surface sees it — dates already ISO strings, because
 * this crosses a JSON boundary on the way to the table component and a `Date`
 * does not survive that intact.
 */
export interface WaitlistAdminEntry {
  id: string;
  email: string;
  name: string | null;
  heardFrom: string | null;
  intent: string | null;
  source: string;
  locale: string;
  consentedAt: string;
  /**
   * Null for everyone on the list today — nothing writes it yet (see
   * `.context/app/waitlist.md`). Returned rather than flattened to a boolean so
   * the column tells the truth the moment the profile-seeding link lands.
   */
  userId: string | null;
  createdAt: string;
}

/**
 * The row shape Prisma hands back, derived from `ENTRY_SELECT` rather than
 * hand-written — a second literal would let the two drift, and the drift would
 * type-check.
 */
type StoredEntry = Prisma.AppWaitlistEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

function toAdminEntry(row: StoredEntry): WaitlistAdminEntry {
  return {
    ...row,
    consentedAt: row.consentedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The search clause, shared by the list and the export so they cannot diverge.
 *
 * `mode: 'insensitive'` is correct HERE and wrong in `service.ts`'s GDPR matcher,
 * for reasons re-derived rather than copied — see
 * `waitlistAdminFilterSchema`'s note. In short: an admin may already read every
 * row, and a substring search is a wildcard match by construction, so a `%` in
 * the term widening it surprises nobody and discloses nothing.
 *
 * `intent` is searched as well as the two short fields. It is the column the
 * list exists for, so "who mentioned sleep" is the question this box is most
 * likely to be asked.
 */
export function buildWaitlistSearchWhere(
  filter: WaitlistAdminFilter
): Prisma.AppWaitlistEntryWhereInput {
  if (!filter.q) return {};
  const contains = { contains: filter.q, mode: 'insensitive' } as const;
  return {
    OR: [{ email: contains }, { name: contains }, { heardFrom: contains }, { intent: contains }],
  };
}

/**
 * One page of entries, newest first, plus the total the filter matches.
 *
 * Newest first and not sortable: the list is read as "who joined recently, and
 * what did they say", and an orderable column would be a knob nobody asked for
 * on a surface whose whole job is to be read top to bottom.
 */
export async function listWaitlistEntries(query: {
  q?: string;
  page: number;
  limit: number;
}): Promise<{ entries: WaitlistAdminEntry[]; total: number }> {
  const where = buildWaitlistSearchWhere({ q: query.q });

  const [rows, total] = await Promise.all([
    prisma.appWaitlistEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ENTRY_SELECT,
    }),
    prisma.appWaitlistEntry.count({ where }),
  ]);

  return { entries: rows.map(toAdminEntry), total };
}

/**
 * Every matching entry up to the cap, plus the true total so the caller can tell
 * whether what it got is the whole list.
 *
 * The count is a second query rather than `rows.length`, because those differ by
 * exactly the fact worth reporting: a `take` that filled tells you nothing about
 * what it left behind.
 */
export async function collectWaitlistEntriesForExport(filter: WaitlistAdminFilter): Promise<{
  entries: WaitlistAdminEntry[];
  total: number;
}> {
  const where = buildWaitlistSearchWhere(filter);

  const [rows, total] = await Promise.all([
    prisma.appWaitlistEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: WAITLIST_EXPORT_MAX_ROWS,
      select: ENTRY_SELECT,
    }),
    prisma.appWaitlistEntry.count({ where }),
  ]);

  return { entries: rows.map(toAdminEntry), total };
}

/** The CSV header, which is also the column contract the export test pins. */
export const WAITLIST_CSV_COLUMNS = [
  'id',
  'email',
  'name',
  'heard_from',
  'intent',
  'source',
  'locale',
  'consented_at',
  'user_id',
  'created_at',
] as const;

/**
 * Serialise entries as RFC 4180 CSV.
 *
 * Two details that are not decoration:
 *
 * - **`csvEscape` on every cell, including the ones that look safe.** `name`,
 *   `heardFrom` and `intent` are free text a stranger typed into a public form,
 *   so they are the CSV-injection surface the platform helper exists for: a
 *   value starting `=`, `+`, `-`, `@`, tab or CR is a formula to Excel, Calc and
 *   Sheets alike, and the file opens on the machine of the one person who reads
 *   every one of these answers. `email` gets it too — `@` is the trigger
 *   character and an address beginning with one is syntactically possible.
 * - **A leading BOM.** Excel on Windows reads a CSV without one as the system
 *   codepage, which turns "Lelañea" into mojibake. The product's own name has a
 *   ñ in it and so will many of the names on this list; `charset=utf-8` on the
 *   response does not reach a file opened from disk, and the BOM does.
 *
 * Rows are joined with CRLF per RFC 4180. A cell's own newlines stay as the
 * visitor typed them, quoted by `csvEscape`.
 */
export function waitlistEntriesToCsv(entries: WaitlistAdminEntry[]): string {
  const lines = [WAITLIST_CSV_COLUMNS.join(',')];

  for (const entry of entries) {
    lines.push(
      [
        entry.id,
        entry.email,
        entry.name ?? '',
        entry.heardFrom ?? '',
        entry.intent ?? '',
        entry.source,
        entry.locale,
        entry.consentedAt,
        entry.userId ?? '',
        entry.createdAt,
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  // '\ufeff' spelled out rather than pasted: a literal BOM is invisible in every
  // editor and diff, so the one character this function cannot afford to lose
  // would be deleted by accident and nothing would say so.
  return `\ufeff${lines.join('\r\n')}`;
}

/**
 * What the downloaded file is called — and the only truncation signal a plain
 * browser download carries, which is why the row count is in the name.
 */
export function waitlistExportFilename(now: Date, truncated: boolean): string {
  const day = now.toISOString().slice(0, 10);
  const scope = truncated ? `-first-${WAITLIST_EXPORT_MAX_ROWS}` : '';
  return `lelanea-waitlist-${day}${scope}.csv`;
}
