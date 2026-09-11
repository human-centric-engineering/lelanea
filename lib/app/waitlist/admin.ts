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
  removedAt: true,
  rejoinRequestedAt: true,
  rejoinRequests: true,
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
  /**
   * When an admin took them off the list; null means they are on it.
   *
   * Returned rather than filtered away, because the admin surface has to be able
   * to SHOW a removal — a soft delete nobody can see is indistinguishable from a
   * hard one (`HB9`), which is the defect this whole surface answers.
   */
  removedAt: string | null;
  /** When a removed address was last submitted through the public form again. */
  rejoinRequestedAt: string | null;
  /** How many times it has been. Zero for everyone who was never removed. */
  rejoinRequests: number;
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
    removedAt: row.removedAt?.toISOString() ?? null,
    rejoinRequestedAt: row.rejoinRequestedAt?.toISOString() ?? null,
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
  // Removed entries are out unless asked for. Top-level beside the `OR`, which
  // Prisma ANDs — so "show removed" widens the population and the search still
  // applies within it, rather than the two filters fighting.
  const onTheList: Prisma.AppWaitlistEntryWhereInput = filter.includeRemoved
    ? {}
    : { removedAt: null };

  if (!filter.q) return onTheList;

  const contains = { contains: filter.q, mode: 'insensitive' } as const;
  return {
    ...onTheList,
    OR: [{ email: contains }, { name: contains }, { heardFrom: contains }, { intent: contains }],
  };
}

/**
 * The sort both reads use: newest first, with `id` breaking ties.
 *
 * Not sortable by the reader: the list is read as "who joined recently, and what
 * did they say", and an orderable column would be a knob nobody asked for on a
 * surface whose whole job is to be read top to bottom.
 *
 * **The tiebreaker is what makes OFFSET paging correct.** `createdAt` defaults to
 * the transaction timestamp, so rows CAN tie — a launch burst, or any seed or
 * import that writes a batch — and on a tie Postgres may order the page-1 and
 * page-2 queries differently, which duplicates one entry and drops another. The
 * export has the same exposure at its `take` boundary, where a tie at the last
 * row decides who is in the file. `id` is not chronological, and does not need to
 * be: it only has to be unique and stable.
 */
const ENTRY_ORDER = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.AppWaitlistEntryOrderByWithRelationInput[];

/** One page of entries, newest first, plus the total the filter matches. */
export async function listWaitlistEntries(query: {
  q?: string;
  includeRemoved?: boolean;
  page: number;
  limit: number;
}): Promise<{ entries: WaitlistAdminEntry[]; total: number }> {
  const where = buildWaitlistSearchWhere({
    q: query.q,
    includeRemoved: query.includeRemoved ?? false,
  });

  const [rows, total] = await Promise.all([
    prisma.appWaitlistEntry.findMany({
      where,
      orderBy: ENTRY_ORDER,
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
      orderBy: ENTRY_ORDER,
      take: WAITLIST_EXPORT_MAX_ROWS,
      select: ENTRY_SELECT,
    }),
    prisma.appWaitlistEntry.count({ where }),
  ]);

  return { entries: rows.map(toAdminEntry), total };
}

/**
 * Take someone off the list, or put them back.
 *
 * Returns the updated entry, or `null` when no row has that id — which the route
 * turns into a 404 rather than reporting a success that changed nothing.
 *
 * ## What this is NOT
 *
 * It is not a deletion and it is not an erasure. The row keeps the person's
 * email, their name and what they said they wanted; all this moves is
 * `removedAt`, which decides whether the list and the export include them. The
 * Art. 15 export still discloses a removed entry and the Art. 17 hook still
 * deletes it outright — see `lib/app/waitlist/service.ts`, where both are
 * deliberately blind to this column.
 *
 * Anyone reaching for this function to satisfy a "please delete my data" request
 * is in the wrong place: that is `eraseUser()`, and for someone with no account
 * there is no self-service path at all yet (see `.context/app/waitlist.md`).
 *
 * ## Idempotent, and deliberately not a toggle
 *
 * It takes the state to reach rather than flipping what it finds. A toggle would
 * mean two admins acting on the same row in the same minute could leave it in
 * either state depending on arrival order, and a double-clicked button could
 * undo itself. `removed: true` twice is the same as once.
 *
 * Restoring does NOT clear `rejoinRequests`. Someone who asked to come back and
 * was then put back on the list is exactly the person whose request should stay
 * legible afterwards — it is the record of why they are here again.
 */
export async function setWaitlistEntryRemoved(
  id: string,
  removed: boolean
): Promise<WaitlistAdminEntry | null> {
  // `updateMany` + a read rather than `update`, so a missing id is a null rather
  // than a thrown P2025 the route would have to translate back.
  const { count } = await prisma.appWaitlistEntry.updateMany({
    where: { id },
    data: { removedAt: removed ? new Date() : null },
  });

  if (count === 0) return null;

  const row = await prisma.appWaitlistEntry.findUnique({ where: { id }, select: ENTRY_SELECT });
  return row ? toAdminEntry(row) : null;
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
  // APPENDED, never inserted. Anything already consuming a file from t-8 reads
  // by column position as often as by name, so a new column in the middle
  // silently shifts every field after it. The end is the only safe place.
  'removed_at',
  'rejoin_requested_at',
  'rejoin_requests',
] as const;

/**
 * One cell: the platform's escaper, plus the case its predicate misses.
 *
 * **`csvEscape` on every cell, including the ones that look safe.** `name`,
 * `heardFrom` and `intent` are free text a stranger typed into a public form, so
 * they are the CSV-injection surface the platform helper exists for: a value
 * starting `=`, `+`, `-`, `@`, tab or CR is a formula to Excel, Calc and Sheets
 * alike, and the file opens on the machine of the one person who reads every one
 * of these answers. `email` gets it too — `@` is the trigger character and an
 * address beginning with one is syntactically possible.
 *
 * ## Why a wrapper, and not `csvEscape` alone
 *
 * `csvEscape`'s quoting branch fires on `,`, `"` and `\n` — **not on a lone
 * `\r`**. Its formula-trigger prefix only inspects the FIRST character of a
 * cell. Put those two together with a file whose records are joined by CRLF and
 * a bare `\r` in the middle of a cell is an escape sequence:
 *
 *     intent = 'Looking forward to it!\r=cmd|\' /C calc\'!A0'
 *
 * Unquoted, the `\r` reads as a record separator to every major spreadsheet, so
 * the record ends early and the next one begins with a cell the submitter
 * controls **from its first character** — which is precisely the position the
 * prefix exists to deny them. `.trim()` in `waitlistSchema` strips only the ends
 * of the string, so an interior `\r` reaches the table intact, and the admin
 * table renders it as ordinary whitespace. Nothing between the public form and
 * the spreadsheet shows it.
 *
 * Quoting closes it: inside quotes a CR is data (RFC 4180 §2.6), the record no
 * longer splits, and the `=` is then mid-cell, which no spreadsheet evaluates.
 * The visitor's own line breaks survive as they typed them, which matters on a
 * field a human reads.
 *
 * The defect is in `lib/api/csv.ts`, whose blob is identical in Sunrise,
 * Daybreak and here — so Sunrise owns it and it is filed there rather than
 * patched in place (a Sunrise-owned edit is a divergence row; this wrapper is a
 * file of ours):
 * [`sunrise#768`](https://github.com/human-centric-engineering/sunrise/issues/768).
 * `app/api/v1/admin/orchestration/conversations/export/route.ts` has the same
 * exposure through message content. Drop this wrapper when the fix merges
 * through.
 */
function csvCell(value: string): string {
  const escaped = csvEscape(value);
  if (!value.includes('\r')) return escaped;
  // Already quoted (the value also held a comma, a quote or a newline) — then
  // `csvEscape` has handled the quoting and the CR is inside it.
  if (escaped.startsWith('"') && escaped.endsWith('"')) return escaped;
  // Otherwise quote it ourselves. An unquoted return from `csvEscape` cannot
  // contain a `"` — that is one of the characters that would have quoted it —
  // so the doubling below is belt-and-braces rather than load-bearing.
  return `"${escaped.replace(/"/g, '""')}"`;
}

/**
 * Serialise entries as RFC 4180 CSV.
 *
 * Every cell goes through `csvCell` — see there for the escaping, which is the
 * part of this file that matters.
 *
 * **A leading BOM.** Excel on Windows reads a CSV without one as the system
 * codepage, which turns "Lelañea" into mojibake. The product's own name has a ñ
 * in it and so will many of the names on this list; `charset=utf-8` on the
 * response does not reach a file opened from disk, and the BOM does.
 *
 * Rows are joined with CRLF per RFC 4180.
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
        entry.removedAt ?? '',
        entry.rejoinRequestedAt ?? '',
        String(entry.rejoinRequests),
      ]
        .map(csvCell)
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
