'use client';

/**
 * VersionsTab (f-ops-views t-2).
 *
 * The config history: immutable `ModuleVersion` snapshots, newest first. The newest is
 * always the live config (no draft/published split), badged "current". Any prior version
 * can be **restored** — the server re-validates its snapshot against the module's current
 * schema and snapshots it forward as a new version (history is never rewound), so restoring
 * is reversible. `router.refresh()` after a restore re-fetches the page, prepending the new
 * version and re-keying the Config tab so it reflects the restored values.
 *
 * Shows the most recent page (≤50) the server returns; older-page pagination is deferred.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import type { ModuleVersionSummary } from '@/lib/framework/modules/view';

/** ISO string → deterministic UTC `YYYY-MM-DD HH:MM` (hydration-safe; see modules-table). */
function formatDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

interface VersionsTabProps {
  slug: string;
  versions: ModuleVersionSummary[];
  currentVersion: number;
}

export function VersionsTab({ slug, versions, currentVersion }: VersionsTabProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const save = useSaveFailure({ fallback: 'Failed to restore version', fields: NO_SERVER_FIELDS });

  if (versions.length === 0) {
    return <p className="text-muted-foreground text-sm">No config has been saved yet.</p>;
  }

  async function restore(version: number) {
    setRestoring(version);
    save.clear();
    try {
      await apiClient.post(
        `/api/v1/admin/framework/modules/${encodeURIComponent(slug)}/versions/${version}/restore`
      );
      setConfirming(null);
      router.refresh();
    } catch (err) {
      save.report(err, `Failed to restore v${version}`);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="space-y-4">
      <SaveError failure={save.failure} />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Version</TableHead>
              <TableHead>Change summary</TableHead>
              <TableHead className="w-44">Saved (UTC)</TableHead>
              <TableHead className="w-52 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => {
              const isCurrent = v.version === currentVersion;
              return (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">
                    v{v.version}
                    {isCurrent && (
                      <Badge variant="secondary" className="ml-2">
                        current
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
                    {isCurrent ? null : confirming === v.version ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => void restore(v.version)}
                          disabled={restoring !== null}
                        >
                          {restoring === v.version ? 'Restoring…' : 'Confirm'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(null)}
                          disabled={restoring !== null}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          save.clear();
                          setConfirming(v.version);
                        }}
                        disabled={restoring !== null}
                      >
                        Restore
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
