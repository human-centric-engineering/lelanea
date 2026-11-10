'use client';

/**
 * KnowledgeTab (f-ops-views t-4c) — the module's knowledge-scope admin surface.
 *
 * A module owns a scope of documents and tags; every agent bound to the module inherits
 * search access to that set. This tab lists the granted documents and tags and lets an
 * operator grant (a document XOR a tag) or revoke. Pure UI over 07's shipped
 * `/modules/[slug]/knowledge` endpoint (`GET` scope, `POST` grant, `DELETE ?documentId|?tagId`
 * revoke); the server owns validation and invalidates the affected agents' access cache.
 *
 * Two structurally-identical sections (Documents, Tags) — same grant/revoke shape over
 * different targets — render through one generic {@link GrantSection}, each built on the
 * shared binding-tab primitives ({@link useBindingRoster}, {@link useRowActions},
 * {@link RowConfirm}). The whole scope degrades to a "couldn't load" state (a `null` scope),
 * never a false "nothing in scope".
 */

import { useState, type BaseSyntheticEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api/client';
import { SaveError } from '@/components/forms/form-error';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  ROSTER_LIMIT,
  useBindingRoster,
} from '@/components/admin/framework/module-detail/use-binding-roster';
import { RosterSearch } from '@/components/admin/framework/module-detail/roster-search';
import { useRowActions } from '@/components/admin/framework/module-detail/use-row-actions';
import { RowConfirm } from '@/components/admin/framework/module-detail/row-confirm';
import type { ModuleKnowledgeScopeView } from '@/lib/framework/modules/view';

/** The minimal fields the grant picker needs from a knowledge document / tag roster. */
interface KnowledgeRosterItem {
  id: string;
  name: string;
}

const DOC_ROSTER_URL = `/api/v1/admin/orchestration/knowledge/documents?limit=${ROSTER_LIMIT}`;
const TAG_ROSTER_URL = `/api/v1/admin/orchestration/knowledge/tags?limit=${ROSTER_LIMIT}`;

interface KnowledgeTabProps {
  slug: string;
  /** The scope; `null` ⇒ that fetch failed (not an empty scope). */
  scope: ModuleKnowledgeScopeView | null;
}

export function KnowledgeTab({ slug, scope }: KnowledgeTabProps) {
  const base = `/api/v1/admin/framework/modules/${encodeURIComponent(slug)}/knowledge`;

  if (scope === null) {
    return (
      <p className="text-muted-foreground text-sm" role="alert">
        The module&rsquo;s knowledge scope couldn&rsquo;t be loaded. Try refreshing the page.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-muted-foreground text-sm">
        Documents and tags in this module&rsquo;s knowledge scope. Every agent bound to the module
        inherits search access to this set.
      </p>

      <GrantSection
        title="Documents"
        noun="document"
        base={base}
        rosterUrl={DOC_ROSTER_URL}
        paramKey="documentId"
        items={scope.documents}
        itemKey={(d) => d.documentId}
        renderCell={(d) =>
          d.document ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.document.name}</span>
              <span className="text-muted-foreground font-mono text-xs">{d.document.slug}</span>
              <Badge variant="outline">{d.document.status}</Badge>
            </div>
          ) : (
            <span className="text-muted-foreground italic">Unknown document (removed)</span>
          )
        }
      />

      <GrantSection
        title="Tags"
        noun="tag"
        base={base}
        rosterUrl={TAG_ROSTER_URL}
        paramKey="tagId"
        items={scope.tags}
        itemKey={(t) => t.tagId}
        renderCell={(t) =>
          t.tag ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.tag.name}</span>
              <span className="text-muted-foreground font-mono text-xs">{t.tag.slug}</span>
            </div>
          ) : (
            <span className="text-muted-foreground italic">Unknown tag (removed)</span>
          )
        }
      />
    </div>
  );
}

interface GrantSectionProps<T> {
  title: string;
  /** The singular target noun for labels ("document" / "tag"). */
  noun: string;
  base: string;
  rosterUrl: string;
  /** The grant-body / revoke-query key for this target. */
  paramKey: 'documentId' | 'tagId';
  items: T[];
  itemKey: (item: T) => string;
  renderCell: (item: T) => ReactNode;
}

/**
 * One knowledge target kind (documents or tags): a granted-items table with per-row revoke +
 * an inline grant form whose picker roster loads on demand. Generic over the item shape; the
 * grant/revoke differ only by `paramKey`.
 */
function GrantSection<T>({
  title,
  noun,
  base,
  rosterUrl,
  paramKey,
  items,
  itemKey,
  renderCell,
}: GrantSectionProps<T>) {
  const router = useRouter();
  const roster = useBindingRoster<KnowledgeRosterItem>(rosterUrl, `Failed to load ${noun}s`);
  const rows = useRowActions();

  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const save = useSaveFailure({ fallback: `Failed to grant ${noun}`, fields: NO_SERVER_FIELDS });
  const [busy, setBusy] = useState(false);

  function openForm() {
    setAdding(true);
    save.clear();
    setSelectedId('');
    roster.reset();
    void roster.load();
  }

  async function grant(e?: BaseSyntheticEvent) {
    e?.preventDefault();
    if (!selectedId) {
      save.block([{ field: `grant-${paramKey}`, message: `Choose a ${noun}.` }]);
      return;
    }
    setBusy(true);
    try {
      await apiClient.post(base, { body: { [paramKey]: selectedId } });
      setSelectedId('');
      setAdding(false);
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      setBusy(false);
    }
  }

  function revoke(id: string) {
    void rows.run(
      id,
      async () => {
        await apiClient.delete(`${base}?${paramKey}=${encodeURIComponent(id)}`);
        router.refresh();
      },
      `Failed to revoke ${noun}`
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {!adding && (
          <Button size="sm" onClick={openForm}>
            Add {noun}
          </Button>
        )}
      </div>

      {adding && (
        <form
          method="post"
          noValidate
          onSubmit={save.submit(grant)}
          className="bg-muted/40 space-y-4 rounded-md border p-4"
        >
          <RosterSearch
            roster={roster}
            noun={noun}
            id={`grant-${paramKey}-search`}
            onSearchChange={() => setSelectedId('')}
          />

          {roster.error ? (
            <p className="text-destructive text-sm" role="alert">
              {roster.error}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`grant-${paramKey}`}>{title}</Label>
              <Select
                value={selectedId}
                onValueChange={setSelectedId}
                disabled={roster.roster === null}
              >
                <SelectTrigger id={`grant-${paramKey}`} className="w-72">
                  <SelectValue
                    placeholder={roster.roster === null ? 'Loading…' : `Select a ${noun}`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(roster.roster ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {roster.capped && !roster.error && roster.query === '' && (
            <p className="text-muted-foreground text-xs">
              Showing the first {ROSTER_LIMIT} {title.toLowerCase()}. If the one you want
              isn&rsquo;t listed, type above to search the full set.
            </p>
          )}

          <SaveError failure={save.failure} />

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={busy || roster.roster === null}>
              {busy ? 'Granting…' : 'Grant'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <SaveError failure={rows.failure} />

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No {title.toLowerCase()} in scope.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="capitalize">{noun}</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const id = itemKey(item);
                return (
                  <TableRow key={id}>
                    <TableCell>{renderCell(item)}</TableCell>
                    <TableCell className="text-right">
                      {rows.confirmingId === id ? (
                        <RowConfirm
                          busy={rows.busyId === id}
                          anyBusy={rows.busyId !== null}
                          onConfirm={() => revoke(id)}
                          onCancel={() => rows.setConfirmingId(null)}
                          busyLabel="Revoking…"
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => rows.setConfirmingId(id)}
                          disabled={rows.locked}
                        >
                          Revoke
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
    </section>
  );
}
