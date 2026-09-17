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
import { Ban, ChevronLeft, ChevronRight, Quote, Search } from 'lucide-react';

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
import type { DesignatedDocument } from '@/lib/app/voice/designation-admin';
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
   * Bumped by the surface above whenever something lands in the corpus.
   *
   * The table owns its own fetching, so an upload it knows nothing about would
   * otherwise leave it showing the list as it stood before — and the row missing
   * is exactly the document she just added, which reads as the upload having
   * failed. A counter rather than a callback handed upward: the parent says
   * *something changed*, and the table decides what to re-request, which keeps
   * the current search and filter rather than resetting them.
   */
  reloadToken?: number;
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
  reloadToken = 0,
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
   * diagnosis). Caught by /code-review.
   */
  const [addedOutsideView, setAddedOutsideView] = useState(false);
  /**
   * The row count the table last saw, for comparing against an upload's reload.
   *
   * A ref rather than reading `meta` inside `fetchPage`: `meta` is state the
   * fetch itself replaces, so a closure over it would compare the new total
   * against the one captured when the callback was last built.
   */
  const lastTotalRef = useRef(initialMeta.total);
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
    async (page: number, term: string, onlyUndesignated: boolean, afterUpload = false) => {
      const totalBefore = lastTotalRef.current;
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
        if (parsedMeta) {
          setMeta(parsedMeta);
          lastTotalRef.current = parsedMeta.total;
        }
        setAppliedUndesignatedOnly(onlyUndesignated);
        setLoadFailed(false);
        // Only an upload's own reload can answer this, and only by comparing:
        // "did the corpus this view can see actually grow?" A filter check alone
        // would cry wolf on the common path — the undesignated filter on, an
        // untagged upload — where the new document IS in view.
        setAddedOutsideView(
          afterUpload ? parsedMeta !== null && parsedMeta.total <= totalBefore : false
        );
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
    (page: number, term: string, onlyUndesignated: boolean, afterUpload = false) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      void fetchPage(page, term, onlyUndesignated, afterUpload);
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
  const lastReloadToken = useRef(reloadToken);
  useEffect(() => {
    if (lastReloadToken.current === reloadToken) return;
    lastReloadToken.current = reloadToken;
    dispatchFetch(1, search, undesignatedOnly, true);
  }, [reloadToken, search, undesignatedOnly, dispatchFetch]);

  /**
   * Save one answer about one document.
   *
   * `undefined` for a field means "leave it alone" all the way down to the
   * service, so changing a purpose cannot clear a licensing note that happened to
   * be on screen. The row is replaced with what the server returns rather than
   * with what was sent — `quotable` is the server's to compute, and a client that
   * guessed it would be a second implementation of the rule.
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
          Added — but it is not in the list below, because it does not match what you are looking
          through. Clear the search{appliedUndesignatedOnly ? ' or the Undesignated filter' : ''} to
          see it.
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
                {document.quotable ? (
                  <Badge variant="default" className="gap-1">
                    <Quote className="h-3 w-3" aria-hidden="true" />
                    Yes
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground gap-1">
                    <Ban className="h-3 w-3" aria-hidden="true" />
                    No
                  </Badge>
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
