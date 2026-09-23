'use client';

/**
 * Her foundational documents, edited (f-content-seeds t-91).
 *
 * Each document opens into its fields and its blocks, edited block by block so
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
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { orNull, send } from '@/components/app/admin/content/client';
import {
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

const BLOCK_TYPES = ['paragraph', 'heading', 'list'] as const satisfies readonly Block['type'][];
const CATEGORIES = ['onboarding', 'about', 'legal'] as const;

// ─── Blocks ─────────────────────────────────────────────────────────────────

function newBlock(type: Block['type'], section: string | null): Block {
  if (type === 'heading') return { type, text: '', level: 2, section };
  if (type === 'list') return { type, style: 'unordered', items: [''], section };
  return { type, text: '', section };
}

function retype(block: Block, type: Block['type']): Block {
  if (block.type === type) return block;
  const text = block.type === 'list' ? block.items.join('\n') : block.text;
  if (type === 'list')
    return { type, style: 'unordered', items: text.split('\n'), section: block.section };
  if (type === 'heading') return { type, text, level: 2, section: block.section };
  return { type, text, section: block.section };
}

function BlocksEditor({
  idPrefix,
  blocks,
  locked,
  onChange,
}: {
  idPrefix: string;
  blocks: Block[];
  locked: ReadonlySet<string>;
  onChange: (blocks: Block[]) => void;
}) {
  const set = (index: number, block: Block) =>
    onChange(blocks.map((current, at) => (at === index ? block : current)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...blocks];
    const [taken] = next.splice(index, 1);
    next.splice(index + by, 0, taken);
    onChange(next);
  };

  return (
    <ol className="space-y-2">
      {blocks.map((block, index) => {
        const id = `${idPrefix}-block-${index}`;
        return (
          <li key={index} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-8 text-xs">{index + 1}</span>
              <Select
                value={block.type}
                onValueChange={(type) => {
                  const known = BLOCK_TYPES.find((candidate) => candidate === type);
                  if (known) set(index, retype(block, known));
                }}
              >
                <SelectTrigger className="h-8 w-32" aria-label={`Block ${index + 1} type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paragraph">Paragraph</SelectItem>
                  <SelectItem value="heading">Heading</SelectItem>
                  <SelectItem value="list">List</SelectItem>
                </SelectContent>
              </Select>
              {block.type === 'heading' && (
                <Input
                  type="number"
                  min={1}
                  max={6}
                  aria-label={`Block ${index + 1} heading level`}
                  className="h-8 w-20"
                  value={block.level}
                  onChange={(event) =>
                    set(index, { ...block, level: Number(event.target.value) || 1 })
                  }
                />
              )}
              <Input
                aria-label={`Block ${index + 1} section key`}
                placeholder="section key"
                className="h-8 w-44 font-mono text-xs"
                value={block.section ?? ''}
                onChange={(event) =>
                  set(index, { ...block, section: orNull(event.target.value.trim()) })
                }
              />
              {block.section !== null && locked.has(block.section) && (
                <Badge variant="outline" title="A page or email selects this section by name">
                  <Lock className="mr-1 h-3 w-3" aria-hidden />
                  in use
                </Badge>
              )}
              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Move down"
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Add a block below"
                  onClick={() => {
                    const next = [...blocks];
                    next.splice(index + 1, 0, newBlock('paragraph', block.section));
                    onChange(next);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove this block"
                  disabled={blocks.length === 1}
                  onClick={() => onChange(blocks.filter((_, at) => at !== index))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
            {block.type === 'list' ? (
              <Textarea
                id={id}
                aria-label={`Block ${index + 1} items, one per line`}
                className="mt-2"
                rows={Math.max(2, block.items.length)}
                value={block.items.join('\n')}
                onChange={(event) =>
                  set(index, { ...block, items: event.target.value.split('\n') })
                }
              />
            ) : (
              <Textarea
                id={id}
                aria-label={`Block ${index + 1} text`}
                className="mt-2"
                rows={block.type === 'heading' ? 1 : 2}
                value={block.text}
                onChange={(event) => set(index, { ...block, text: event.target.value })}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

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
  onSaved,
}: {
  document: DocumentAdminRow;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(document));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const id = `document-${document.id}`;
  const locked = useMemo(
    () => new Set(document.lockedSections.map((entry) => entry.section)),
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
    <div className="space-y-4 pt-3">
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
              How the words are laid out. <code>cadence</code> shows each paragraph on its own line,
              as the welcome is written. Leave empty for ordinary prose.
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

      {willMint && (
        <p
          role="status"
          className="rounded-md border border-amber-500 p-2 text-sm text-amber-800 dark:text-amber-300"
        >
          Saving changes words people have agreed to. It will become version{' '}
          <strong>{nextAcknowledgementVersion(document.version)}</strong>, and every member will be
          asked to agree to it again before the app opens.
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
      <ReadersNote
        readers={document.readers}
        lead="This document cannot be deleted, only edited, because these show it:"
      />
    </div>
  );
}

// ─── The collection ─────────────────────────────────────────────────────────

export function DocumentsPanel({ initialView }: { initialView: DocumentsAdminView }) {
  const router = useRouter();
  const view = initialView;
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [meta, setMeta] = useState({
    title: view.collection?.title ?? '',
    version: view.collection?.version ?? '',
    locale: view.collection?.locale ?? '',
  });

  function done(message: string) {
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
      { ...meta, updatedAt: collection.updatedAt }
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
                aria-expanded={open === document.id}
                onClick={() => setOpen(open === document.id ? null : document.id)}
              >
                {document.title}
              </button>
              <code className="text-muted-foreground text-xs">{document.id}</code>
              <Badge variant="outline">{document.category}</Badge>
              <Badge variant="outline">v{document.version}</Badge>
              {document.requiresAcknowledgement && <Badge>agreed to at the gate</Badge>}
              <span className="text-muted-foreground text-xs">revision {document.revision}</span>
              <div className="ml-auto flex gap-1">
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
              </div>
            </div>
            {open === document.id && (
              <DocumentEditor
                key={`${document.id}@${document.revision}`}
                document={document}
                onSaved={done}
              />
            )}
          </li>
        ))}
      </ol>

      <ImportExportPanel
        collection="documents"
        fileName="lelanea_foundational_documents.json"
        what="the documents"
        onApplied={done}
      />
    </div>
  );
}
