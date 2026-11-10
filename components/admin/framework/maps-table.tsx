'use client';

/**
 * MapsTable (f-map-editor t-1) — the facilitation-map list + a create dialog. A
 * searchable table of every map; each row links to its editor
 * (`/admin/framework/maps/[slug]`). Read-only listing (no per-row fetches — the list
 * endpoint is already enriched), plus a "New map" dialog that POSTs to the shipped
 * `POST /maps` endpoint and routes into the fresh map's editor.
 *
 * Create is the one write here because it is the only way to reach the editor on a
 * fresh fork (maps aren't seeded — "ship nothing a fork deletes"); the map backend
 * (create / save / publish / rollback) all shipped in f-map.
 */

import { useMemo, useState, type BaseSyntheticEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, Plus, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { headlineOnly } from '@/components/admin/framework/headline-only';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { useCommittedDialog } from '@/lib/hooks/use-committed-dialog';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { logger } from '@/lib/logging';

/** The map-list row shape the table reads (a structural subset of the API row). */
export interface MapListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  publishedVersionId: string | null;
  draftDefinition: unknown;
  updatedAt: string;
}

/** Deterministic `YYYY-MM-DD` (UTC) — hydration-safe in this SSR'd component. */
function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function statusBadge(map: MapListItem) {
  const hasDraft = map.draftDefinition !== null && map.draftDefinition !== undefined;
  if (map.publishedVersionId) {
    return hasDraft
      ? { label: 'Published · draft', variant: 'secondary' as const }
      : { label: 'Published', variant: 'outline' as const };
  }
  return hasDraft
    ? { label: 'Draft', variant: 'secondary' as const }
    : { label: 'Empty', variant: 'outline' as const };
}

interface MapsTableProps {
  initialMaps: MapListItem[];
}

export function MapsTable({ initialMaps }: MapsTableProps) {
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialMaps;
    return initialMaps.filter(
      (m) => m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q)
    );
  }, [initialMaps, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Search by name or slug…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            aria-label="Search maps"
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New map
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Analytics</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                  {initialMaps.length === 0
                    ? 'No facilitation maps yet. Create one to start authoring.'
                    : 'No maps match your search.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((map) => {
                const status = statusBadge(map);
                return (
                  <TableRow key={map.id}>
                    <TableCell>
                      <Link
                        href={`/admin/framework/maps/${encodeURIComponent(map.slug)}`}
                        className="font-medium hover:underline"
                      >
                        {map.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {map.slug}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant} className="text-xs">
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(map.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/framework/maps/${encodeURIComponent(map.slug)}/heat`}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm hover:underline"
                      >
                        <Flame className="h-3.5 w-3.5" /> Heat
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CreateMapDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/** Lowercase a → z, digits, single hyphens — the shape `slugSchema` accepts server-side. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function CreateMapDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Created and on its way to the editor: Create stays off, but the dialog can still close if the
  // navigation stalls, which `submitting` would forbid.
  const [created, setCreated] = useState(false);
  const save = useSaveFailure({ fallback: 'Failed to create the map', fields: NO_SERVER_FIELDS });

  // Mirror the name into the slug until the author edits the slug directly.
  const effectiveSlug = slugTouched ? slug : slugify(name);

  // The dialog stays mounted, so reset the form whenever it closes — otherwise a
  // half-filled-then-cancelled create reopens with the previous values.
  const dialog = useCommittedDialog({
    open,
    pending: submitting,
    onClose: () => {
      setName('');
      setSlug('');
      setSlugTouched(false);
      setDescription('');
      setCreated(false);
      onOpenChange(false);
    },
    clear: save.clear,
  });

  async function handleSubmit(e?: BaseSyntheticEvent) {
    e?.preventDefault();
    const finalSlug = slugify(effectiveSlug);
    const missing = !name.trim() ? 'map-name' : !finalSlug ? 'map-slug' : null;
    if (missing) {
      save.block([{ field: missing, message: 'A name and a slug are both required.' }]);
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/admin/framework/maps', {
        body: {
          slug: finalSlug,
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      });
      setCreated(true);
      router.push(`/admin/framework/maps/${encodeURIComponent(finalSlug)}`);
    } catch (err) {
      save.report(headlineOnly(err));
      logger.error('Map create failed', err, { slug: finalSlug });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={dialog.onOpenChange}>
      <DialogContent>
        <form method="post" noValidate onSubmit={save.submit(handleSubmit)}>
          <DialogHeader>
            <DialogTitle>New facilitation map</DialogTitle>
            <DialogDescription>
              Create an empty map, then author its nodes and edges on the canvas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="map-name">Name</Label>
              <Input
                id="map-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Onboarding journey"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="map-slug" className="flex items-center gap-1">
                Slug
                <FieldHelp title="Map slug">
                  <p>
                    The map&rsquo;s stable identifier — user journeys key on it, so it can&rsquo;t
                    change once journeys exist. Lowercase letters, digits, and hyphens only.
                  </p>
                </FieldHelp>
              </Label>
              <Input
                id="map-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="onboarding-journey"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="map-description">Description (optional)</Label>
              <Textarea
                id="map-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this map facilitates."
                rows={2}
              />
            </div>
            <SaveError failure={save.failure} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => dialog.onOpenChange(false)}
              {...dialog.cancelProps}
            >
              Cancel
            </Button>
            <Button type="submit" {...dialog.actionProps({ disabled: created })}>
              {submitting || created ? 'Creating…' : 'Create map'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
