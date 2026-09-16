'use client';

/**
 * What every document she uploaded is FOR, and whether the agent may quote it.
 *
 * The knowledge base at `/admin/orchestration/knowledge` can already take her
 * material in — the uploader, the bulk upload, fetch-from-URL and the parsers all
 * ship with the platform. What it cannot show is the distinction this feature
 * turns on: whether a document is something she KNOWS or something that shows how
 * she SOUNDS. This table is where that answer is given, and the `Agent may quote`
 * column is where the consequence of giving it is visible on the same screen.
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
  const [savingId, setSavingId] = useState<string | null>(null);
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
    async (page: number, term: string, onlyUndesignated: boolean) => {
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;

      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(meta.limit) });
        if (term) params.set('q', term);
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

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchPage(1, value, undesignatedOnly);
    }, 300);
  };

  const onUndesignatedChange = (value: boolean) => {
    setUndesignatedOnly(value);
    void fetchPage(1, search, value);
  };

  /**
   * Save one answer about one document.
   *
   * `undefined` for a field means "leave it alone" all the way down to the
   * service, so changing a purpose cannot clear a licensing note that happened to
   * be on screen. The row is replaced with what the server returns rather than
   * with what was sent — `quotable` is the server's to compute, and a client that
   * guessed it would be a second implementation of the rule.
   */
  const save = useCallback(
    async (
      documentId: string,
      patch: {
        purpose?: DocumentPurpose | null;
        sensitivity?: DocumentSensitivity | null;
        licensing?: string | null;
      }
    ) => {
      setSavingId(documentId);
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
      } catch (caught) {
        setError(
          caught instanceof Error
            ? `That did not save: ${caught.message}`
            : 'That did not save. Try again.'
        );
      } finally {
        setSavingId(null);
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
            Only ones nobody has answered for
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
                Whether the agent&rsquo;s <code>search_knowledge_base</code> tool can retrieve this
                document and quote it back in a reply. Yes for <strong>Knowledge</strong> and{' '}
                <strong>Both</strong>; never for <strong>Voice</strong>, and never for anything
                marked <strong>Client</strong>.
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
                    ? 'Every document has a purpose. Nothing is waiting on an answer.'
                    : 'No documents yet. Upload her material under AI Orchestration → Knowledge.'}
              </TableCell>
            </TableRow>
          )}

          {documents.map((document) => (
            <TableRow key={document.id} className={savingId === document.id ? 'opacity-60' : ''}>
              <TableCell>
                <div className="font-medium">{document.name}</div>
                <div className="text-muted-foreground text-xs">
                  {document.fileName} · {document.chunkCount} chunks · {document.status}
                </div>
              </TableCell>

              <TableCell>
                <Select
                  value={document.purpose ?? UNSET}
                  disabled={savingId === document.id}
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
                  disabled={savingId === document.id}
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
                      value={licensingDraft.text}
                      onChange={(event) =>
                        setLicensingDraft({ id: document.id, text: event.target.value })
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={savingId === document.id}
                        onClick={() => {
                          const text = licensingDraft.text;
                          setLicensingDraft(null);
                          void save(document.id, { licensing: text });
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
            onClick={() => void fetchPage(meta.page - 1, search, undesignatedOnly)}
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
            onClick={() => void fetchPage(meta.page + 1, search, undesignatedOnly)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
