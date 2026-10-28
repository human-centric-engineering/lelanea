'use client';

/**
 * WorkflowsTab (f-ops-views t-4b) — the module's event→workflow binding surface.
 *
 * Lists the workflows bound to the module's lifecycle events, and lets an operator bind an
 * event to a workflow, enable/disable a binding, or unbind. Pure UI over 07's shipped
 * `/modules/[slug]/workflows[/bindingId]` endpoints; the server owns all validation, and its
 * field errors surface via the shared `apiFieldErrors` helper. Built on the shared binding-tab
 * primitives ({@link useBindingRoster}, {@link useRowActions}, {@link RowConfirm}).
 *
 * Unlike agent seats, a workflow `eventType` is free-form (X1 — the module-lifecycle event
 * vocabulary belongs to f-engagement/08), so it is a text field, not a picker; and there is no
 * registration gate (binding needs only that the module and workflow exist). A binding to a
 * workflow with no published version is legal but flagged "won't fire yet". Editing an existing
 * binding's `inputTemplate` post-bind is deferred (set it at bind time). The PATCH supports it,
 * versioned: an editor sends the binding's `version` as `If-Match` and handles a 412 (Hub t-151).
 * The `enabled` toggle below writes no template and needs neither.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { FieldHelp } from '@/components/ui/field-help';
import { apiClient } from '@/lib/api/client';
import { apiFieldErrors } from '@/components/admin/framework/module-detail/api-field-errors';
import {
  ROSTER_LIMIT,
  useBindingRoster,
} from '@/components/admin/framework/module-detail/use-binding-roster';
import { RosterSearch } from '@/components/admin/framework/module-detail/roster-search';
import { useRowActions } from '@/components/admin/framework/module-detail/use-row-actions';
import { RowConfirm } from '@/components/admin/framework/module-detail/row-confirm';
import type { ModuleWorkflowBindingListItem } from '@/lib/framework/modules/view';

/** The minimal workflow fields the bind picker needs from the orchestration roster. */
interface WorkflowRosterItem {
  id: string;
  name: string;
  slug: string;
}

// `isTemplate=false` excludes template scaffolds — only real workflows are bindable.
const ROSTER_URL = `/api/v1/admin/orchestration/workflows?isActive=true&isTemplate=false&limit=${ROSTER_LIMIT}`;

interface WorkflowsTabProps {
  slug: string;
  /** The current bindings; `null` ⇒ that fetch failed (not an empty binding set). */
  bindings: ModuleWorkflowBindingListItem[] | null;
}

export function WorkflowsTab({ slug, bindings }: WorkflowsTabProps) {
  const router = useRouter();
  const base = `/api/v1/admin/framework/modules/${encodeURIComponent(slug)}/workflows`;

  const roster = useBindingRoster<WorkflowRosterItem>(ROSTER_URL, 'Failed to load workflows');
  const rows = useRowActions();

  const [adding, setAdding] = useState(false);
  const [workflowId, setWorkflowId] = useState('');
  const [eventType, setEventType] = useState('');
  const [inputTemplate, setInputTemplate] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function openForm() {
    setAdding(true);
    setErrors([]);
    setWorkflowId('');
    roster.reset();
    void roster.load();
  }

  async function bind(e: React.FormEvent) {
    e.preventDefault();
    if (!workflowId || eventType.trim() === '') {
      setErrors(['Choose a workflow and enter an event type.']);
      return;
    }
    // Parse the operator's template for JSON syntax only; the server re-validates its shape
    // (a JSON object), so we forward it as `unknown` rather than asserting a type on it.
    let parsedTemplate: unknown;
    let hasTemplate = false;
    const rawTemplate = inputTemplate.trim();
    if (rawTemplate !== '') {
      try {
        parsedTemplate = JSON.parse(rawTemplate);
        hasTemplate = true;
      } catch {
        setErrors(['Input template: invalid JSON.']);
        return;
      }
    }

    setBusy(true);
    setErrors([]);
    try {
      await apiClient.post(base, {
        body: {
          workflowId,
          eventType: eventType.trim(),
          enabled,
          ...(hasTemplate ? { inputTemplate: parsedTemplate } : {}),
        },
      });
      setWorkflowId('');
      setEventType('');
      setInputTemplate('');
      setEnabled(true);
      setAdding(false);
      router.refresh();
    } catch (err) {
      setErrors(apiFieldErrors(err, 'Failed to bind workflow'));
    } finally {
      setBusy(false);
    }
  }

  function toggleEnabled(binding: ModuleWorkflowBindingListItem) {
    void rows.run(
      binding.id,
      async () => {
        await apiClient.patch(`${base}/${binding.id}`, { body: { enabled: !binding.enabled } });
        router.refresh();
      },
      'Failed to update binding'
    );
  }

  function unbind(bindingId: string) {
    void rows.run(
      bindingId,
      async () => {
        await apiClient.delete(`${base}/${bindingId}`);
        router.refresh();
      },
      'Failed to unbind workflow'
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Workflows run when this module&rsquo;s lifecycle events fire. A binding to a workflow with
          no published version won&rsquo;t fire until it&rsquo;s published.
        </p>
        {!adding && (
          <Button size="sm" onClick={openForm}>
            Bind workflow
          </Button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={(e) => void bind(e)}
          className="bg-muted/40 space-y-4 rounded-md border p-4"
        >
          <RosterSearch
            roster={roster}
            noun="workflow"
            id="bind-workflow-search"
            onSearchChange={() => setWorkflowId('')}
          />

          {roster.error ? (
            <p className="text-destructive text-sm" role="alert">
              {roster.error}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bind-workflow">Workflow</Label>
                  <Select
                    value={workflowId}
                    onValueChange={setWorkflowId}
                    disabled={roster.roster === null}
                  >
                    <SelectTrigger id="bind-workflow" className="w-56">
                      <SelectValue
                        placeholder={roster.roster === null ? 'Loading…' : 'Select a workflow'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(roster.roster ?? []).map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="bind-event">Event type</Label>
                    <FieldHelp title="Event type">
                      The module-lifecycle event that fires this workflow (e.g.{' '}
                      <code>module.entered</code>, <code>module.completed</code>). Free-form — it
                      matches the event name the module emits.
                    </FieldHelp>
                  </div>
                  <Input
                    id="bind-event"
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    maxLength={100}
                    placeholder="module.entered"
                    className="w-56"
                  />
                </div>

                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  Enabled
                </label>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="bind-template">Input template (optional)</Label>
                  <FieldHelp title="Input template">
                    A static JSON object merged under the live event envelope when the workflow
                    runs. Leave blank for none.
                  </FieldHelp>
                </div>
                <Textarea
                  id="bind-template"
                  value={inputTemplate}
                  onChange={(e) => setInputTemplate(e.target.value)}
                  rows={3}
                  className="max-w-lg font-mono text-xs"
                  placeholder="{ }"
                />
              </div>
            </div>
          )}

          {roster.capped && !roster.error && roster.query === '' && (
            <p className="text-muted-foreground text-xs">
              Showing the first {ROSTER_LIMIT} workflows. If the one you want isn&rsquo;t listed,
              type above to search the full set.
            </p>
          )}

          {errors.length > 0 && (
            <ul className="text-destructive space-y-1 text-sm" role="alert">
              {errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={busy || roster.roster === null}>
              {busy ? 'Binding…' : 'Bind'}
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

      {rows.error && (
        <p className="text-destructive text-sm" role="alert">
          {rows.error}
        </p>
      )}

      {bindings === null ? (
        <p className="text-muted-foreground text-sm" role="alert">
          The current bindings couldn&rsquo;t be loaded. Try refreshing the page.
        </p>
      ) : bindings.length === 0 ? (
        <p className="text-muted-foreground text-sm">No workflows are bound yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead className="w-48">Event</TableHead>
                <TableHead className="w-56 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    {b.workflow ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{b.workflow.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {b.workflow.slug}
                        </span>
                        {!b.workflow.hasPublishedVersion && (
                          <Badge variant="outline">Won&rsquo;t fire yet</Badge>
                        )}
                        {!b.workflow.isActive && <Badge variant="outline">Inactive</Badge>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">
                        Unknown workflow (removed)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{b.eventType}</span>
                      {!b.enabled && <Badge variant="secondary">Disabled</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {rows.confirmingId === b.id ? (
                      <RowConfirm
                        busy={rows.busyId === b.id}
                        anyBusy={rows.busyId !== null}
                        onConfirm={() => unbind(b.id)}
                        onCancel={() => rows.setConfirmingId(null)}
                        busyLabel="Unbinding…"
                      />
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleEnabled(b)}
                          disabled={rows.locked}
                        >
                          {b.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => rows.setConfirmingId(b.id)}
                          disabled={rows.locked}
                        >
                          Unbind
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
