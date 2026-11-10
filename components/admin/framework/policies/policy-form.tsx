'use client';

/**
 * PolicyFormDialog (f-admin-surfaces t-2) — create / edit a `FacilitationPolicy`.
 *
 * A dialog over the shipped CRUD API (`POST /facilitation/policies`,
 * `PATCH …/[policyId]`). A `kind` selector drives {@link PolicyKindFields}; on edit the
 * kind is IMMUTABLE (the API rejects a kind change — it is delete + create), so it is
 * shown read-only and only `payload` / `enabled` are sent. The client assembles the
 * payload for convenience; the server's `assertValidFacilitationPolicy` is the trust
 * boundary and its refusal shows by the form's buttons, through `<SaveError>`.
 *
 * The parent remounts this with a fresh `key` per open, so the `useState` initialisers
 * hydrate cleanly from `policy` (edit) or blank (create) without effect-syncing.
 */

import { useState, type BaseSyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import { SaveError } from '@/components/forms/form-error';
import { useCommittedDialog } from '@/lib/hooks/use-committed-dialog';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  FACILITATION_POLICY_KINDS,
  type FacilitationPolicyKind,
} from '@/lib/framework/facilitation/policies/kinds';
import type { FacilitationPolicyView } from '@/lib/framework/facilitation/policies/view';
import {
  PolicyKindFields,
  emptyPolicyState,
  hydratePolicyState,
  payloadFromState,
  type PolicyFieldState,
} from '@/components/admin/framework/policies/policy-kind-fields';

const POLICIES_URL = '/api/v1/admin/framework/facilitation/policies';

interface PolicyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The policy being edited, or `null` for create. */
  policy: FacilitationPolicyView | null;
  /** Called after a successful save so the parent can refresh the list. */
  onSaved: () => void;
}

export function PolicyFormDialog({ open, onOpenChange, policy, onSaved }: PolicyFormDialogProps) {
  const editing = policy !== null;

  const [kind, setKind] = useState<FacilitationPolicyKind>(
    policy?.kind ?? FACILITATION_POLICY_KINDS[0]
  );
  const [state, setState] = useState<PolicyFieldState>(() =>
    policy ? hydratePolicyState(policy.kind, policy.payload) : emptyPolicyState(kind)
  );
  const [enabled, setEnabled] = useState<boolean>(policy?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const save = useSaveFailure({ fallback: 'Failed to save the policy', fields: NO_SERVER_FIELDS });
  const dialog = useCommittedDialog({
    open,
    pending: submitting,
    onClose: () => onOpenChange(false),
    clear: save.clear,
  });

  // Changing the kind (create only) swaps in that kind's blank field set.
  function handleKindChange(next: string) {
    const k = next as FacilitationPolicyKind;
    setKind(k);
    setState(emptyPolicyState(k));
    save.clear();
  }

  async function handleSubmit(e?: BaseSyntheticEvent) {
    e?.preventDefault();
    setSubmitting(true);
    const payload = payloadFromState(kind, state);
    try {
      if (editing) {
        await apiClient.patch(`${POLICIES_URL}/${policy.id}`, { body: { payload, enabled } });
      } else {
        await apiClient.post(POLICIES_URL, { body: { kind, payload, enabled } });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      save.report(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={dialog.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form method="post" noValidate onSubmit={save.submit(handleSubmit)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit policy' : 'New policy'}</DialogTitle>
            <DialogDescription>
              {editing
                ? "A policy's kind is fixed — change the kind by deleting and recreating."
                : 'Choose a governance policy kind and fill in its parameters.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="policy-kind">Kind</Label>
                <FieldHelp title="Policy kind">
                  The policy&rsquo;s type — it determines which parameters below apply. Fixed once
                  created: to change a policy&rsquo;s kind, delete it and create a new one.
                </FieldHelp>
              </div>
              {editing ? (
                <p id="policy-kind" className="font-mono text-sm">
                  {kind}
                </p>
              ) : (
                <Select value={kind} onValueChange={handleKindChange}>
                  <SelectTrigger id="policy-kind" className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FACILITATION_POLICY_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <PolicyKindFields kind={kind} state={state} onChange={setState} />

            <div className="flex items-center gap-2">
              <Switch id="policy-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="policy-enabled">Enabled</Label>
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
            <Button type="submit" {...dialog.actionProps()}>
              {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create policy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
