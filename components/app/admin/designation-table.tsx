'use client';

/**
 * What every document she uploaded is FOR, and whether the agent may quote it.
 *
 * Lists `scope: 'app'` documents only — the material uploaded into this install,
 * never the platform's pre-loaded seed corpus. That is not a tidiness filter: a
 * `system`-scoped document is searchable by every agent whatever anyone
 * designates it, so showing one beside an `Agent may quote` badge states an
 * answer this feature has no power over. The first version listed the bundled
 * Agentic Design Patterns reference as "No", which was simply untrue.
 *
 * The ingestion is the platform's — the uploader, the bulk upload,
 * fetch-from-URL and the parsers all ship with Sunrise, and t-44 put its upload
 * zone directly above this table so adding material and designating it are one
 * page rather than two (`components/app/admin/knowledge-workspace.tsx`). What
 * the platform cannot show is the distinction this feature turns on: whether a
 * document is something she KNOWS or something that shows how she SOUNDS. This
 * table is where that answer is given, and the `Agent may quote` column is where
 * the consequence of giving it is visible on the same screen.
 *
 * ## `Agent may quote` answers two questions, and says so when they disagree
 *
 * The rule says whether the agent MAY quote a document; the document's own
 * ingestion decides whether there is anything to quote. They are different
 * axes and they come apart routinely — a PDF sitting in `pending_review` with
 * zero chunks is permitted by the rule and reachable by nothing. The cell
 * rendered "Yes" for that, which is the same shape of untrue claim as the
 * `system`-scoped row above, from the other direction: the rule permits it, and
 * there is nothing there to permit.
 *
 * So the cell renders THREE answers, from two server-computed verdicts it never
 * re-derives — `quotable` from `isQuotable()` and `retrieval` from
 * `retrievalState()`. Collapsing them into one boolean is the tempting fix and
 * the wrong one: it hides which half is missing, and the next reader
 * reasonably makes the grant rule depend on ingestion state.
 *
 * ## The undesignated filter is the point of the page, not a convenience
 *
 * A document nobody has answered for reaches nothing — the rule is
 * deny-by-default — but "reaches nothing" is indistinguishable on screen from
 * "reaches everything", which is exactly the confusion that gets her Substack
 * pasted into a reply. So the first control is the one that lists what is still
 * unanswered, and the empty state for it says so in those words.
 *
 * ## It uses the PLATFORM primitives, and looks nothing like the rest of `components/app/`
 *
 * Same reasoning as `waitlist-table.tsx`: `/admin/**` classifies as the `admin`
 * surface in `lib/app/surface.ts`, which `brand-theme.css` deliberately does not
 * reach, so an operator surface keeps Sunrise's chrome. The file is here rather
 * than in `components/admin/` because ownership decides the tier, not styling —
 * `components/admin/` is Sunrise's.
 *
 * @see app/admin/app/knowledge/page.tsx — the server page that seeds it
 * @see lib/app/voice/designation.ts — the vocabulary and the rule
 * @see .context/app/voice.md
 */

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, CircleSlash, Quote, Search } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import { ClientDate } from '@/components/ui/client-date';
import { parseApiResponse } from '@/lib/api/parse-response';
import { parsePaginationMeta } from '@/lib/validations/common';
import type { PaginationMeta } from '@/types/api';
import type { DesignatedDocument, RetrievalState } from '@/lib/app/voice/designation-admin';
import { DESIGNATION_ADMIN_ENDPOINT } from '@/lib/app/voice/endpoint';
import { LICENSING_MAX } from '@/lib/validations/app-knowledge-designation';
import {
  DOCUMENT_PURPOSES,
  DOCUMENT_SENSITIVITIES,
  PURPOSE_COPY,
  SENSITIVITY_COPY,
  type DocumentPurpose,
  type DocumentSensitivity,
} from '@/lib/app/voice/designation';

/** Columns, so the loading and empty rows cannot drift out of step with the head. */
const COLUMN_COUNT = 6;

/** The `<Select>` value standing for "no answer". Radix rejects `''` as an item value. */
const UNSET = '__unset__';

/**
 * What the `Agent may quote` cell says when the rule permits the document and
 * there is nothing of it to retrieve.
 *
 * A lookup keyed on the server's `retrieval` verdict, never a derivation from
 * `status` and `chunkCount`. That distinction is the whole point of the cell:
 * the moment the component reasons about ingestion itself, this surface and
 * `retrievalState()` can disagree about what "ready" means, in the same way a
 * `quotable` computed in JSX would drift from `isQuotable()`.
 *
 * `retrievable` is absent because it is the only state with nothing to
 * apologise for, and `Record<Exclude<…>>` is what makes adding a fifth state to
 * {@link RetrievalState} a type error here rather than a silent `undefined` in
 * a table cell.
 *
 * Kept short on purpose — the column's own `FieldHelp` carries the long form,
 * and a sentence in a table cell widens the column it sits in.
 *
 * The copy separates the two things she can do about it. `pending` is a wait —
 * and deliberately does not promise the wait ends, because `pending_review` has
 * no resume path in any tier (upstream `sunrise#807`); the row's own
 * `· N chunks · status` line beside the name says which state it is actually
 * in. `failed` and `empty` are hers to act on, so they name the act (`HB10`).
 */
const RETRIEVAL_COPY: Record<
  Exclude<RetrievalState, 'retrievable'>,
  { label: string; reason: string }
> = {
  pending: {
    label: 'Not yet',
    reason: 'Permitted, but nothing is chunked yet — see the status by the name.',
  },
  failed: {
    label: 'Nothing to quote',
    reason: 'Permitted, but it never parsed. Upload it again to retry.',
  },
  empty: {
    label: 'Nothing to quote',
    reason: 'Permitted, but no text was found in it. Check the file and upload it again.',
  },
};

interface DesignationTableProps {
  initialDocuments: Row[];
  initialMeta: PaginationMeta;
  /**
   * True when the server page could not load the first page.
   *
   * Without it the empty table says "Nothing has been uploaded yet" under the
   * page's own error banner — two contradictory statements on screen, and the
   * wrong one is the confident one (`HB9`).
   */
  initialLoadFailed?: boolean;
  /**
   * The surface above saying the corpus changed, and whether anything was ADDED.
   *
   * The table owns its own fetching, so a change it knows nothing about would
   * leave it showing the list as it stood before — and the row missing is
   * exactly the document she just added, which reads as the upload having
   * failed. The parent says *something happened*; the table decides what to
   * re-request, which keeps the current search and filter rather than resetting
   * them.
   *
   * **`added` is a separate fact from the bump, and conflating them put a lie on
   * screen.** The first version inferred "something was added" from the bump
   * alone and then from a row count — so discarding a PDF from the preview
   * modal, which DELETES the row and refreshes, announced "Added" about a
   * document that had just been destroyed. Only the parent knows which callback
   * fired, so only the parent can answer this. Caught by /code-review.
   *
   * One object rather than two props, so the count and the intent cannot drift
   * apart in a render.
   */
  reloadSignal?: { token: number; added: boolean };
}

/**
 * A row as this component sees it.
 *
 * `createdAt` widens to `Date | string` because the two sources disagree and both
 * are real: the server page hands over a `Date`, and every client fetch after
 * that hands over whatever `JSON.parse` made of it, which is a string.
 * `DesignatedDocument` is assignable to this, so the server page needs no cast —
 * and `ClientDate` accepts either, which is why widening here is honest rather
 * than a workaround.
 */
type Row = Omit<DesignatedDocument, 'createdAt'> & { createdAt: Date | string };

export function DesignationTable({
  initialDocuments,
  initialMeta,
  initialLoadFailed = false,
  reloadSignal,
}: DesignationTableProps): React.ReactElement {
  const [documents, setDocuments] = useState(initialDocuments);
  const [meta, setMeta] = useState(initialMeta);
  const [search, setSearch] = useState('');
  const [undesignatedOnly, setUndesignatedOnly] = useState(false);
  /** The filters the rows on screen were fetched with — what the empty state must describe. */
  const [appliedUndesignatedOnly, setAppliedUndesignatedOnly] = useState(false);
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The document whose licensing note is being edited, and the draft text. */
  const [licensingDraft, setLicensingDraft] = useState<{ id: string; text: string } | null>(null);
  /**
   * Every row with a save in flight, not just the most recent one.
   *
   * A single slot misreported two overlapping saves: change a purpose on row A,
   * change one on row B before A resolves, and A's `finally` clears the slot —
   * so B's row un-dims and its selects re-enable while B's PATCH is still going.
   */
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Set when a reload triggered by an upload came back no longer than before.
   *
   * The upload zone above offers the whole managed taxonomy, so she can attach a
   * purpose at upload — and then the **Undesignated documents** filter correctly
   * excludes the document she just added. A search term does the same for a name
   * that does not match. Either way the zone clears its staged files and says
   * nothing, the table looks untouched, and the upload reads as having failed.
   * So the table says what happened instead (`HB10` — name the remedy, not the
   * diagnosis), and carries WHICH of the two is narrowing the view, so it never
   * tells her to clear a search she never typed.
   *
   * **It is only set when the view is actually narrowed**, because that is the
   * only state "it might be hidden" explains. With nothing filtering, a count
   * that did not grow means nothing was added — which is the upload zone's own
   * error to report, directly above, not the table's to guess at.
   */
  const [addedOutsideView, setAddedOutsideView] = useState<{
    search: boolean;
    filter: boolean;
  } | null>(null);
  /**
   * The documents on screen when the current request went out, by id.
   *
   * **Identity, not a count — and the count was wrong.** The first version
   * compared `meta.total` before and after an upload's reload. But `save()`
   * patches a designated row in place and never refetches, so under the
   * **Undesignated documents** filter the server's true count falls while the
   * remembered one does not. Work the backlog for a few rows and every later
   * upload compares against a number that is too high: the notice then fires
   * about a document sitting visibly in the list, and gets steadily more wrong
   * the longer she stays on the page. A failed fetch skewed it the same way for
   * a different reason. Caught by /code-review.
   *
   * Ids have neither problem. The reload always asks for page 1 and the list is
   * newest-first, so a document that IS in view is necessarily on that page —
   * and one whose id was not there before is necessarily new.
   */
  const visibleIdsRef = useRef<ReadonlySet<string>>(
    new Set(initialDocuments.map((document) => document.id))
  );
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  /**
   * Which request is the current one. Incremented on dispatch and checked before
   * every `setState`, so a slow earlier response cannot land on top of a later
   * one — the debounce collapses a burst of keystrokes but does not stop two
   * requests being in flight when a search and a page change overlap.
   */
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchPage = useCallback(
    async (page: number, term: string, onlyUndesignated: boolean, afterAdd = false) => {
      // Captured synchronously, before the await: what was on screen when THIS
      // request went out, not whatever a later one has since installed.
      const idsBefore = visibleIdsRef.current;
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;

      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(meta.limit) });
        // Trimmed before the truthiness test: `q` is `.trim().min(1)` server-side,
        // so sending a space bar's worth of "search" is a 400 and an error banner
        // over a table that was fine.
        const trimmed = term.trim();
        if (trimmed) params.set('q', trimmed);
        if (onlyUndesignated) params.set('undesignatedOnly', 'true');

        const response = await fetch(`${DESIGNATION_ADMIN_ENDPOINT}?${params.toString()}`, {
          credentials: 'same-origin',
        });
        const parsed = await parseApiResponse<Row[]>(response);
        if (!parsed.success) throw new Error(parsed.error.message);

        // Superseded while in flight — drop it, including the loading flag: the
        // newer request owns the table now.
        if (requestSeqRef.current !== seq) return;

        setDocuments(parsed.data);
        const parsedMeta = parsePaginationMeta(parsed.meta);
        if (parsedMeta) setMeta(parsedMeta);
        setAppliedUndesignatedOnly(onlyUndesignated);
        setLoadFailed(false);

        const broughtSomethingNew = parsed.data.some((row) => !idsBefore.has(row.id));
        visibleIdsRef.current = new Set(parsed.data.map((row) => row.id));

        // Three conditions, and dropping any one of them put something untrue on
        // screen in review. It has to follow an ADD (a discard refreshes too,
        // and deletes a row); the page must have come back carrying no document
        // it did not already have (a filter check alone cries wolf on the common
        // path — filter on, untagged upload — where the new document IS in
        // view); and something must actually be narrowing the view, or there is
        // nothing to clear and nothing was added.
        const narrowedBySearch = term.trim() !== '';
        const hidden = afterAdd && (narrowedBySearch || onlyUndesignated) && !broughtSomethingNew;
        setAddedOutsideView(hidden ? { search: narrowedBySearch, filter: onlyUndesignated } : null);
      } catch {
        if (requestSeqRef.current !== seq) return;
        // Said out loud rather than swallowed: a table that keeps showing the
        // previous page after a failed fetch reads as "these are the matches".
        setError('The list did not load. Try again — the rows below may be out of date.');
        setLoadFailed(true);
      } finally {
        if (requestSeqRef.current === seq) setIsLoading(false);
      }
    },
    [meta.limit]
  );

  /**
   * Fetch now, and cancel any keystroke still waiting out its debounce.
   *
   * The sequence guard alone is not enough here, because the pending debounce is
   * the LATER request: flip the switch inside the 300 ms window and its fetch
   * goes out as seq N, then the debounce fires with the `undesignatedOnly` value
   * captured before the flip and wins as seq N+1. The table then shows every
   * document while the switch reads "on", and `appliedUndesignatedOnly` makes the
   * empty state describe a filter nobody asked for. Every immediate dispatch —
   * the toggle and both pager buttons — goes through here.
   */
  const dispatchFetch = useCallback(
    (page: number, term: string, onlyUndesignated: boolean, afterAdd = false) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      void fetchPage(page, term, onlyUndesignated, afterAdd);
    },
    [fetchPage]
  );

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchPage(1, value, undesignatedOnly);
    }, 300);
  };

  const onUndesignatedChange = (value: boolean) => {
    setUndesignatedOnly(value);
    dispatchFetch(1, search, value);
  };

  /**
   * Go and look again when the surface above says the corpus changed.
   *
   * Compared against a ref rather than run on mount: the effect's dependency
   * list has to carry `search` and `undesignatedOnly` — it reads both, and the
   * point is that a refresh keeps the filters she is looking through — so
   * without the guard every keystroke would fire a second, unfiltered-by-the-
   * debounce request behind the one `onSearchChange` already scheduled.
   *
   * Page 1, because the list is newest-first and the new document is on it.
   */
  const lastReloadToken = useRef(reloadSignal?.token ?? 0);
  useEffect(() => {
    const token = reloadSignal?.token ?? 0;
    if (lastReloadToken.current === token) return;
    lastReloadToken.current = token;
    dispatchFetch(1, search, undesignatedOnly, reloadSignal?.added ?? false);
  }, [reloadSignal, search, undesignatedOnly, dispatchFetch]);

  /**
   * Save one answer about one document.
   *
   * `undefined` for a field means "leave it alone" all the way down to the
   * service, so changing a purpose cannot clear a licensing note that happened to
   * be on screen. The row is replaced with what the server returns rather than
   * with what was sent — `quotable` is the server's to compute, and a client that
   * guessed it would be a second implementation of the rule.
   *
   * `retrieval` is deliberately NOT in the response and is left as it stands on
   * the row: a designation write changes what the rule permits, never what has
   * been chunked. Recomputing it here would be the client deriving the axis the
   * cell exists not to derive.
   *
   * Returns whether the write landed, so a caller holding unsaved text the admin
   * typed can keep it on a failure rather than discarding it into a banner.
   */
  const save = useCallback(
    async (
      documentId: string,
      patch: {
        purpose?: DocumentPurpose | null;
        sensitivity?: DocumentSensitivity | null;
        licensing?: string | null;
      }
    ): Promise<boolean> => {
      setSavingIds((ids) => new Set(ids).add(documentId));
      setError(null);
      try {
        const response = await fetch(`${DESIGNATION_ADMIN_ENDPOINT}/${documentId}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const parsed = await parseApiResponse<{
          designation: {
            purpose: DocumentPurpose | null;
            sensitivity: DocumentSensitivity | null;
            licensing: string | null;
            quotable: boolean;
          };
        }>(response);
        if (!parsed.success) throw new Error(parsed.error.message);

        const next = parsed.data.designation;
        setDocuments((rows) =>
          rows.map((row) =>
            row.id === documentId
              ? {
                  ...row,
                  purpose: next.purpose,
                  sensitivity: next.sensitivity,
                  licensing: next.licensing,
                  quotable: next.quotable,
                }
              : row
          )
        );
        return true;
      } catch (caught) {
        setError(
          caught instanceof Error
            ? `That did not save: ${caught.message}`
            : 'That did not save. Try again.'
        );
        return false;
      } finally {
        setSavingIds((ids) => {
          const next = new Set(ids);
          next.delete(documentId);
          return next;
        });
      }
    },
    []
  );

  const totalPages = Math.max(1, meta.totalPages);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor="designation-search">Search</Label>
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
            <Input
              id="designation-search"
              className="pl-8"
              placeholder="Document or file name"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id="undesignated-only"
            checked={undesignatedOnly}
            onCheckedChange={onUndesignatedChange}
          />
          <Label htmlFor="undesignated-only" className="cursor-pointer">
            Undesignated documents
          </Label>
          <FieldHelp title="Undesignated documents">
            A document with no purpose reaches nothing — not the search tool, not the voice
            examples. That is the safe default, but on screen it looks the same as a document that
            reaches everything, so this is how you find them.
          </FieldHelp>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {addedOutsideView && (
        <p role="status" className="text-muted-foreground text-sm">
          {/*
            A fact, then a conditional. Nothing here can tell a document hidden
            by the filter from an upload where every file errored — Sunrise's
            zone calls `onUploadComplete()` either way and passes no result — so
            the first sentence is true under both readings and the second does
            not claim the upload succeeded. The zone's own error sits directly
            above when it did not.
          */}
          Nothing new in the list below. If the upload succeeded, clear the{' '}
          {[
            addedOutsideView.search ? 'search' : null,
            addedOutsideView.filter ? 'Undesignated filter' : null,
          ]
            .filter((clause): clause is string => clause !== null)
            .join(' and the ')}{' '}
          to see it.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>
              Purpose{' '}
              <FieldHelp title="What is this document for?">
                <span className="space-y-2">
                  {DOCUMENT_PURPOSES.map((purpose) => (
                    <span key={purpose} className="block">
                      <strong>{PURPOSE_COPY[purpose].label}</strong> — {PURPOSE_COPY[purpose].help}
                    </span>
                  ))}
                </span>
              </FieldHelp>
            </TableHead>
            <TableHead>
              Sensitivity{' '}
              <FieldHelp title="How freely may it be used?">
                <span className="space-y-2">
                  {DOCUMENT_SENSITIVITIES.map((sensitivity) => (
                    <span key={sensitivity} className="block">
                      <strong>{SENSITIVITY_COPY[sensitivity].label}</strong> —{' '}
                      {SENSITIVITY_COPY[sensitivity].help}
                    </span>
                  ))}
                </span>
              </FieldHelp>
            </TableHead>
            <TableHead>
              Licensing{' '}
              <FieldHelp title="Whose words are these?">
                A free-text note: who wrote it, and on what terms we may use it. Nothing reads this
                automatically — it is here so the answer exists when somebody asks.
              </FieldHelp>
            </TableHead>
            <TableHead>
              Agent may quote{' '}
              <FieldHelp title="What this column means">
                <p>
                  Whether the agent&rsquo;s <code>search_knowledge_base</code> tool can retrieve
                  this document and quote it back in a reply. Yes for <strong>Knowledge</strong> and{' '}
                  <strong>Both</strong>; never for <strong>Voice</strong>, and never for anything
                  marked <strong>Client</strong>.
                </p>
                <p className="mt-2">
                  This is what the designation says, and it binds an agent whose knowledge access is{' '}
                  <strong>restricted</strong>. An agent left on the platform default of{' '}
                  <strong>full</strong> access searches everything and is not governed by this
                  column at all.
                </p>
                <p className="mt-2">
                  <strong>Two separate questions, and both have to hold.</strong> The designation
                  says whether the agent <em>may</em> quote it; the document itself decides whether
                  there is anything to quote. A document still being processed, one waiting on a
                  preview it will never get, and one that failed to parse all have no text in the
                  search index — so a permitted document with nothing behind it reads{' '}
                  <strong>Not yet</strong> or <strong>Nothing to quote</strong> rather than{' '}
                  <strong>Yes</strong>.
                </p>
              </FieldHelp>
            </TableHead>
            <TableHead>Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && documents.length === 0 && (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="text-muted-foreground py-8 text-center">
                Loading…
              </TableCell>
            </TableRow>
          )}

          {!isLoading && documents.length === 0 && (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="text-muted-foreground py-8 text-center">
                {loadFailed
                  ? 'The list could not be loaded, so this is not an answer about what is there.'
                  : appliedUndesignatedOnly
                    ? 'Every document has a purpose. Nothing is undesignated.'
                    : 'No training material yet. Add a document above, and it appears here for you to say what it is for.'}
              </TableCell>
            </TableRow>
          )}

          {documents.map((document) => (
            <TableRow key={document.id} className={savingIds.has(document.id) ? 'opacity-60' : ''}>
              <TableCell>
                <div className="font-medium">{document.name}</div>
                <div className="text-muted-foreground text-xs">
                  {document.fileName} · {document.chunkCount} chunks · {document.status}
                </div>
              </TableCell>

              <TableCell>
                <Select
                  value={document.purpose ?? UNSET}
                  disabled={savingIds.has(document.id)}
                  onValueChange={(value) =>
                    void save(document.id, {
                      purpose: value === UNSET ? null : (value as DocumentPurpose),
                    })
                  }
                >
                  <SelectTrigger className="w-36" aria-label={`Purpose of ${document.name}`}>
                    <SelectValue placeholder="Not designated" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not designated</SelectItem>
                    {DOCUMENT_PURPOSES.map((purpose) => (
                      <SelectItem key={purpose} value={purpose}>
                        {PURPOSE_COPY[purpose].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>

              <TableCell>
                <Select
                  value={document.sensitivity ?? UNSET}
                  disabled={savingIds.has(document.id)}
                  onValueChange={(value) =>
                    void save(document.id, {
                      sensitivity: value === UNSET ? null : (value as DocumentSensitivity),
                    })
                  }
                >
                  <SelectTrigger className="w-36" aria-label={`Sensitivity of ${document.name}`}>
                    <SelectValue placeholder="Not designated" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not designated</SelectItem>
                    {DOCUMENT_SENSITIVITIES.map((sensitivity) => (
                      <SelectItem key={sensitivity} value={sensitivity}>
                        {SENSITIVITY_COPY[sensitivity].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>

              <TableCell className="max-w-64">
                {licensingDraft?.id === document.id ? (
                  <div className="space-y-2">
                    <Textarea
                      aria-label={`Licensing note for ${document.name}`}
                      rows={3}
                      maxLength={LICENSING_MAX}
                      value={licensingDraft.text}
                      onChange={(event) =>
                        setLicensingDraft({ id: document.id, text: event.target.value })
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={savingIds.has(document.id)}
                        onClick={() => {
                          const text = licensingDraft.text;
                          // The editor closes only once the write has landed.
                          // Closing it first destroyed the note on any failure —
                          // and the text an admin loses that way is the one they
                          // just typed out of a permission email, unrecoverable.
                          void save(document.id, { licensing: text }).then((saved) => {
                            if (saved) setLicensingDraft(null);
                          });
                        }}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setLicensingDraft(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="link"
                    className="h-auto p-0 text-left text-sm whitespace-normal"
                    onClick={() =>
                      setLicensingDraft({ id: document.id, text: document.licensing ?? '' })
                    }
                  >
                    {document.licensing ?? (
                      <span className="text-muted-foreground">Add a note</span>
                    )}
                  </Button>
                )}
              </TableCell>

              <TableCell>
                {/*
                  Three answers, because there are two axes and they can
                  disagree. `quotable` is the rule's verdict and `retrieval` is
                  ingestion's; a document permitted by the first with nothing
                  behind the second used to render "Yes", which is the one thing
                  this column exists not to say.
                */}
                {!document.quotable ? (
                  <Badge variant="outline" className="text-muted-foreground gap-1">
                    <Ban className="h-3 w-3" aria-hidden="true" />
                    No
                  </Badge>
                ) : document.retrieval === 'retrievable' ? (
                  <Badge variant="default" className="gap-1">
                    <Quote className="h-3 w-3" aria-hidden="true" />
                    Yes
                  </Badge>
                ) : (
                  <>
                    <Badge variant="secondary" className="gap-1">
                      <CircleSlash className="h-3 w-3" aria-hidden="true" />
                      {RETRIEVAL_COPY[document.retrieval].label}
                    </Badge>
                    {/*
                      Capped, because a table column sizes to its widest cell:
                      an unconstrained sentence here drags this column wide and
                      squeezes the two selects an admin actually uses. The
                      fuller explanation is in the column's own help.
                    */}
                    <p className="text-muted-foreground mt-1 max-w-52 text-xs">
                      {RETRIEVAL_COPY[document.retrieval].reason}
                    </p>
                  </>
                )}
              </TableCell>

              <TableCell className="text-muted-foreground text-sm">
                <ClientDate date={document.createdAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {loadFailed ? '—' : `${meta.total} document${meta.total === 1 ? '' : 's'}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page <= 1 || isLoading}
            onClick={() => dispatchFetch(meta.page - 1, search, undesignatedOnly)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {meta.page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page >= totalPages || isLoading}
            onClick={() => dispatchFetch(meta.page + 1, search, undesignatedOnly)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
