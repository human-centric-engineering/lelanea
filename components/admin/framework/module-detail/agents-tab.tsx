'use client';

/**
 * AgentsTab (f-ops-views t-4a) — the module's agent-binding admin surface.
 *
 * Lists the agents bound into the module's seats (primary first), and lets an operator bind
 * an agent into a declared seat, promote a binding to the module's single lead seat, or
 * unbind. Pure UI over 07's shipped `/modules/[slug]/agents[/bindingId]` endpoints; the
 * server owns all validation (a role must be a declared seat, ≤ 1 primary per module, no
 * duplicate agent+seat), and its field errors surface on the form.
 *
 * Built on the shared binding-tab primitives ({@link useBindingRoster} searchable on-demand
 * picker, {@link useRowActions} row-lock/confirm state, {@link RowConfirm}) that the Workflows
 * and Knowledge tabs also use. Each binding also carries an optional per-binding `config`
 * override (a JSON object layered over the agent's config for this seat only) that an operator
 * can edit inline per row (f-admin-surfaces t-4).
 */

import { Fragment, useState, type BaseSyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
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
import type {
  ModuleAgentBindingListItem,
  ModuleAgentRolesView,
} from '@/lib/framework/modules/view';
import { SaveError } from '@/components/forms/form-error';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  ROSTER_LIMIT,
  useBindingRoster,
} from '@/components/admin/framework/module-detail/use-binding-roster';
import { RosterSearch } from '@/components/admin/framework/module-detail/roster-search';
import { useRowActions } from '@/components/admin/framework/module-detail/use-row-actions';
import { RowConfirm } from '@/components/admin/framework/module-detail/row-confirm';

/** The minimal agent fields the bind picker needs from the orchestration roster. */
interface AgentRosterItem {
  id: string;
  name: string;
  slug: string;
}

// `kind=chat` mirrors the agents list page: evaluation *judge* agents are not runtime agents,
// so they must not be offered as bindable module seats.
const ROSTER_URL = `/api/v1/admin/orchestration/agents?isActive=true&kind=chat&limit=${ROSTER_LIMIT}`;

interface AgentsTabProps {
  slug: string;
  /** The declared seats + registration; `null` ⇒ the seats fetch failed (not "unregistered"). */
  agentRoles: ModuleAgentRolesView | null;
  /** The current bindings; `null` ⇒ that fetch failed (not an empty binding set). */
  bindings: ModuleAgentBindingListItem[] | null;
}

export function AgentsTab({ slug, agentRoles, bindings }: AgentsTabProps) {
  const router = useRouter();
  const base = `/api/v1/admin/framework/modules/${encodeURIComponent(slug)}/agents`;

  const roster = useBindingRoster<AgentRosterItem>(ROSTER_URL, 'Failed to load agents');
  const rows = useRowActions();

  const [adding, setAdding] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [role, setRole] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const save = useSaveFailure({ fallback: 'Failed to bind agent', fields: NO_SERVER_FIELDS });
  const [busy, setBusy] = useState(false);

  // Per-binding `config` editor: at most one row's editor is open at a time.
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState('');
  const configSave = useSaveFailure({
    fallback: 'Failed to save config',
    fields: NO_SERVER_FIELDS,
  });
  const [configBusy, setConfigBusy] = useState(false);

  // Row actions gate on a busy/confirm state OR an open config editor, so a config edit can't be
  // interleaved with a make-primary / unbind into two concurrent mutations.
  const rowLock = rows.locked || editingConfigId !== null;

  // `null` agentRoles = the seats fetch failed → we can't offer the bind form, but this is a
  // distinct "couldn't load" state, NOT the false "module is unregistered" claim.
  const registered = agentRoles?.registered ?? false;
  const roles = agentRoles?.roles ?? [];
  const canBind = agentRoles !== null && registered && roles.length > 0;

  function openForm() {
    setAdding(true);
    save.clear();
    setAgentId('');
    roster.reset();
    void roster.load();
  }

  async function bind(e?: BaseSyntheticEvent) {
    e?.preventDefault();
    if (!agentId || !role) {
      save.block([
        { field: agentId ? 'bind-role' : 'bind-agent', message: 'Choose an agent and a seat.' },
      ]);
      return;
    }
    setBusy(true);
    try {
      await apiClient.post(base, { body: { agentId, role, isPrimary } });
      setAgentId('');
      setRole('');
      setIsPrimary(false);
      setAdding(false);
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      setBusy(false);
    }
  }

  function makePrimary(bindingId: string) {
    void rows.run(
      bindingId,
      async () => {
        await apiClient.patch(`${base}/${bindingId}`, { body: { isPrimary: true } });
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
      'Failed to unbind agent'
    );
  }

  function openConfig(binding: ModuleAgentBindingListItem) {
    setEditingConfigId(binding.id);
    configSave.clear();
    setConfigDraft(binding.config ? JSON.stringify(binding.config, null, 2) : '');
  }

  function closeConfig() {
    setEditingConfigId(null);
    configSave.clear();
  }

  async function saveConfig(bindingId: string) {
    configSave.clear();
    // An empty editor clears the override (`config: null`); otherwise the text must parse to a
    // JSON *object* (the server's `config` schema). We forward the parsed value as-is and let
    // the server re-validate — the client parse is convenience, not the trust boundary.
    const raw = configDraft.trim();
    let config: Record<string, unknown> | null = null;
    if (raw !== '') {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        configSave.block([{ field: `config-${bindingId}`, message: 'Config: invalid JSON.' }]);
        return;
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        configSave.block([
          { field: `config-${bindingId}`, message: 'Config must be a JSON object.' },
        ]);
        return;
      }
      config = value as Record<string, unknown>;
    }

    setConfigBusy(true);
    try {
      await apiClient.patch(`${base}/${bindingId}`, { body: { config } });
      setEditingConfigId(null);
      router.refresh();
    } catch (err) {
      configSave.report(err);
    } finally {
      setConfigBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Agents bound into this module&rsquo;s seats. The primary seat is the module&rsquo;s lead
          agent.
        </p>
        {canBind && !adding && (
          <Button size="sm" onClick={openForm}>
            Bind agent
          </Button>
        )}
      </div>

      {agentRoles === null && (
        <p className="text-muted-foreground text-sm" role="alert">
          The module&rsquo;s seats couldn&rsquo;t be loaded, so the bind form is unavailable. Try
          refreshing the page.
        </p>
      )}
      {agentRoles !== null && !registered && (
        <p className="text-muted-foreground text-sm">
          This module&rsquo;s code is not registered, so agents can&rsquo;t be bound. Existing
          bindings are shown for cleanup.
        </p>
      )}
      {agentRoles !== null && registered && roles.length === 0 && (
        <p className="text-muted-foreground text-sm">This module declares no agent seats.</p>
      )}

      {adding && canBind && (
        <form
          method="post"
          noValidate
          onSubmit={save.submit(bind)}
          className="bg-muted/40 space-y-4 rounded-md border p-4"
        >
          <RosterSearch
            roster={roster}
            noun="agent"
            id="bind-agent-search"
            onSearchChange={() => setAgentId('')}
          />

          {roster.error ? (
            <p className="text-destructive text-sm" role="alert">
              {roster.error}
            </p>
          ) : (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="bind-agent">Agent</Label>
                <Select
                  value={agentId}
                  onValueChange={setAgentId}
                  disabled={roster.roster === null}
                >
                  <SelectTrigger id="bind-agent" className="w-56">
                    <SelectValue
                      placeholder={roster.roster === null ? 'Loading…' : 'Select an agent'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(roster.roster ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bind-role">Seat</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="bind-role" className="w-48">
                    <SelectValue placeholder="Select a seat" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                />
                Primary seat
              </label>
            </div>
          )}

          {roster.capped && !roster.error && roster.query === '' && (
            <p className="text-muted-foreground text-xs">
              Showing the first {ROSTER_LIMIT} agents. If the one you want isn&rsquo;t listed, type
              above to search the full set.
            </p>
          )}

          <SaveError failure={save.failure} />

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

      <SaveError failure={rows.failure} />

      {bindings === null ? (
        <p className="text-muted-foreground text-sm" role="alert">
          The current bindings couldn&rsquo;t be loaded. Try refreshing the page.
        </p>
      ) : bindings.length === 0 ? (
        <p className="text-muted-foreground text-sm">No agents are bound yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="w-40">Seat</TableHead>
                <TableHead className="w-72 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <Fragment key={b.id}>
                  <TableRow>
                    <TableCell>
                      {b.agent ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{b.agent.name}</span>
                          <span className="text-muted-foreground font-mono text-xs">
                            {b.agent.slug}
                          </span>
                          {b.agent.deletedAt && <Badge variant="destructive">Deleted</Badge>}
                          {!b.agent.deletedAt && !b.agent.isActive && (
                            <Badge variant="outline">Inactive</Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">
                          Unknown agent (removed)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{b.role}</span>
                        {b.isPrimary && <Badge variant="secondary">Primary</Badge>}
                        {b.config && <Badge variant="outline">Config</Badge>}
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
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!b.isPrimary && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => makePrimary(b.id)}
                              disabled={rowLock}
                            >
                              Make primary
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openConfig(b)}
                            disabled={rowLock}
                          >
                            Edit config
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => rows.setConfirmingId(b.id)}
                            disabled={rowLock}
                          >
                            Unbind
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>

                  {editingConfigId === b.id && (
                    <TableRow>
                      <TableCell colSpan={3} className="bg-muted/30">
                        <div className="space-y-3 py-1">
                          <div className="flex items-center gap-1.5">
                            <Label htmlFor={`config-${b.id}`}>Binding config (JSON)</Label>
                            <FieldHelp title="Binding config">
                              An optional JSON object layered over this agent&rsquo;s config for
                              this module seat only (e.g. tone or persona hints). Leave it empty to
                              clear the override.
                            </FieldHelp>
                          </div>
                          <Textarea
                            id={`config-${b.id}`}
                            value={configDraft}
                            onChange={(e) => setConfigDraft(e.target.value)}
                            rows={5}
                            className="max-w-lg font-mono text-xs"
                            placeholder="{ }"
                          />
                          <SaveError failure={configSave.failure} />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => void saveConfig(b.id)}
                              disabled={configBusy}
                            >
                              {configBusy ? 'Saving…' : 'Save config'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={closeConfig}
                              disabled={configBusy}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
