'use client';

/**
 * Her foundational documents, edited (f-content-seeds t-91).
 *
 * Each document opens, in a dialog, into its fields and its blocks, edited block by block so
 * the single-line cadence of the welcome survives: a paragraph is one block and
 * stays one. Three things are said before they happen rather than after:
 *
 * - a document a surface renders has no Delete, and says which surfaces;
 * - a section key code selects by is marked, and the save is refused if it goes;
 * - a save that changes the words of the Disclaimer or the Terms says, beside
 *   the Save button, which new version it will mint and that everyone will be
 *   asked to agree again.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { FieldHelp } from '@/components/ui/field-help';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BlocksEditor } from '@/components/app/admin/content/blocks-editor';
import { orNull, send } from '@/components/app/admin/content/client';
import {
  EditDialog,
  FieldRow,
  HistoryButton,
  ImportExportPanel,
  NoticeLine,
  ReadersNote,
  type Notice,
} from '@/components/app/admin/content/parts';
import { contentItemEndpoint, contentOrderEndpoint } from '@/lib/app/content/admin/endpoint';
import { nextAcknowledgementVersion } from '@/lib/app/content/admin/ack-version';
import type { DocumentAdminRow, DocumentsAdminView } from '@/lib/app/content/admin/documents';
import type { StoredDocumentBlock } from '@/lib/app/content/schemas';

type Block = StoredDocumentBlock;

const CATEGORIES = ['onboarding', 'about', 'legal'] as const;

// ─── One document ───────────────────────────────────────────────────────────

interface Draft {
  title: string;
  subtitle: string;
  category: DocumentAdminRow['category'];
  surface: string;
  placeholders: string;
  renderStyle: string;
  renderNote: string;
  version: string;
  blocks: Block[];
}

function draftOf(document: DocumentAdminRow): Draft {
  return {
    title: document.title,
    subtitle: document.subtitle ?? '',
    category: document.category,
    surface: document.surface,
    placeholders: document.placeholders.join(', '),
    renderStyle: document.renderStyle ?? '',
    renderNote: document.renderNote ?? '',
    version: document.version,
    blocks: document.blocks.map((block) => ({ ...block })),
  };
}

function DocumentEditor({
  document,
  open,
  onOpenChange,
  onSaved,
}: {
  document: DocumentAdminRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(document));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const id = `document-${document.id}`;
  const locked = useMemo(
    () => new Map(document.lockedSections.map((entry) => [entry.section, entry.readers])),
    [document]
  );

  const original = draftOf(document);
  const wordsChanged =
    draft.title !== original.title ||
    draft.subtitle !== original.subtitle ||
    JSON.stringify(draft.blocks) !== JSON.stringify(original.blocks);
  const willMint =
    document.requiresAcknowledgement && wordsChanged && draft.version === document.version;

  async function save() {
    setBusy(true);
    setNotice(null);
    const result = await send<{ changed: string[]; mintedVersion: string | null }>(
      'PUT',
      contentItemEndpoint('documents', 'document', document.id),
      {
        revision: document.revision,
        title: draft.title,
        subtitle: orNull(draft.subtitle),
        category: draft.category,
        surface: draft.surface,
        placeholders: draft.placeholders
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        renderStyle: orNull(draft.renderStyle),
        renderNote: orNull(draft.renderNote),
        version: draft.version,
        blocks: draft.blocks,
      }
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    onSaved(
      result.data.changed.length === 0
        ? `Nothing in "${document.title}" had changed. Nothing was saved.`
        : `Saved "${document.title}".` +
            (result.data.mintedVersion
              ? ` It is now version ${result.data.mintedVersion}, and every member will be asked to agree to it again.`
              : '')
    );
  }

  const field = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={document.title}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <code className="text-xs">{document.id}</code>
          <Badge variant="outline">{document.category}</Badge>
          <Badge variant="outline">v{document.version}</Badge>
          {document.requiresAcknowledgement && <Badge>agreed to at the gate</Badge>}
          <span className="text-xs">revision {document.revision}</span>
        </span>
      }
      footer={
        <>
          {willMint && (
            <p
              role="status"
              className="rounded-md border border-amber-500 p-2 text-sm text-amber-800 dark:text-amber-300"
            >
              Saving changes words people have agreed to. It will become version{' '}
              <strong>{nextAcknowledgementVersion(document.version)}</strong>, and every member will
              be asked to agree to it again before the app opens.
            </p>
          )}
          <NoticeLine notice={notice} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy} onClick={() => void save()}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDraft(draftOf(document))}
            >
              Discard changes
            </Button>
            <HistoryButton
              collection="documents"
              entity="document"
              id={document.id}
              label={`"${document.title}"`}
              revisionRead={document.revision}
              restoreNote={
                document.requiresAcknowledgement
                  ? 'Restoring different words asks everyone to agree again, at a new version.'
                  : undefined
              }
              onRestored={onSaved}
            />
          </div>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow
            id={`${id}-title`}
            label="Title"
            help="The document's title, as every page and client shows it."
          >
            <Input
              id={`${id}-title`}
              value={draft.title}
              onChange={(e) => field('title', e.target.value)}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-subtitle`}
            label="Subtitle"
            help="Shown under the title. Leave empty for none."
          >
            <Input
              id={`${id}-subtitle`}
              value={draft.subtitle}
              onChange={(e) => field('subtitle', e.target.value)}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-category`}
            label="Category"
            help="Legal documents are never given to the AI to quote; the others are mirrored into its knowledge base."
          >
            <Select
              value={draft.category}
              onValueChange={(value) => {
                const known = CATEGORIES.find((candidate) => candidate === value);
                if (known) field('category', known);
              }}
            >
              <SelectTrigger id={`${id}-category`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="onboarding">Onboarding</SelectItem>
                <SelectItem value="about">About</SelectItem>
                <SelectItem value="legal">Legal</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow
            id={`${id}-surface`}
            label="Surface"
            help="Which part of the app shows it, as a name clients can switch on (for example first_run_welcome)."
          >
            <Input
              id={`${id}-surface`}
              value={draft.surface}
              onChange={(e) => field('surface', e.target.value)}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-placeholders`}
            label="Merge fields"
            help={
              <>
                The merge fields the words contain, comma-separated, for example{' '}
                <code>{'{{first_name}}'}</code>. Emails fill these in.
              </>
            }
          >
            <Input
              id={`${id}-placeholders`}
              value={draft.placeholders}
              onChange={(e) => field('placeholders', e.target.value)}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-version`}
            label="Version"
            help={
              document.requiresAcknowledgement
                ? 'The version people agree to. Changing the words mints the next one automatically; type a new label here only if you want a different one. Never type an older label back.'
                : 'A label for this version of the document.'
            }
          >
            <Input
              id={`${id}-version`}
              value={draft.version}
              onChange={(e) => field('version', e.target.value)}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-style`}
            label="Render style"
            help={
              <>
                How the words are laid out. <code>cadence</code> shows each paragraph on its own
                line, as the welcome is written. Leave empty for ordinary prose.
              </>
            }
          >
            <Input
              id={`${id}-style`}
              value={draft.renderStyle}
              onChange={(e) => field('renderStyle', e.target.value)}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-note`}
            label="Render note"
            help="A note to whoever builds a client, about how to lay this document out. Not shown to members."
          >
            <Input
              id={`${id}-note`}
              value={draft.renderNote}
              onChange={(e) => field('renderNote', e.target.value)}
            />
          </FieldRow>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <h4 className="text-sm font-medium">Blocks</h4>
            <span className="text-muted-foreground text-xs">
              ({draft.blocks.length}) — one paragraph per block keeps each line on its own.
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            Type straight into the text. Enter starts a new paragraph, Shift+Enter breaks a line
            within one, and Backspace at the start of a paragraph joins it to the one above. The ⋮
            beside a block changes its type, moves it or removes it.
          </p>
          <div className="text-muted-foreground flex items-start gap-1 text-xs">
            <p>
              The labelled lines between blocks are <strong>sections</strong>: named passages a page
              or email can show on its own.
            </p>
            <FieldHelp title="Sections" ariaLabel="About sections" contentClassName="w-96">
              <p>
                A section is a named run of blocks inside a document. Where a page or email shows
                only part of a document — the welcome email, the home page cards, the columns on
                /data — it asks for that passage by its section name, so it always shows the words
                saved here, with nothing copied into code.
              </p>
              <p className="mt-2">
                The names were set when the content was first loaded, to mark the passages those
                pages and emails needed. A section marked <strong>in use</strong> is one that
                something asks for: you can edit its words and add, move or remove blocks inside it,
                but its name can’t change and it can’t be left empty. Any other section is only a
                label and can be renamed or removed freely.
              </p>
              <p className="mt-2">
                To rename a section, click its name. To start a new one, open the ⋮ beside the block
                it should begin at and choose “Start a new section here”; it runs to the next
                section line. Moving a block up or down across a section line moves it into that
                section. A section has to be one unbroken run of blocks.
              </p>
            </FieldHelp>
          </div>
          {document.lockedSections.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Sections a page or email selects by name, which must stay:{' '}
              {document.lockedSections
                .map((entry) => `${entry.section} (${entry.readers.join(', ')})`)
                .join('; ')}
              .
            </p>
          )}
          <BlocksEditor
            idPrefix={id}
            blocks={draft.blocks}
            locked={locked}
            onChange={(blocks) => field('blocks', blocks)}
          />
        </div>

        <ReadersNote
          readers={document.readers}
          lead="This document cannot be deleted, only edited, because these show it:"
        />
      </div>
    </EditDialog>
  );
}

// ─── The collection ─────────────────────────────────────────────────────────

function collectionMetaOf(view: DocumentsAdminView) {
  return {
    title: view.collection?.title ?? '',
    version: view.collection?.version ?? '',
    locale: view.collection?.locale ?? '',
    updatedAt: view.collection?.updatedAt ?? '',
  };
}

export function DocumentsPanel({ initialView }: { initialView: DocumentsAdminView }) {
  const router = useRouter();
  const view = initialView;
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // The form holds the lock it was filled at, beside the values. After a
  // refresh brings a newer collection (an import, another admin), the form is
  // refilled from it: sending the new lock with values typed over the old one
  // would pass the check and put the old values back.
  const [meta, setMeta] = useState(() => collectionMetaOf(view));
  if (view.collection && meta.updatedAt !== view.collection.updatedAt) {
    setMeta(collectionMetaOf(view));
  }

  function done(message: string) {
    setOpen(null);
    setNotice({ tone: 'ok', text: message });
    router.refresh();
  }

  if (!view.seeded || !view.collection) {
    return (
      <p className="text-muted-foreground text-sm">
        The documents have not been seeded yet. Run <code>npm run db:seed</code>.
      </p>
    );
  }
  const collection = view.collection;

  async function saveMeta() {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('documents', 'collection', collection.id),
      { title: meta.title, version: meta.version, locale: meta.locale, updatedAt: meta.updatedAt }
    );
    if (result.ok)
      done(result.data.changed.length ? 'Saved the collection.' : 'Nothing had changed.');
    else setNotice({ tone: 'error', text: result.message });
  }

  async function move(index: number, by: -1 | 1) {
    const order = view.documents.map((document) => ({
      id: document.id,
      revision: document.revision,
    }));
    const [taken] = order.splice(index, 1);
    order.splice(index + by, 0, taken);
    const result = await send<{ moved: number }>('PUT', contentOrderEndpoint('documents'), {
      order,
    });
    if (result.ok) done('Saved the new reading order.');
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <div className="space-y-6">
      <NoticeLine notice={notice} />
      <section className="space-y-3 rounded-md border p-4">
        <h3 className="font-medium">The collection</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <FieldRow
            id="collection-title"
            label="Title"
            help="The collection's name, as the content API reports it."
          >
            <Input
              id="collection-title"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id="collection-version"
            label="Version"
            help="A label for the collection as a whole. The gate does not read it; each document has its own."
          >
            <Input
              id="collection-version"
              value={meta.version}
              onChange={(e) => setMeta({ ...meta, version: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id="collection-locale"
            label="Locale"
            help="The language the documents are written in, for example en-US. Every document takes it."
          >
            <Input
              id="collection-locale"
              value={meta.locale}
              onChange={(e) => setMeta({ ...meta, locale: e.target.value })}
            />
          </FieldRow>
        </div>
        <Button type="button" variant="outline" onClick={() => void saveMeta()}>
          Save collection
        </Button>
      </section>

      <ol className="space-y-3">
        {view.documents.map((document, index) => (
          <li key={document.id} className="rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-6 text-sm">{index + 1}</span>
              <button
                type="button"
                className="font-medium hover:underline"
                aria-haspopup="dialog"
                onClick={() => setOpen(document.id)}
              >
                {document.title}
              </button>
              <code className="text-muted-foreground text-xs">{document.id}</code>
              <Badge variant="outline">{document.category}</Badge>
              <Badge variant="outline">v{document.version}</Badge>
              {document.requiresAcknowledgement && <Badge>agreed to at the gate</Badge>}
              <span className="text-muted-foreground text-xs">revision {document.revision}</span>
              <div className="ml-auto flex gap-1">
                <Tip label="Move up the list">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${document.title} up`}
                    disabled={index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </Button>
                </Tip>
                <Tip label="Move down the list">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${document.title} down`}
                    disabled={index === view.documents.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </Button>
                </Tip>
              </div>
            </div>
            <DocumentEditor
              key={`${document.id}@${document.revision}`}
              document={document}
              open={open === document.id}
              onOpenChange={(next) => setOpen(next ? document.id : null)}
              onSaved={done}
            />
          </li>
        ))}
      </ol>

      <ImportExportPanel
        collection="documents"
        fileName="lelanea_foundational_documents.json"
        what="the documents"
        removal={{
          note: 'A removed document is deleted with its history. One that a page shows, a resource opens or her words cite is refused; the preview says which.',
        }}
        onApplied={done}
      />
    </div>
  );
}
