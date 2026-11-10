'use client';

/**
 * PoliciesTable (f-admin-surfaces t-2) — the `FacilitationPolicy` admin list.
 *
 * A table of every governance policy (enabled or not) over the shipped CRUD API. Each
 * row shows its kind, a compact payload summary, an enable/disable toggle
 * (`PATCH { enabled }`), and edit / delete actions. Create and edit open the shared
 * {@link PolicyFormDialog}; delete is gated behind the shared two-step row confirm
 * ({@link useRowActions} / {@link RowConfirm}), the same primitives the module binding
 * tabs use. Read listing is the full pre-fetched set (policy counts are small), filtered
 * client-side by kind; mutations `router.refresh()` to re-pull the server list.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { FACILITATION_POLICY_KINDS } from '@/lib/framework/facilitation/policies/kinds';
import type { FacilitationPolicyView } from '@/lib/framework/facilitation/policies/view';
import { SaveError } from '@/components/forms/form-error';
import { useRowActions } from '@/components/admin/framework/module-detail/use-row-actions';
import { RowConfirm } from '@/components/admin/framework/module-detail/row-confirm';
import { PolicyFormDialog } from '@/components/admin/framework/policies/policy-form';
import { asRecord, disp } from '@/components/admin/framework/policies/payload-utils';

const POLICIES_URL = '/api/v1/admin/framework/facilitation/policies';
/** The "no kind filter" sentinel — Radix Select forbids an empty item value. */
const ALL_KINDS = '__all__';

/** Deterministic `YYYY-MM-DD` (UTC) — hydration-safe in this SSR'd component. */
function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** A compact one-line summary of a policy's payload for the list, read defensively. */
function summarize(policy: FacilitationPolicyView): string {
  const p = asRecord(policy.payload) ?? {};
  const scopeId = asRecord(p.scope)?.id;
  switch (policy.kind) {
    case 'auto_approval':
      return `auto-approve: ${disp(p.autoApprove)}`;
    case 'relevance_gating': {
      const roles = Array.isArray(p.allowedRoles) ? p.allowedRoles.map(disp).join(', ') : '—';
      return `${disp(p.graphSlug)} → ${roles}`;
    }
    case 'guard_minimum': {
      const mins = asRecord(p.minimums);
      const parts = mins ? Object.entries(mins).map(([g, m]) => `${g}: ${disp(m)}`) : [];
      return `${disp(scopeId)} · ${parts.join(', ') || 'no minimums'}`;
    }
    case 'escalation': {
      const signal = asRecord(p.signal);
      return `${disp(scopeId)} · ${disp(signal?.guard)}/${disp(signal?.outcome)} · ${disp(p.priority)}`;
    }
    default:
      return '—';
  }
}

interface PoliciesTableProps {
  initialPolicies: FacilitationPolicyView[];
}

export function PoliciesTable({ initialPolicies }: PoliciesTableProps) {
  const router = useRouter();
  const rows = useRowActions();

  const [kindFilter, setKindFilter] = useState<string>(ALL_KINDS);
  // The dialog is remounted per open (a bumped `key`) so it hydrates cleanly from the
  // selected policy — `null` = create.
  const [form, setForm] = useState<{
    open: boolean;
    policy: FacilitationPolicyView | null;
    key: number;
  }>({
    open: false,
    policy: null,
    key: 0,
  });

  const filtered = useMemo(
    () =>
      kindFilter === ALL_KINDS
        ? initialPolicies
        : initialPolicies.filter((p) => p.kind === kindFilter),
    [initialPolicies, kindFilter]
  );

  function openCreate() {
    setForm((f) => ({ open: true, policy: null, key: f.key + 1 }));
  }

  function openEdit(policy: FacilitationPolicyView) {
    setForm((f) => ({ open: true, policy, key: f.key + 1 }));
  }

  function toggleEnabled(policy: FacilitationPolicyView) {
    void rows.run(
      policy.id,
      async () => {
        await apiClient.patch(`${POLICIES_URL}/${policy.id}`, {
          body: { enabled: !policy.enabled },
        });
        router.refresh();
      },
      'Failed to update the policy'
    );
  }

  function deletePolicy(id: string) {
    void rows.run(
      id,
      async () => {
        await apiClient.delete(`${POLICIES_URL}/${id}`);
        router.refresh();
      },
      'Failed to delete the policy'
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="policy-kind-filter" className="text-muted-foreground text-sm">
            Kind
          </Label>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger id="policy-kind-filter" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KINDS}>All kinds</SelectItem>
              {FACILITATION_POLICY_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> New policy
        </Button>
      </div>

      <SaveError failure={rows.failure} />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-24">Enabled</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-52 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                  {initialPolicies.length === 0
                    ? 'No governance policies yet. Create one to start.'
                    : 'No policies of this kind.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {policy.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate text-sm">
                    {summarize(policy)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={policy.enabled}
                      disabled={rows.locked}
                      onCheckedChange={() => toggleEnabled(policy)}
                      aria-label={`Toggle ${policy.kind} policy`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(policy.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {rows.confirmingId === policy.id ? (
                      <RowConfirm
                        busy={rows.busyId === policy.id}
                        anyBusy={rows.busyId !== null}
                        onConfirm={() => deletePolicy(policy.id)}
                        onCancel={() => rows.setConfirmingId(null)}
                        confirmLabel="Delete"
                        busyLabel="Deleting…"
                      />
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(policy)}
                          disabled={rows.locked}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => rows.setConfirmingId(policy.id)}
                          disabled={rows.locked}
                        >
                          Delete
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

      <PolicyFormDialog
        key={form.key}
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        policy={form.policy}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
