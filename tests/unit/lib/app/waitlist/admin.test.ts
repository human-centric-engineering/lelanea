/**
 * The admin read: the search clause, the two queries, and the CSV's shape.
 *
 * The CSV cases are the load-bearing half. A spreadsheet file built from free
 * text a stranger typed into a public form is the one artefact in this feature
 * that executes on someone's machine, and the person who opens every one of
 * these is Lelañea herself — so "the cell is escaped" is asserted on the output
 * string rather than trusted to the helper being imported.
 *
 * The query cases assert the ARGUMENTS that reach Prisma, not the rows that come
 * back: a row asserted out of a mock only proves the mock returned it.
 *
 * @see lib/app/waitlist/admin.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  prisma: { appWaitlistEntry: { findMany, count } },
}));

import {
  buildWaitlistSearchWhere,
  collectWaitlistEntriesForExport,
  listWaitlistEntries,
  waitlistEntriesToCsv,
  waitlistExportFilename,
  WAITLIST_CSV_COLUMNS,
  WAITLIST_EXPORT_MAX_ROWS,
  type WaitlistAdminEntry,
} from '@/lib/app/waitlist/admin';

/** A stored row, as Prisma hands it back — dates still `Date`s. */
function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    email: 'ada@example.com',
    name: 'Ada',
    heardFrom: 'a friend',
    intent: 'to slow down',
    source: 'form',
    locale: 'en-US',
    consentedAt: new Date('2026-09-01T10:00:00.000Z'),
    userId: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  };
}

function entry(overrides: Partial<WaitlistAdminEntry> = {}): WaitlistAdminEntry {
  return {
    id: 'entry-1',
    email: 'ada@example.com',
    name: 'Ada',
    heardFrom: 'a friend',
    intent: 'to slow down',
    source: 'form',
    locale: 'en-US',
    consentedAt: '2026-09-01T10:00:00.000Z',
    userId: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * The CSV without its BOM, split into the records a SPREADSHEET would see.
 *
 * Quote-aware on purpose, and that is the whole point of the helper. The first
 * version split on `\r\n`, which cannot tell a record separator from a line break
 * a visitor typed inside a quoted answer — so it reported a correctly quoted cell
 * as a split record, and it would equally have reported an ESCAPE as one record
 * when the escaping was what failed. A naive splitter cannot distinguish the bug
 * from the fix.
 *
 * So this splits on CRLF, a lone CR or a lone LF when outside quotes, and on
 * nothing at all inside them — which is how Excel, Calc and Sheets read a file,
 * and therefore the only parse whose record count means anything here.
 *
 * '\ufeff' spelled out rather than pasted, for the same reason the module spells
 * it out: a literal BOM is invisible in an editor and in a diff.
 */
function csvRows(csv: string): string[] {
  const body = csv.replace(/^\ufeff/, '');
  const records: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (char === '"') {
      // A doubled quote is an escaped quote, not a state change.
      if (inQuotes && body[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && (char === '\r' || char === '\n')) {
      if (char === '\r' && body[i + 1] === '\n') i += 1;
      records.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  records.push(current);
  return records;
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([storedRow()]);
  count.mockResolvedValue(1);
});

describe('buildWaitlistSearchWhere', () => {
  it('matches nothing in particular when there is no search term', () => {
    // An empty object, NOT `{ OR: [] }` — Prisma treats an empty `OR` as
    // "match nothing", so the unfiltered list would come back empty.
    expect(buildWaitlistSearchWhere({ q: undefined })).toEqual({});
  });

  it('searches the answers as well as the address', () => {
    const where = buildWaitlistSearchWhere({ q: 'sleep' });

    const fields = (where.OR as Record<string, unknown>[]).flatMap((clause) => Object.keys(clause));
    // `intent` is the column the list exists for, so "who mentioned sleep" has
    // to be answerable — it was the field most likely to be left out.
    expect(fields).toEqual(['email', 'name', 'heardFrom', 'intent']);
  });
});

describe('listWaitlistEntries', () => {
  it('pages from the top, newest first', async () => {
    await listWaitlistEntries({ page: 3, limit: 25 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25, orderBy: { createdAt: 'desc' } })
    );
  });

  it('counts with the same filter it lists with', async () => {
    await listWaitlistEntries({ q: 'ada', page: 1, limit: 25 });

    const listWhere = findMany.mock.calls[0]?.[0]?.where;
    const countWhere = count.mock.calls[0]?.[0]?.where;
    // Two queries, one filter. Count them differently and the pager offers pages
    // that come back empty, or hides rows that exist.
    expect(countWhere).toEqual(listWhere);
  });

  it('hands dates over as ISO strings, because the table is a client component', async () => {
    const { entries, total } = await listWaitlistEntries({ page: 1, limit: 25 });

    expect(total).toBe(1);
    expect(entries[0]?.createdAt).toBe('2026-09-01T10:00:00.000Z');
    expect(entries[0]?.consentedAt).toBe('2026-09-01T10:00:00.000Z');
  });
});

describe('collectWaitlistEntriesForExport', () => {
  it('caps the rows it reads and still reports the real total', async () => {
    findMany.mockResolvedValue([storedRow()]);
    count.mockResolvedValue(9_999);

    const { entries, total } = await collectWaitlistEntriesForExport({ q: undefined });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: WAITLIST_EXPORT_MAX_ROWS })
    );
    expect(entries).toHaveLength(1);
    // The separate count is the whole point: a `take` that filled says nothing
    // about what it left behind, and the caller needs that to name the file
    // honestly.
    expect(total).toBe(9_999);
  });
});

describe('waitlistEntriesToCsv', () => {
  it('writes the agreed header, in the agreed order', () => {
    const [header] = csvRows(waitlistEntriesToCsv([]));

    expect(header).toBe(
      'id,email,name,heard_from,intent,source,locale,consented_at,user_id,created_at'
    );
    expect(header).toBe(WAITLIST_CSV_COLUMNS.join(','));
  });

  it('starts with a BOM so Excel on Windows reads the ñ in a name', () => {
    // Without it the file is read as the system codepage and an accented name —
    // which this product's list will be full of — arrives as mojibake.
    expect(waitlistEntriesToCsv([]).startsWith('\ufeff')).toBe(true);
  });

  it('writes one row per entry, with blanks for the unanswered fields', () => {
    const csv = waitlistEntriesToCsv([
      entry({ name: null, heardFrom: null, intent: null, userId: null }),
    ]);

    expect(csvRows(csv)[1]).toBe(
      'entry-1,ada@example.com,,,,form,en-US,2026-09-01T10:00:00.000Z,,2026-09-01T10:00:00.000Z'
    );
  });

  it('neutralises a formula a visitor typed into a free-text answer', () => {
    const csv = waitlistEntriesToCsv([entry({ intent: '=HYPERLINK("http://evil","click")' })]);

    // The leading apostrophe is what stops Excel, Calc and Sheets evaluating the
    // cell. Asserted on the output, not on `csvEscape` having been imported.
    expect(csvRows(csv)[1]).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(csvRows(csv)[1]).not.toContain(',=HYPERLINK');
  });

  it('neutralises a formula in a name and in an address', () => {
    const csv = waitlistEntriesToCsv([entry({ email: '@evil.example', name: '+1+1' })]);
    const row = csvRows(csv)[1] ?? '';

    // `@` and `+` are both triggers, and `email` looked like the safe column.
    expect(row).toContain(`'@evil.example`);
    expect(row).toContain(`'+1+1`);
  });

  it('keeps a multi-line answer in one quoted cell', () => {
    const csv = waitlistEntriesToCsv([entry({ intent: 'line one\nline two' })]);

    // The row separator is CRLF, so a bare LF inside a quoted cell must not
    // split the record — the naive version loses half of what she is reading.
    expect(csvRows(csv)).toHaveLength(2);
    expect(csvRows(csv)[1]).toContain('"line one\nline two"');
  });

  it('quotes a bare CR, so an answer cannot start a record of its own', () => {
    // The escape the platform's `csvEscape` predicate misses: it quotes on `,`,
    // `"` and `\n`, and checks the formula triggers only against the FIRST
    // character. A lone `\r` mid-cell is therefore unquoted, and because records
    // are joined with CRLF every major spreadsheet reads it as a record
    // separator — ending this record and starting one whose first cell the
    // submitter controls from its first character. `.trim()` strips only the
    // ends, so the public form can store one.
    const csv = waitlistEntriesToCsv([
      entry({ intent: "Looking forward to it!\r=cmd|' /C calc'!A0" }),
    ]);

    const rows = csvRows(csv);
    expect(rows).toHaveLength(2);
    // Two properties, and the second is the one that bites: the record did not
    // split, AND no cell anywhere begins with `=`.
    expect(rows[1]).toContain(`"Looking forward to it!\r=cmd`);
    expect(rows.some((row) => row.split(',').some((cell) => cell.startsWith('=')))).toBe(false);
  });

  it('quotes a CRLF inside an answer too, without doubling the quoting', () => {
    const csv = waitlistEntriesToCsv([entry({ intent: 'line one\r\nline two' })]);

    // `csvEscape` already quotes this one (it contains `\n`), so the wrapper must
    // leave it alone rather than wrapping a quoted cell in more quotes.
    expect(csvRows(csv)).toHaveLength(2);
    expect(csvRows(csv)[1]).toContain('"line one\r\nline two"');
    expect(csvRows(csv)[1]).not.toContain('"""');
  });

  it('quotes a comma rather than inventing a column', () => {
    const csv = waitlistEntriesToCsv([entry({ heardFrom: 'a friend, then a podcast' })]);

    expect(csvRows(csv)[1]).toContain('"a friend, then a podcast"');
    expect(csvRows(csv)).toHaveLength(2);
  });
});

describe('waitlistExportFilename', () => {
  const noon = new Date('2026-09-11T12:00:00.000Z');

  it('names the day', () => {
    expect(waitlistExportFilename(noon, false)).toBe('lelanea-waitlist-2026-09-11.csv');
  });

  it('says so in the name when the file is only the first N', () => {
    // The only truncation signal that survives a plain browser download — the
    // remedy a capped export owes its reader (`HB10`).
    expect(waitlistExportFilename(noon, true)).toBe(
      `lelanea-waitlist-2026-09-11-first-${WAITLIST_EXPORT_MAX_ROWS}.csv`
    );
  });
});
