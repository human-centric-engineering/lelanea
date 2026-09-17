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
 * ## Invited → Joined (t-46, t-47)
 *
 * The list is where she decides who to let in, so the row carries the two
 * states that follow: "Invited <date>" once an invitation has gone from here,
 * and "Joined <date>" once the person accepted one and has an account. The
 * first is written by the invite route; the second by the user-created hook,
 * whichever surface the invitation came from. A joined row leaves the default
 * list the way a removed one does, behind its own switch — hidden completely,
 * it would be indistinguishable from a deleted one (`HB9`).
 *
 * @see app/admin/app/waitlist/page.tsx — the server page that seeds it
 * @see .context/app/waitlist.md
 */

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
  Search,
  Send,
  UserMinus,
} from 'lucide-react';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  waitlistAdminInviteEndpoint,
} from '@/lib/app/waitlist/endpoint';
import { apiClient, APIClientError } from '@/lib/api/client';
import type { EmailStatus } from '@/lib/email/send';

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

/** What the removal confirmation is currently asking about. */
interface PendingRemoval {
  id: string;
  email: string;
}

/**
 * The two population switches, carried together so a fetch, the export link and
 * the empty-state copy all read the same pair.
 */
interface Filters {
  includeRemoved: boolean;
  includeJoined: boolean;
}

const DEFAULT_FILTERS: Filters = { includeRemoved: false, includeJoined: false };

/**
 * What the invitation dialog is asking about.
 *
 * `name` is what the input starts with — the row's own, or empty when the
 * person left it blank (D2) — and `resend` changes the copy: a second send is
 * a reminder, and the dialog should say so rather than read as the first.
 */
interface PendingInvite {
  id: string;
  email: string;
  name: string;
  resend: boolean;
}

/** What `POST …/:id/invite` answers with — the part the table acts on. */
interface InviteResult {
  entry: WaitlistAdminEntry;
  emailStatus: EmailStatus;
  expiresAt: string;
}

/**
 * What the RESTORE confirmation is asking about.
 *
 * Only ever set for a row carrying re-submissions, because that is the only case
 * where a restore is a decision rather than an undo — see the Restore button.
 */
interface PendingRestore {
  id: string;
  email: string;
  rejoinRequests: number;
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
  /** Same, for the two switches: the export has to match the screen on all three. */
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS);
  /**
   * Whether what is on screen is an answer at all. Seeded from the server render
   * and cleared by the first fetch that succeeds, so a search or a page change
   * that works stops the disclaimer without needing a reload.
   */
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  /**
   * Both off by default: the list is "who is waiting", and neither a removed
   * entry nor one that has joined is.
   */
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  /**
   * The entry the confirmation dialog is asking about, or null when it is closed.
   *
   * The ROW is held rather than a boolean, so the dialog can name the address it
   * is about to act on. "Are you sure?" with nothing in it is the dialog everyone
   * clicks through.
   */
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  /** The name field of the invitation dialog, seeded from the row when it opens. */
  const [inviteName, setInviteName] = useState('');
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The outcome of the last invitation, which is not an error even when the
   * email did not go: the invitation exists either way, and what the admin
   * needs to know is whether to expect the person to have received it.
   */
  const [notice, setNotice] = useState<string | null>(null);
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
  /**
   * `fetchPage`, so it can retry itself without being its own `useCallback`
   * dependency — which is a cycle TypeScript reports and React cannot resolve.
   * Assigned on every render, below.
   */
  const fetchPageRef = useRef<
    ((page: number, term: string, withFilters: Filters) => Promise<void>) | null
  >(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchPage = useCallback(
    async (page: number, term: string, withFilters: Filters) => {
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;

      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(meta.limit) });
        if (term) params.set('q', term);
        if (withFilters.includeRemoved) params.set('includeRemoved', 'true');
        if (withFilters.includeJoined) params.set('includeJoined', 'true');

        const response = await fetch(`${WAITLIST_ADMIN_ENDPOINT}?${params.toString()}`, {
          credentials: 'same-origin',
        });
        const parsed = await parseApiResponse<WaitlistAdminEntry[]>(response);

        if (!parsed.success) throw new Error(parsed.error.message);

        // Superseded while in flight — drop it, including the loading flag. The
        // newer request owns the table now, and clearing `isLoading` here would
        // re-enable the pager while that one is still running.
        if (requestSeqRef.current !== seq) return;

        const parsedMeta = parsePaginationMeta(parsed.meta);

        // An empty page that is NOT an empty list: the rows moved out from under
        // the requested page — usually because this admin just removed the last
        // one on it, since `setRemoved` re-reads the page it was on. Rendering it
        // would show "Page 2 of 1", "Showing 26 to 25 of 25", and an empty-state
        // sentence claiming nobody is on a list holding 25 people. Fetch the last
        // page that exists instead, and let that render.
        //
        // Non-recursive in practice: the retry asks for `totalPages`, which is
        // below the page that just came back empty, so the condition cannot hold
        // a second time.
        if (page > 1 && parsed.data.length === 0 && parsedMeta && parsedMeta.total > 0) {
          void fetchPageRef.current?.(Math.max(1, parsedMeta.totalPages), term, withFilters);
          return;
        }

        setEntries(parsed.data);
        if (parsedMeta) setMeta(parsedMeta);
        setAppliedSearch(term);
        setAppliedFilters(withFilters);
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

  // Assigned in an effect, not during render: writing a ref while rendering is what
  // `react-hooks/refs` forbids, and it is forbidden for a real reason (a render can
  // be thrown away). The retry that reads this runs inside an async continuation,
  // long after the render that armed it, so one render's staleness cannot reach it.
  useEffect(() => {
    fetchPageRef.current = fetchPage;
  }, [fetchPage]);

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // 300ms, as elsewhere in the admin — responsive without a request per keystroke.
      debounceRef.current = setTimeout(() => void fetchPage(1, value.trim(), filters), 300);
    },
    [fetchPage, filters]
  );

  const handleToggleFilter = useCallback(
    (key: keyof Filters, next: boolean) => {
      const nextFilters = { ...filters, [key]: next };
      setFilters(nextFilters);
      // Cancel any pending search first. `handleSearch` captured `filters` at
      // keystroke time, so a timer armed seconds ago would fire AFTER this
      // fetch, win the sequence guard, and re-apply the old filter — leaving the
      // switch reading on, the rows absent, and the export link silently
      // disagreeing with the screen. The code review of §03 t-24 found it.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // The LIVE term, not the applied one: whatever is in the box is what the
      // admin can see, and a half-typed search that has not fired yet is still
      // the search they are making.
      void fetchPage(1, search.trim(), nextFilters);
    },
    [fetchPage, filters, search]
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
        await fetchPage(meta.page, appliedSearch, appliedFilters);
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
    [appliedFilters, appliedSearch, fetchPage, meta.page]
  );

  /**
   * Send, or re-send, the invitation.
   *
   * The name always travels: the dialog seeds it from the row and the admin can
   * change it, so what is sent is what was on screen rather than whichever of
   * the two the route would have preferred. Re-fetches the page afterwards so
   * the "Invited" badge comes from the server's row, not from a guess.
   *
   * A 409 is the row having moved under the admin — removed, or joined — since
   * the page loaded; the route's message says which, and the re-fetch shows it.
   */
  const sendInvite = useCallback(
    async (id: string, name: string) => {
      setMutatingId(id);
      setError(null);
      setNotice(null);
      try {
        const result = await apiClient.post<InviteResult>(waitlistAdminInviteEndpoint(id), {
          body: { name },
        });
        // Said out loud when the email did NOT go, because the badge alone reads
        // as "they have it". The invitation exists and Resend is the remedy.
        setNotice(
          result.emailStatus === 'sent'
            ? `Invitation sent to ${result.entry.email}.`
            : result.emailStatus === 'disabled'
              ? `Invitation created for ${result.entry.email}, but no email was sent — email is not configured here.`
              : `Invitation created for ${result.entry.email}, but the email did not send. Try “Resend”.`
        );
        await fetchPage(meta.page, appliedSearch, appliedFilters);
      } catch (err) {
        // The row may have moved (a 409 says so); show it as it stands — and
        // only THEN say why, because `fetchPage` clears the error on its way in.
        await fetchPage(meta.page, appliedSearch, appliedFilters);
        setError(
          err instanceof APIClientError ? err.message : 'That invitation was not sent. Try again.'
        );
      } finally {
        setMutatingId(null);
      }
    },
    [appliedFilters, appliedSearch, fetchPage, meta.page]
  );

  const openInvite = useCallback((entry: WaitlistAdminEntry) => {
    const name = entry.name ?? '';
    setInviteName(name);
    setPendingInvite({ id: entry.id, email: entry.email, name, resend: entry.invitedAt !== null });
  }, []);

  // All applied filters, so the file is the screen. Built from the APPLIED values
  // rather than the live ones: a half-typed search must not change what the button
  // would download.
  const exportParams = new URLSearchParams();
  if (appliedSearch) exportParams.set('q', appliedSearch);
  if (appliedFilters.includeRemoved) exportParams.set('includeRemoved', 'true');
  if (appliedFilters.includeJoined) exportParams.set('includeJoined', 'true');
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
              checked={filters.includeRemoved}
              onCheckedChange={(next) => handleToggleFilter('includeRemoved', next)}
            />
            <Label htmlFor="waitlist-show-removed" className="text-sm font-normal">
              Show removed
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="waitlist-show-joined"
              checked={filters.includeJoined}
              onCheckedChange={(next) => handleToggleFilter('includeJoined', next)}
            />
            <Label htmlFor="waitlist-show-joined" className="text-sm font-normal">
              Show joined
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
      {notice && (
        <p role="status" className="text-muted-foreground text-sm">
          {notice}
        </p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {/* "Added", not "Joined": joining is now a state of its own. */}
              <TableHead className="w-28">Added</TableHead>
              <TableHead className="w-[22%]">Email</TableHead>
              <TableHead className="w-[14%]">Name</TableHead>
              <TableHead className="w-[16%]">Heard about us</TableHead>
              <TableHead>What they want</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-44 text-right">
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
                      ? // Same false-claim trap as the default-filter case below,
                        // and the likelier way in: searching one address is how you
                        // check whether somebody joined, and with the filter off a
                        // removed person reads as never having been there. The code
                        // review of §03 t-24 caught the branch order.
                        appliedFilters.includeRemoved && appliedFilters.includeJoined
                        ? 'Nobody on the list matches that.'
                        : 'Nobody on the list matches that. If they were removed or have joined, the switches above will find them.'
                      : appliedFilters.includeRemoved && appliedFilters.includeJoined
                        ? // Removed AND joined entries are included and there are still
                          // none, so nobody has ever signed up. This is the only empty
                          // state that can honestly say that.
                          'Nobody has joined the waitlist yet.'
                        : // The default filters hide removed and joined entries, so an
                          // empty list does NOT mean nobody signed up — it means nobody
                          // is waiting. Found by looking at the page with every entry
                          // removed, where the old copy claimed nobody had joined while
                          // two people had. Same false-claim problem as the failed-load
                          // case (`HB9`), reachable on any small list after a cleanup.
                          'Nobody is on the list. If someone was removed or has joined, the switches above will find them.'}
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
                        {/*
                          The D9 signal: the form was submitted again and nothing
                          put them back, so it has to be visible or the record is
                          kept for nobody.

                          "Re-submitted", not "asked to re-join". The first states
                          what happened; the second states who did it, and NOTHING
                          here knows that — the public form proves no ownership of
                          the address (A8, no confirmation email). The security
                          review of this task found the confident wording was the
                          load-bearing part of a real attack: three unauthenticated
                          POSTs of a victim's address manufacture a signal that reads
                          as the victim asking to come back, and the admin's click
                          then delivers exactly the resurrection D9 refuses to do
                          automatically.
                        */}
                        {entry.rejoinRequests > 0 && (
                          <Badge variant="secondary" className="font-normal">
                            Re-submitted ×{entry.rejoinRequests}
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
                  <TableCell className="text-sm">
                    {/*
                      Joined wins over Invited: once they are in, when we last wrote
                      to them is history. Neither claims the email was READ — only
                      that it was sent, and that an account now exists.
                    */}
                    {entry.joinedAt ? (
                      <Badge variant="secondary" className="font-normal whitespace-nowrap">
                        Joined <ClientDate date={entry.joinedAt} className="ml-1" />
                      </Badge>
                    ) : entry.invitedAt ? (
                      <Badge variant="outline" className="font-normal whitespace-nowrap">
                        Invited <ClientDate date={entry.invitedAt} className="ml-1" />
                      </Badge>
                    ) : (
                      <Unanswered />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.removedAt ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={mutatingId === entry.id}
                        onClick={() => {
                          // A plain undo when the admin is reversing their own
                          // action: no ceremony, and itself undoable by removing
                          // again. A dialog in every direction trains people to
                          // dismiss the one that matters.
                          //
                          // But a re-submission changes what the click MEANS. The
                          // form proves nothing about who submitted it, so restoring
                          // on the strength of one may be putting someone back on a
                          // list they asked to leave, at a stranger's instigation.
                          // That is the gap the security review found between D9's
                          // code and D9's surface, and this is where it closes.
                          if (entry.rejoinRequests > 0) {
                            setPendingRestore({
                              id: entry.id,
                              email: entry.email,
                              rejoinRequests: entry.rejoinRequests,
                            });
                            return;
                          }
                          void setRemoved(entry.id, false);
                        }}
                      >
                        <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
                        Restore
                      </Button>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {/*
                          No Invite once they have joined — the route would 409,
                          and the button would be an offer to write to someone who
                          is already in. Remove stays: it is still their row.
                        */}
                        {!entry.joinedAt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={mutatingId === entry.id}
                            onClick={() => openInvite(entry)}
                          >
                            <Send className="mr-1.5 h-4 w-4" aria-hidden />
                            {entry.invitedAt ? 'Resend' : 'Invite'}
                          </Button>
                        )}
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
                      </div>
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
            onClick={() => void fetchPage(meta.page - 1, appliedSearch, appliedFilters)}
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
            onClick={() => void fetchPage(meta.page + 1, appliedSearch, appliedFilters)}
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

      {/*
        The restore confirmation, which exists ONLY for a row carrying
        re-submissions. Its whole job is to say that the signal the admin is
        probably acting on is unverified — the gap the security review found
        between what D9 enforces in code and what the screen implies.
      */}
      <AlertDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Put {pendingRestore?.email} back on the waitlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {/*
                Guarded on `pendingRestore`, not optional-chained into the string.
                Radix keeps the content mounted through the exit animation, so the
                interpolated version rendered the literal words "undefined times"
                on the way out of every confirm and cancel. jsdom has no animation,
                which is why the tests never saw it — the code review did.
              */}
              {pendingRestore === null
                ? null
                : `This address was submitted through the public form ${
                    pendingRestore.rejoinRequests === 1
                      ? 'once'
                      : `${pendingRestore.rejoinRequests} times`
                  } after it was removed.`}
              <br />
              <br />
              <strong>That does not prove it was them.</strong> The form asks for an address and
              nothing more — anyone who knows this one can submit it. If the person asked to be
              taken off, restoring them on the strength of this puts them back on a list they wanted
              to leave. Write to them if you are not sure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Leave them off</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingRestore;
                setPendingRestore(null);
                if (target) void setRemoved(target.id, false);
              }}
            >
              Put back on the list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        The invitation. A `Dialog` rather than an `AlertDialog`, because it
        carries a field: the invitation email greets the person by name, and a
        waitlist entry's name is optional (D2), so the name is asked for here —
        seeded from the row when it has one, so the common case is one click
        and the nameless case is one word.

        One dialog for both sends. A resend is the same act with different
        copy, and the route treats it the same way.
      */}
      <Dialog
        open={pendingInvite !== null}
        onOpenChange={(open) => {
          if (!open) setPendingInvite(null);
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const target = pendingInvite;
              const name = inviteName.trim();
              if (!target || !name) return;
              setPendingInvite(null);
              void sendInvite(target.id, name);
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {pendingInvite?.resend
                  ? `Send ${pendingInvite.email} the invitation again?`
                  : `Invite ${pendingInvite?.email ?? ''}?`}
              </DialogTitle>
              <DialogDescription>
                {pendingInvite?.resend
                  ? 'The earlier link stops working and a fresh one goes out. They will have seven days to accept it.'
                  : 'They get an email with a link to create their account, good for seven days. Accepting it takes them off the waitlist.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="waitlist-invite-name">Name</Label>
              <Input
                id="waitlist-invite-name"
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                maxLength={100}
              />
              <p className="text-muted-foreground text-xs">
                {pendingInvite && pendingInvite.name === ''
                  ? 'They did not give one. The email greets them by it, so add one before sending.'
                  : 'What the email greets them by.'}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPendingInvite(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviteName.trim() === ''}>
                <Send className="mr-1.5 h-4 w-4" aria-hidden />
                {pendingInvite?.resend ? 'Send again' : 'Send invitation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
