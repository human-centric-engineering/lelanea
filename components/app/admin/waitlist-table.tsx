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
import { ChevronLeft, ChevronRight, Download, RotateCcw, Search, UserMinus } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ClientDate } from '@/components/ui/client-date';
import { parseApiResponse } from '@/lib/api/parse-response';
import { parsePaginationMeta } from '@/lib/validations/common';
import type { PaginationMeta } from '@/types/api';
import type { WaitlistAdminEntry } from '@/lib/app/waitlist/admin';
import {
  WAITLIST_ADMIN_ENDPOINT,
  WAITLIST_ADMIN_EXPORT_ENDPOINT,
} from '@/lib/app/waitlist/endpoint';
import { apiClient, APIClientError } from '@/lib/api/client';

/** How much of a long answer is shown before the row offers the rest. */
const INTENT_PREVIEW_CHARS = 240;

/** Columns, so the loading and empty rows cannot drift out of step with the head. */
const COLUMN_COUNT = 7;

interface WaitlistTableProps {
  initialEntries: WaitlistAdminEntry[];
  initialMeta: PaginationMeta;
  /**
   * True when the server page could not load the first page.
   *
   * Without it the empty table says "Nobody has joined the waitlist yet" under
   * the page's own error banner — two contradictory statements on screen, and the
   * wrong one is the confident one. It is also the exact false claim this whole
   * surface exists to prevent (`HB9`), on the one screen whose job is to answer
   * whether anyone has joined.
   */
  initialLoadFailed?: boolean;
}

/** What the confirmation dialog is currently asking about. */
interface PendingRemoval {
  id: string;
  email: string;
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
  initialLoadFailed = false,
}: WaitlistTableProps): React.ReactElement {
  const [entries, setEntries] = useState(initialEntries);
  const [meta, setMeta] = useState(initialMeta);
  const [search, setSearch] = useState('');
  /** The term the rows on screen were fetched with — what the export must match. */
  const [appliedSearch, setAppliedSearch] = useState('');
  /** Same, for the removed filter: the export has to match the screen on both. */
  const [appliedIncludeRemoved, setAppliedIncludeRemoved] = useState(false);
  /**
   * Whether what is on screen is an answer at all. Seeded from the server render
   * and cleared by the first fetch that succeeds, so a search or a page change
   * that works stops the disclaimer without needing a reload.
   */
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  /** False by default: the list is "who is waiting", and a removed entry is not. */
  const [includeRemoved, setIncludeRemoved] = useState(false);
  /**
   * The entry the confirmation dialog is asking about, or null when it is closed.
   *
   * The ROW is held rather than a boolean, so the dialog can name the address it
   * is about to act on. "Are you sure?" with nothing in it is the dialog everyone
   * clicks through.
   */
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  /**
   * Which request is the current one. Incremented on dispatch, checked before
   * every `setState`, so a slow earlier response cannot land on top of a later
   * one.
   *
   * The debounce does NOT make this unnecessary, which is the part that is easy
   * to get wrong: it collapses a burst of keystrokes into one request, but two
   * requests are in flight whenever a second search (or a page change) is
   * dispatched while the first is still running — type `ada`, pause past the
   * debounce, then type `m`. The ILIKE runs over `intent` with no index behind
   * it, so the first query being the slower one is ordinary rather than
   * unlucky.
   *
   * What it would cost: a stale response overwrites `entries`, `meta` AND
   * `appliedSearch`, so the table shows the matches for `ada` while the box
   * reads `adam` — and because the export link is built from `appliedSearch`,
   * the downloaded file is for a filter nobody is looking at. That is the
   * failure this component's test file calls the one worth asserting.
   */
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchPage = useCallback(
    async (page: number, term: string, withRemoved: boolean) => {
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;

      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(meta.limit) });
        if (term) params.set('q', term);
        if (withRemoved) params.set('includeRemoved', 'true');

        const response = await fetch(`${WAITLIST_ADMIN_ENDPOINT}?${params.toString()}`, {
          credentials: 'same-origin',
        });
        const parsed = await parseApiResponse<WaitlistAdminEntry[]>(response);

        if (!parsed.success) throw new Error(parsed.error.message);

        // Superseded while in flight — drop it, including the loading flag. The
        // newer request owns the table now, and clearing `isLoading` here would
        // re-enable the pager while that one is still running.
        if (requestSeqRef.current !== seq) return;

        setEntries(parsed.data);
        const parsedMeta = parsePaginationMeta(parsed.meta);
        if (parsedMeta) setMeta(parsedMeta);
        setAppliedSearch(term);
        setAppliedIncludeRemoved(withRemoved);
        setLoadFailed(false);
      } catch {
        if (requestSeqRef.current !== seq) return;
        // Said out loud rather than swallowed: a table that silently keeps showing
        // the previous page after a failed fetch reads as "these are the matches"
        // when they are not.
        setError('That did not load. Try again.');
      } finally {
        if (requestSeqRef.current === seq) setIsLoading(false);
      }
    },
    [meta.limit]
  );

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // 300ms, as elsewhere in the admin — responsive without a request per keystroke.
      debounceRef.current = setTimeout(() => void fetchPage(1, value.trim(), includeRemoved), 300);
    },
    [fetchPage, includeRemoved]
  );

  const handleToggleRemoved = useCallback(
    (next: boolean) => {
      setIncludeRemoved(next);
      // Straight back to page 1: the population just changed size, so the page
      // number that was on screen may no longer exist.
      void fetchPage(1, appliedSearch, next);
    },
    [appliedSearch, fetchPage]
  );

  /**
   * Take an entry off the list, or put it back.
   *
   * Sends the state to REACH rather than a toggle, which is also what the route
   * accepts — so a double click, or two admins acting at once, converges instead
   * of flip-flopping.
   *
   * Re-fetches the current page afterwards rather than patching the row in place.
   * A removal usually makes the row vanish (the default filter excludes it), so
   * the pagination totals move and the page has to be re-read to stay honest.
   */
  const setRemoved = useCallback(
    async (id: string, removed: boolean) => {
      setMutatingId(id);
      setError(null);
      try {
        // `{ body: … }`, not the body directly — `apiClient.patch(path, options)`
        // takes an options bag, and passing the payload in its place sends an
        // empty PATCH that fails validation with a message about the wrong thing.
        await apiClient.patch(`${WAITLIST_ADMIN_ENDPOINT}/${id}`, { body: { removed } });
        await fetchPage(meta.page, appliedSearch, appliedIncludeRemoved);
      } catch (err) {
        setError(
          err instanceof APIClientError
            ? err.message
            : removed
              ? 'That entry was not removed. Try again.'
              : 'That entry was not restored. Try again.'
        );
      } finally {
        setMutatingId(null);
      }
    },
    [appliedIncludeRemoved, appliedSearch, fetchPage, meta.page]
  );

  // Both applied filters, so the file is the screen. Built from the APPLIED values
  // rather than the live ones: a half-typed search must not change what the button
  // would download.
  const exportParams = new URLSearchParams();
  if (appliedSearch) exportParams.set('q', appliedSearch);
  if (appliedIncludeRemoved) exportParams.set('includeRemoved', 'true');
  const exportQuery = exportParams.toString();
  const exportHref = exportQuery
    ? `${WAITLIST_ADMIN_EXPORT_ENDPOINT}?${exportQuery}`
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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="waitlist-show-removed"
              checked={includeRemoved}
              onCheckedChange={handleToggleRemoved}
            />
            <Label htmlFor="waitlist-show-removed" className="text-sm font-normal">
              Show removed
            </Label>
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
              <TableHead className="w-28 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
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
                  {loadFailed
                    ? 'The list did not load, so this is not an answer about who has joined.'
                    : appliedSearch
                      ? 'Nobody on the list matches that.'
                      : appliedIncludeRemoved
                        ? // Removed entries ARE included and there are still none, so
                          // nobody has ever joined. This is the only empty state that
                          // can honestly say that.
                          'Nobody has joined the waitlist yet.'
                        : // The default filter hides removed entries, so an empty list
                          // does NOT mean nobody joined — it means nobody is waiting.
                          // Found by looking at the page with every entry removed,
                          // where the old copy claimed nobody had joined while two
                          // people had. Same false-claim problem as the failed-load
                          // case (`HB9`), reachable on any small list after a cleanup.
                          'Nobody is on the list. If someone was removed, “Show removed” will find them.'}
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className={entry.removedAt ? 'text-muted-foreground align-top' : 'align-top'}
                >
                  <TableCell className="text-muted-foreground">
                    <ClientDate date={entry.createdAt} />
                  </TableCell>
                  <TableCell className="font-medium break-all">
                    <span className={entry.removedAt ? 'line-through' : undefined}>
                      {entry.email}
                    </span>
                    {entry.removedAt && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="font-normal">
                          Removed
                        </Badge>
                        {/* The D9 signal: they asked to come back, nothing put them
                            back, so it has to be visible or the record is kept for
                            nobody. */}
                        {entry.rejoinRequests > 0 && (
                          <Badge variant="secondary" className="font-normal">
                            Asked to re-join ×{entry.rejoinRequests}
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="break-words">{entry.name ?? <Unanswered />}</TableCell>
                  <TableCell className="break-words">{entry.heardFrom ?? <Unanswered />}</TableCell>
                  <TableCell className="text-sm">
                    {entry.intent ? <Answer text={entry.intent} /> : <Unanswered />}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {entry.userId ? 'Linked' : <Unanswered />}
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.removedAt ? (
                      // No confirmation on a restore: it is the undo of the
                      // destructive-looking act, and itself undoable by removing
                      // again. A dialog in every direction trains people to dismiss
                      // the one that matters.
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={mutatingId === entry.id}
                        onClick={() => void setRemoved(entry.id, false)}
                      >
                        <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={mutatingId === entry.id}
                        onClick={() => setPendingRemoval({ id: entry.id, email: entry.email })}
                      >
                        <UserMinus className="mr-1.5 h-4 w-4" aria-hidden />
                        Remove
                      </Button>
                    )}
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
            onClick={() => void fetchPage(meta.page - 1, appliedSearch, appliedIncludeRemoved)}
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
            onClick={() => void fetchPage(meta.page + 1, appliedSearch, appliedIncludeRemoved)}
            disabled={meta.page >= meta.totalPages || isLoading}
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/*
        The confirmation. `AlertDialog` rather than `Dialog` because this is a
        destructive-looking act needing an explicit answer — it traps focus and
        has no dismiss-by-clicking-outside.

        The copy names the person and says what removal IS and IS NOT, because
        the honest risk here is not a misclick: it is an admin believing they
        have answered a "delete my data" request. They have not — the row keeps
        the address and the answers, and the only thing that erases them is
        account erasure.
      */}
      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take {pendingRemoval?.email} off the waitlist?</AlertDialogTitle>
            <AlertDialogDescription>
              They stop appearing in the list and in the export, and they will not be written to
              when a place opens. You can put them back at any time with “Show removed”.
              <br />
              <br />
              <strong>This does not delete their data.</strong> The entry keeps their email address
              and everything they told us. If they have asked to have their data erased, that is a
              different act and this is not it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them on the list</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingRemoval;
                setPendingRemoval(null);
                if (target) void setRemoved(target.id, true);
              }}
            >
              Remove from waitlist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
