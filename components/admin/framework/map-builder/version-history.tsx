'use client';

/**
 * VersionHistory (f-map-editor t-4) — the map's published-version history in a dialog.
 * Lists immutable `FacilitationGraphVersion` rows (newest first) from
 * `GET /maps/[slug]/versions`, marks the live one (`publishedVersionId`), and lets an
 * author **roll back** to any prior version. Ports the framework module
 * `versions-tab.tsx` table + inline-confirm pattern into the editor.
 *
 * Rollback is delegated to the parent (`onRollback`) — the version service creates a
 * NEW version copying the target and pins it (history is never rewound), and the parent
 * reloads the canvas from that new snapshot. On success the list re-fetches so the new
 * live version appears; a refused rollback shows through `<SaveError>`, and the dialog stays open.
 *
 * The list loads once each time the dialog opens (a single request, not per-row).
 */

import { useCallback, useEffect, useState } from 'react';

import { headlineOnly } from '@/components/admin/framework/headline-only';
import { SaveError } from '@/components/forms/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient, APIClientError } from '@/lib/api/client';
import { useCommittedDialog } from '@/lib/hooks/use-committed-dialog';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { logger } from '@/lib/logging';

/** The version-row fields the history renders (the API returns the full row incl. the
 *  `definition` blob, which this view ignores). */
export interface MapVersionSummary {
  id: string;
  version: number;
  changeSummary: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface VersionsResponse {
  versions: MapVersionSummary[];
  publishedVersionId: string | null;
  nextCursor: string | null;
}

export interface VersionHistoryProps {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Roll back to a prior version; resolves on success, throws its message on failure. */
  onRollback: (targetVersion: number) => Promise<void>;
}

/** ISO string → deterministic UTC `YYYY-MM-DD HH:MM` (hydration-safe; see versions-tab). */
function formatDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function versionsPath(slug: string): string {
  return `/api/v1/admin/framework/maps/${encodeURIComponent(slug)}/versions`;
}

export function VersionHistory({ slug, open, onOpenChange, onRollback }: VersionHistoryProps) {
  const [versions, setVersions] = useState<MapVersionSummary[]>([]);
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [rolling, setRolling] = useState<number | null>(null);
  // The fallback can't say the rollback failed: it covers a lost answer, and a reload that failed
  // after the rollback committed. Trying again then would mint a second version.
  const save = useSaveFailure({
    fallback: "Couldn't confirm the rollback. Reload the page to see the live version.",
    fields: NO_SERVER_FIELDS,
  });
  const dialog = useCommittedDialog({
    open,
    pending: rolling !== null,
    onClose: () => onOpenChange(false),
    clear: save.clear,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<VersionsResponse>(versionsPath(slug));
      setVersions(data.versions);
      setPublishedVersionId(data.publishedVersionId);
    } catch (err) {
      const message =
        err instanceof APIClientError ? err.message : 'Failed to load version history';
      setError(message);
      logger.error('Map version history load failed', { slug, error: message });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Fetch the list each time the dialog opens; reset transient confirm state on close.
  useEffect(() => {
    if (open) {
      void load();
    } else {
      setConfirming(null);
      setError(null);
    }
  }, [open, load]);

  async function rollback(version: number) {
    setRolling(version);
    save.clear();
    try {
      await onRollback(version);
      setConfirming(null);
      // A rollback minted a new live version — refresh the list so it appears on top.
      await load();
    } catch (err) {
      // The parent rethrows the rollback's error, or the canvas reload's after it.
      save.report(headlineOnly(err));
      // The outcome may be unknown, so show what is live and leave nothing armed to click again.
      setConfirming(null);
      void load();
    } finally {
      setRolling(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={dialog.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
        </DialogHeader>

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <SaveError failure={save.failure} />

        {loading ? (
          <p className="text-muted-foreground py-6 text-center text-sm">Loading versions…</p>
        ) : versions.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            This map has no published versions yet.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Version</TableHead>
                  <TableHead>Change summary</TableHead>
                  <TableHead className="w-44">Published (UTC)</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => {
                  const isLive = v.id === publishedVersionId;
                  return (
                    <TableRow key={v.id} data-testid={`map-version-${v.version}`}>
                      <TableCell className="font-medium">
                        v{v.version}
                        {isLive && (
                          <Badge variant="secondary" className="ml-2">
                            live
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {v.changeSummary ?? <span className="italic">No summary</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDateTime(v.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isLive ? null : confirming === v.version ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => void rollback(v.version)}
                              disabled={rolling !== null}
                            >
                              {rolling === v.version ? 'Rolling back…' : 'Confirm'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirming(null)}
                              disabled={rolling !== null}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`map-rollback-${v.version}`}
                            onClick={() => {
                              save.clear();
                              setConfirming(v.version);
                            }}
                            disabled={rolling !== null}
                          >
                            Roll back
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
