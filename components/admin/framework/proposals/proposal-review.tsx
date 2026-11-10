'use client';

/**
 * ProposalReview (f-admin-surfaces t-3) — the structure-change proposal detail + decision.
 *
 * Shows a proposal's metadata (subject, author, risk, base version, status, and — once
 * decided — reviewer / reason / published version) plus a **structured JSON view** of the
 * proposed map definition. A visual before/after map-diff is deliberately out of scope for
 * v1.1 (decision D) — this renders the proposed snapshot as-is.
 *
 * When the proposal is still `pending`, an operator can **approve** it (→ `POST …/approve`,
 * which validates + publishes a new map version server-side, author preserved) or **reject**
 * it with a required reason (→ `POST …/reject`). Both go through the shipped API — the server
 * owns the state transition + conflict checks, so a stale decision (already decided, or the
 * map moved) shows the server's message inside the dialog, which stays open. On success the page re-pulls
 * (`router.refresh()`), so the decided status + its buttons update from the server truth.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import { headlineOnly } from '@/components/admin/framework/headline-only';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { useCommittedDialog } from '@/lib/hooks/use-committed-dialog';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import type { StructureChangeProposalView } from '@/lib/framework/facilitation/emergence/view';
import {
  AuthorLabel,
  StatusBadge,
} from '@/components/admin/framework/proposals/proposal-view-helpers';

const PROPOSALS_URL = '/api/v1/admin/framework/facilitation/proposals';

/** Deterministic `YYYY-MM-DD HH:MM` (UTC) — hydration-safe (no locale/timezone drift). */
function formatDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

interface ProposalReviewProps {
  proposal: StructureChangeProposalView;
}

export function ProposalReview({ proposal }: ProposalReviewProps) {
  const router = useRouter();

  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = useSaveFailure({
    fallback: 'Failed to record the decision',
    fields: NO_SERVER_FIELDS,
  });
  const dialog = useCommittedDialog({
    open: confirming !== null,
    pending: busy,
    onClose: () => {
      setConfirming(null);
      setReason('');
    },
    clear: save.clear,
  });

  const isPending = proposal.status === 'pending';

  async function approve() {
    setBusy(true);
    save.clear();
    try {
      await apiClient.post(`${PROPOSALS_URL}/${proposal.id}/approve`);
      setConfirming(null);
      router.refresh();
    } catch (err) {
      save.report(headlineOnly(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!reason.trim()) return;
    setBusy(true);
    save.clear();
    try {
      await apiClient.post(`${PROPOSALS_URL}/${proposal.id}/reject`, {
        body: { reason: reason.trim() },
      });
      setConfirming(null);
      setReason('');
      router.refresh();
    } catch (err) {
      save.report(headlineOnly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/framework/proposals"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to proposals
      </Link>

      <section className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Subject" mono value={`${proposal.subjectType}:${proposal.subjectId}`} />
        <div>
          <p className="text-muted-foreground text-xs">Author</p>
          <div className="mt-0.5">
            <AuthorLabel createdBy={proposal.createdBy} />
          </div>
        </div>
        <Field label="Risk" value={proposal.riskClass} />
        <div>
          <p className="text-muted-foreground text-xs">Status</p>
          <div className="mt-0.5">
            <StatusBadge status={proposal.status} />
          </div>
        </div>
        <Field
          label="Base version"
          value={
            proposal.baseVersion === null ? '— (no published version)' : `v${proposal.baseVersion}`
          }
        />
        <Field label="Raised" value={formatDateTime(proposal.createdAt)} />
        {proposal.reviewedBy && <Field label="Reviewed by" mono value={proposal.reviewedBy} />}
        {proposal.publishedVersionId && (
          <Field label="Published version" mono value={proposal.publishedVersionId} />
        )}
      </section>

      {proposal.rejectionReason && (
        <section className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
          <p className="text-muted-foreground text-xs font-medium">Rejection reason</p>
          <p className="mt-1 text-sm">{proposal.rejectionReason}</p>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Proposed definition{' '}
          <FieldHelp title="Proposed definition" contentClassName="w-96">
            <p>
              The full proposed map definition (a whole-map snapshot) this proposal would publish
              against{' '}
              {proposal.baseVersion === null
                ? 'the first published version'
                : `base version v${proposal.baseVersion}`}
              .
            </p>
            <p className="mt-2">
              A visual before/after map diff is not shown here — approving validates and publishes
              this snapshot as a new map version.
            </p>
          </FieldHelp>
        </h2>
        <pre className="bg-muted/40 max-h-[32rem] overflow-auto rounded-md border p-3 font-mono text-xs">
          {JSON.stringify(proposal.proposedDefinition, null, 2)}
        </pre>
      </section>

      {isPending && (
        <section className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1 text-green-700 hover:bg-green-50 hover:text-green-800 dark:text-green-400 dark:hover:bg-green-950 dark:hover:text-green-300"
            onClick={() => setConfirming('approve')}
          >
            <CheckCircle2 className="h-4 w-4" /> Approve &amp; publish
          </Button>
          <Button
            variant="outline"
            className="gap-1 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
            onClick={() => {
              setReason('');
              setConfirming('reject');
            }}
          >
            <XCircle className="h-4 w-4" /> Reject
          </Button>
        </section>
      )}

      {/* Approve confirm — publishes a new map version server-side. */}
      <AlertDialog open={confirming === 'approve'} onOpenChange={dialog.onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve &amp; publish this proposal?</AlertDialogTitle>
            <AlertDialogDescription>
              The proposed definition is validated and published as a new version of the{' '}
              <span className="font-mono">{proposal.subjectId}</span> map. The change&apos;s author
              is preserved. This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <SaveError failure={save.failure} />
          <AlertDialogFooter>
            <AlertDialogCancel {...dialog.cancelProps}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => dialog.confirm(e, approve)}
              {...dialog.actionProps()}
              className="bg-green-600 hover:bg-green-700"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Approve &amp; publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject confirm — reason required. */}
      <AlertDialog open={confirming === 'reject'} onOpenChange={dialog.onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this proposal?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing is published. A reason is required and recorded on the proposal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">
              Reason <span className="text-destructive">*</span>{' '}
              <FieldHelp title="Rejection reason">
                A clear explanation of why this proposal is being rejected. It is stored on the
                proposal and recorded in the audit trail.
              </FieldHelp>
            </Label>
            <Textarea
              id="reject-reason"
              placeholder="The proposed change conflicts with…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          <SaveError failure={save.failure} />
          <AlertDialogFooter>
            <AlertDialogCancel {...dialog.cancelProps}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => dialog.confirm(e, reject)}
              {...dialog.actionProps({ disabled: !reason.trim() })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A labelled read-only field. */
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={mono ? 'font-mono text-sm break-all' : 'text-sm'}>{value}</p>
    </div>
  );
}
