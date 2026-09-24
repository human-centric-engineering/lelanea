'use client';

/**
 * The pieces every content panel shares (f-content-seeds t-91): a labelled
 * field with its ⓘ help, the notice line, the dialog an item is edited in, an
 * item's history with restore, and the export / import panel.
 *
 * The history and import pieces are generic on purpose: a revision is the item
 * whole plus which fields changed, and an import plan is the same sections for
 * every collection, so one rendering serves all four editors.
 */

import { useState, type ReactNode } from 'react';
import { Download, History, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FieldHelp } from '@/components/ui/field-help';
import { ClientDate } from '@/components/ui/client-date';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { downloadExport, send } from '@/components/app/admin/content/client';
import {
  contentExportEndpoint,
  contentHistoryEndpoint,
  contentImportEndpoint,
  contentImportPreviewEndpoint,
  contentRestoreEndpoint,
  type ContentCollection,
} from '@/lib/app/content/admin/endpoint';
import type { ContentImportPlan } from '@/lib/app/content/admin/shared';

// ─── Fields and notices ─────────────────────────────────────────────────────

export function FieldRow({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        <FieldHelp title={label}>{help}</FieldHelp>
      </div>
      {children}
    </div>
  );
}

export type Notice = { tone: 'error' | 'ok' | 'warn'; text: string } | null;

export function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const tone =
    notice.tone === 'error'
      ? 'text-destructive'
      : notice.tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-emerald-700 dark:text-emerald-400';
  return (
    <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${tone}`}>
      {notice.text}
    </p>
  );
}

/** Who reads this, said before anyone removes it. */
export function ReadersNote({ readers, lead }: { readers: readonly string[]; lead: string }) {
  if (readers.length === 0) return null;
  return (
    <p className="text-muted-foreground text-xs">
      {lead} {readers.join('; ')}.
    </p>
  );
}

// ─── The edit dialog ────────────────────────────────────────────────────────

/**
 * An item opened for editing: its fields scroll, and the footer — the notice
 * and the Save button — stays in view however long the item is.
 */
export function EditDialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] max-w-5xl flex-col gap-0 p-0"
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        <div className="bg-background space-y-2 border-t px-6 py-3 sm:rounded-b-lg">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

interface RevisionJson {
  revision: number;
  snapshot: unknown;
  changedFields: string[];
  origin: string;
  editorEmail: string | null;
  changedAt: string;
}

/**
 * Every revision of one item, newest first, each restorable. A restore is a
 * new revision carrying the old words; nothing is rewound.
 */
export function HistoryButton({
  collection,
  entity,
  id,
  label,
  revisionRead,
  restoreNote,
  onRestored,
}: {
  collection: ContentCollection;
  entity: string;
  id: string;
  label: string;
  revisionRead: number;
  /** What a restore of this item also does, said before it is done. */
  restoreNote?: string;
  onRestored: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionJson[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setOpen(true);
    setNotice(null);
    const result = await send<{ revisions: RevisionJson[] }>(
      'GET',
      contentHistoryEndpoint(collection, entity, id)
    );
    if (result.ok) setRevisions(result.data.revisions);
    else setNotice({ tone: 'error', text: result.message });
  }

  async function restore(revision: number) {
    setBusy(true);
    const result = await send<{ changed: string[]; mintedVersion?: string | null }>(
      'POST',
      contentRestoreEndpoint(collection, entity, id),
      { revision, revisionRead }
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setOpen(false);
    onRestored(
      result.data.changed.length === 0
        ? `Revision ${revision} of ${label} is what it already says. Nothing was saved.`
        : `Restored ${label} to revision ${revision}, as a new revision.` +
            (result.data.mintedVersion
              ? ` It asks everyone to agree again, at version ${result.data.mintedVersion}.`
              : '')
    );
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
        <History className="mr-1 h-4 w-4" aria-hidden />
        History
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>History of {label}</DialogTitle>
            <DialogDescription>
              Every saved version, newest first. Restoring one saves its words again as a new
              version; nothing is lost.{restoreNote ? ` ${restoreNote}` : ''}
            </DialogDescription>
          </DialogHeader>
          <NoticeLine notice={notice} />
          {revisions === null ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <ol className="space-y-3">
              {revisions.map((entry) => (
                <li key={entry.revision} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Revision {entry.revision}</span>
                    <Badge variant="outline">
                      {entry.origin === 'seed'
                        ? 'seed'
                        : (entry.editorEmail ?? 'an admin whose account is gone')}
                    </Badge>
                    <span className="text-muted-foreground">
                      <ClientDate date={entry.changedAt} />
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1">
                    Changed: {entry.changedFields.join(', ')}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setExpanded(expanded === entry.revision ? null : entry.revision)
                      }
                    >
                      {expanded === entry.revision ? 'Hide' : 'Show'} this version
                    </Button>
                    {entry.revision !== revisionRead && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => void restore(entry.revision)}
                      >
                        Restore
                      </Button>
                    )}
                  </div>
                  {expanded === entry.revision && (
                    <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                      {JSON.stringify(entry.snapshot, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Export and import ──────────────────────────────────────────────────────

const UNPARSEABLE = Symbol('unparseable');

function PlanView({ plan }: { plan: ContentImportPlan }) {
  return (
    <div className="space-y-3 text-sm">
      {plan.refusals.length > 0 && (
        <div role="alert" className="border-destructive text-destructive rounded-md border p-3">
          <p className="font-medium">This file cannot be applied:</p>
          <ul className="mt-1 list-disc pl-5">
            {plan.refusals.map((refusal) => (
              <li key={refusal}>{refusal}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.writesNothing && plan.refusals.length === 0 && (
        <p className="text-muted-foreground">
          This file matches what is stored. Applying it would change nothing.
        </p>
      )}
      {plan.sections.map((section) => {
        const removalWord = section.removalKind === 'retire' ? 'Retire' : 'Delete';
        const lines: [string, { key: string; changedFields?: string[] }[]][] = [
          ['Add', section.creates],
          ['Change', section.updates],
          [removalWord, section.removals],
        ];
        return (
          <div key={section.entity}>
            <p className="font-medium">{section.label}</p>
            <ul className="text-muted-foreground list-disc pl-5">
              {lines.flatMap(([verb, items]) =>
                items.map((item) => (
                  <li key={`${verb}-${item.key}`}>
                    {verb} <code>{item.key}</code>
                    {verb === 'Change' && item.changedFields
                      ? `: ${item.changedFields.join(', ')}`
                      : ''}
                  </li>
                ))
              )}
              {section.unchanged.length > 0 && <li>{section.unchanged.length} unchanged</li>}
              {section.skippedRetired.length > 0 && (
                <li>
                  Left retired (a file cannot bring one back):{' '}
                  {section.skippedRetired.map((key) => (
                    <code key={key} className="mr-1">
                      {key}
                    </code>
                  ))}
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Download the collection as a file in the seed's shape, or bring a file in:
 * preview first, which writes nothing, then apply, which re-plans against the
 * rows as they stand and shows the plan that ran.
 */
export function ImportExportPanel({
  collection,
  fileName,
  what,
  onApplied,
}: {
  collection: ContentCollection;
  /** The file the seed reads this collection from, named in the help. */
  fileName: string;
  what: string;
  onApplied: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ContentImportPlan | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  function parsed(): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      setNotice({ tone: 'error', text: 'That is not valid JSON. Choose the whole file again.' });
      return UNPARSEABLE;
    }
  }

  async function exportFile() {
    setNotice(null);
    const result = await downloadExport(contentExportEndpoint(collection), fileName);
    if (!result.ok) setNotice({ tone: 'error', text: result.message });
  }

  async function chooseFile(file: File | undefined) {
    setPlan(null);
    setNotice(null);
    setText(file ? await file.text() : '');
  }

  async function preview() {
    const file = parsed();
    if (file === UNPARSEABLE) return;
    setBusy(true);
    const result = await send<{ plan: ContentImportPlan }>(
      'POST',
      contentImportPreviewEndpoint(collection),
      { file }
    );
    setBusy(false);
    if (result.ok) {
      setPlan(result.data.plan);
      setNotice(null);
    } else {
      setPlan(null);
      setNotice({ tone: 'error', text: result.message });
    }
  }

  async function apply() {
    const file = parsed();
    if (file === UNPARSEABLE) return;
    setBusy(true);
    const result = await send<{ plan: ContentImportPlan }>(
      'POST',
      contentImportEndpoint(collection),
      { file }
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setPlan(null);
    setText('');
    onApplied(
      result.data.plan.writesNothing
        ? 'The file matched what is stored. Nothing was written.'
        : `Imported ${what}. Every change is in each item's history, as your edit.`
    );
  }

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby={`${collection}-file`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${collection}-file`} className="font-medium">
          As a file
        </h3>
        <FieldHelp title="Export and import">
          The export is {what} as stored now, in the same shape as <code>{fileName}</code>, so it
          can be dropped into the seed folder or edited and brought back. Importing treats the file
          as the whole collection: anything stored and missing from the file is listed for removal.
          Preview first; it writes nothing.
        </FieldHelp>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void exportFile()}>
          <Download className="mr-1 h-4 w-4" aria-hidden />
          Export {what}
        </Button>
        <label className="text-sm">
          <span className="sr-only">Choose a file to import</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
            className="text-sm"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={busy || text === ''}
          onClick={() => void preview()}
        >
          <Upload className="mr-1 h-4 w-4" aria-hidden />
          Preview import
        </Button>
        <Button
          type="button"
          disabled={busy || plan === null || plan.refusals.length > 0 || plan.writesNothing}
          onClick={() => void apply()}
        >
          Apply import
        </Button>
      </div>
      <NoticeLine notice={notice} />
      {plan && <PlanView plan={plan} />}
    </section>
  );
}
