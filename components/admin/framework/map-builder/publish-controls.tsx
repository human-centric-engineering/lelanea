'use client';

/**
 * PublishControls (f-map-editor t-4) — the header cluster that promotes a map draft to
 * a new immutable version and opens the version history. Ports the orchestration
 * workflow-builder's publish UX (`publish-dialog.tsx` + toolbar) into the framework
 * tree: a **Publish** button opening a confirm dialog with an optional `changeSummary`
 * (max 500 chars, persisted on the new version row), plus a **History** button.
 *
 * Presentational: the **parent** owns the dialog open state (`open` / `onOpenChange`)
 * so it can close it directly on a successful publish and clear stale errors on
 * open/close (mirroring the workflow builder). This component owns only the summary
 * input, delegates the publish to `onPublish`, and surfaces the parent's `publishing` /
 * `errorMessage`. Publish promotes the **saved draft** — so it is only enabled when a
 * draft exists (`hasDraft`); an author saves, then publishes.
 */

import { useEffect, useState } from 'react';
import { Check, History } from 'lucide-react';

import { SaveError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SaveFailure } from '@/lib/errors/save-error';
import { useCommittedDialog } from '@/lib/hooks/use-committed-dialog';

const MAX_CHANGE_SUMMARY_CHARS = 500;

export interface PublishControlsProps {
  /** Whether there is a saved draft to promote. Gates the Publish button. */
  hasDraft: boolean;
  /** The version int that will be assigned on publish (display-only). */
  nextVersion: number;
  /** Dialog open state (parent-owned, so the parent can close it on success). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True while the publish request is in flight. */
  publishing: boolean;
  /** The refused publish; shown inside the dialog, which stays open. */
  failure: SaveFailure<never> | null;
  /** Clears `failure`; called as the dialog opens and closes. */
  clearFailure: () => void;
  /** Flash true briefly after a successful publish, for the "Published" indicator. */
  published: boolean;
  /** Promote the saved draft with an optional trimmed change summary. */
  onPublish: (changeSummary: string | undefined) => void | Promise<void>;
  /** Open the version-history dialog. */
  onOpenHistory: () => void;
}

export function PublishControls({
  hasDraft,
  nextVersion,
  open,
  onOpenChange,
  publishing,
  failure,
  clearFailure,
  published,
  onPublish,
  onOpenHistory,
}: PublishControlsProps) {
  const [summary, setSummary] = useState('');
  const dialog = useCommittedDialog({
    open,
    pending: publishing,
    onClose: () => onOpenChange(false),
    clear: clearFailure,
  });

  // Reset the input each time the dialog re-opens so a previous summary doesn't bleed
  // into the next publish.
  useEffect(() => {
    if (open) setSummary('');
  }, [open]);

  const trimmed = summary.trim();
  const tooLong = trimmed.length > MAX_CHANGE_SUMMARY_CHARS;
  const charsLeft = MAX_CHANGE_SUMMARY_CHARS - trimmed.length;

  const handleConfirm = () => {
    if (tooLong || publishing) return;
    void onPublish(trimmed.length > 0 ? trimmed : undefined);
  };

  return (
    <>
      {published && (
        <span
          data-testid="map-published-indicator"
          className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400"
        >
          <Check className="h-4 w-4" /> Published
        </span>
      )}
      <Button variant="outline" size="sm" data-testid="map-history-open" onClick={onOpenHistory}>
        <History className="mr-1.5 h-4 w-4" /> History
      </Button>
      <Button
        size="sm"
        data-testid="map-publish-open"
        onClick={() => onOpenChange(true)}
        disabled={!hasDraft}
      >
        Publish
      </Button>

      <Dialog open={open} onOpenChange={dialog.onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish draft</DialogTitle>
            <DialogDescription>
              Promotes the saved draft to <strong>version {nextVersion}</strong> and pins it live.
              The currently published version is preserved in the history and can be rolled back to.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="map-publish-summary">Change summary (optional)</Label>
            <Textarea
              id="map-publish-summary"
              data-testid="map-publish-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What changed in this version?"
              rows={3}
              disabled={publishing}
              aria-describedby="map-publish-summary-help"
            />
            <p
              id="map-publish-summary-help"
              className={'text-xs ' + (tooLong ? 'text-destructive' : 'text-muted-foreground')}
            >
              {tooLong
                ? `${-charsLeft} characters over the ${MAX_CHANGE_SUMMARY_CHARS} limit`
                : `${charsLeft} characters left`}
            </p>
          </div>

          <SaveError failure={failure} />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => dialog.onOpenChange(false)}
              {...dialog.cancelProps}
            >
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="map-publish-confirm"
              onClick={handleConfirm}
              {...dialog.actionProps({ disabled: tooLong })}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
