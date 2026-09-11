'use client';

/**
 * The waitlist, as an admin reads it.
 *
 * §03 t-7 shipped the write and nothing that read it back. This table and the
 * export beside it are the read surface that makes the write visible (`HB9`) —
 * and the reason it is a table of ANSWERS rather than a list of addresses is
 * that `intent` ("what would you want to achieve?") is what the column exists
 * for: Lelañea reads these one by one while there are few enough to.
 *
 * ## It lives under `components/app/` and looks nothing like the rest of it
 *
 * Every other leaf component in this tree is brand-styled — the lotus, the
 * typefaces, `components/app/ui/*`. This one uses the PLATFORM primitives
 * (`components/ui/table`, `button`, `input`) on purpose: `/admin/**` classifies
 * as the `admin` surface in `lib/app/surface.ts`, which `brand-theme.css`
 * deliberately does not reach, so an operator surface keeps Sunrise's chrome and
 * a fork's palette never has to be maintained twice. The file is here rather
 * than in `components/admin/` because ownership, not styling, decides the tier:
 * `components/admin/` is Sunrise's.
 *
 * @see app/admin/app/waitlist/page.tsx — the server page that seeds it
 * @see .context/app/waitlist.md
 */

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClientDate } from '@/components/ui/client-date';
import { parseApiResponse } from '@/lib/api/parse-response';
import { parsePaginationMeta } from '@/lib/validations/common';
import type { PaginationMeta } from '@/types/api';
import type { WaitlistAdminEntry } from '@/lib/app/waitlist/admin';
import {
  WAITLIST_ADMIN_ENDPOINT,
  WAITLIST_ADMIN_EXPORT_ENDPOINT,
} from '@/lib/app/waitlist/endpoint';

/** How much of a long answer is shown before the row offers the rest. */
const INTENT_PREVIEW_CHARS = 240;

/** Columns, so the loading and empty rows cannot drift out of step with the head. */
const COLUMN_COUNT = 6;

interface WaitlistTableProps {
  initialEntries: WaitlistAdminEntry[];
  initialMeta: PaginationMeta;
}

/**
 * A long answer, collapsed until asked for.
 *
 * `intent` accepts 2000 characters, so a page of 25 of them renders as a wall if
 * every one is shown in full — and a table whose rows are a screen tall is one
 * nobody scans. Truncating with no way back would be worse: the answer is the
 * point of the row. So the preview is the default and the whole thing is one
 * click away, per row.
 */
function Answer({ text }: { text: string }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > INTENT_PREVIEW_CHARS;

  if (!isLong) {
    return <p className="break-words whitespace-pre-wrap">{text}</p>;
  }

  return (
    <div className="space-y-1">
      <p className="break-words whitespace-pre-wrap">
        {expanded ? text : `${text.slice(0, INTENT_PREVIEW_CHARS).trimEnd()}…`}
      </p>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Show less' : 'Show all'}
      </Button>
    </div>
  );
}

/** An optional answer nobody gave, rendered as absence rather than as blankness. */
function Unanswered(): React.ReactElement {
  return <span className="text-muted-foreground">—</span>;
}

export function WaitlistTable({
  initialEntries,
  initialMeta,
}: WaitlistTableProps): React.ReactElement {
  const [entries, setEntries] = useState(initialEntries);
  const [meta, setMeta] = useState(initialMeta);
  const [search, setSearch] = useState('');
  /** The term the rows on screen were fetched with — what the export must match. */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchPage = useCallback(
    async (page: number, term: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(meta.limit) });
        if (term) params.set('q', term);

        const response = await fetch(`${WAITLIST_ADMIN_ENDPOINT}?${params.toString()}`, {
          credentials: 'same-origin',
        });
        const parsed = await parseApiResponse<WaitlistAdminEntry[]>(response);

        if (!parsed.success) throw new Error(parsed.error.message);

        setEntries(parsed.data);
        const parsedMeta = parsePaginationMeta(parsed.meta);
        if (parsedMeta) setMeta(parsedMeta);
        setAppliedSearch(term);
      } catch {
        // Said out loud rather than swallowed: a table that silently keeps showing
        // the previous page after a failed fetch reads as "these are the matches"
        // when they are not.
        setError('That did not load. Try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [meta.limit]
  );

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // 300ms, as elsewhere in the admin — responsive without a request per keystroke.
      debounceRef.current = setTimeout(() => void fetchPage(1, value.trim()), 300);
    },
    [fetchPage]
  );

  const exportHref = appliedSearch
    ? `${WAITLIST_ADMIN_EXPORT_ENDPOINT}?q=${encodeURIComponent(appliedSearch)}`
    : WAITLIST_ADMIN_EXPORT_ENDPOINT;

  const firstOnPage = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const lastOnPage = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Label htmlFor="waitlist-search" className="sr-only">
            Search the waitlist
          </Label>
          <Search
            className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            id="waitlist-search"
            placeholder="Search email, name or answers…"
            value={search}
            onChange={(event) => handleSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        {/* A plain anchor, not `next/link`: the response is an attachment, and a
            client-side navigation would try to render it as a route. */}
        <Button asChild variant="outline">
          <a href={exportHref}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Export CSV
          </a>
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Joined</TableHead>
              <TableHead className="w-[22%]">Email</TableHead>
              <TableHead className="w-[14%]">Name</TableHead>
              <TableHead className="w-[16%]">Heard about us</TableHead>
              <TableHead>What they want</TableHead>
              <TableHead className="w-20 text-center">Account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="h-24 text-center">
                  {appliedSearch
                    ? 'Nobody on the list matches that.'
                    : 'Nobody has joined the waitlist yet.'}
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id} className="align-top">
                  <TableCell className="text-muted-foreground">
                    <ClientDate date={entry.createdAt} />
                  </TableCell>
                  <TableCell className="font-medium break-all">{entry.email}</TableCell>
                  <TableCell className="break-words">{entry.name ?? <Unanswered />}</TableCell>
                  <TableCell className="break-words">{entry.heardFrom ?? <Unanswered />}</TableCell>
                  <TableCell className="text-sm">
                    {entry.intent ? <Answer text={entry.intent} /> : <Unanswered />}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {entry.userId ? 'Linked' : <Unanswered />}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {meta.total === 0
            ? 'No entries'
            : `Showing ${firstOnPage} to ${lastOnPage} of ${meta.total} ${
                meta.total === 1 ? 'entry' : 'entries'
              }`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchPage(meta.page - 1, appliedSearch)}
            disabled={meta.page <= 1 || isLoading}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </Button>
          <span className="text-sm">
            Page {meta.page} of {Math.max(meta.totalPages, 1)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchPage(meta.page + 1, appliedSearch)}
            disabled={meta.page >= meta.totalPages || isLoading}
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
