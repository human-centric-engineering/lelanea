'use client';

/**
 * The resource library, edited (f-content-seeds t-91): the library's own
 * fields and sign-off, every video and article, and the words per key.
 *
 * A resource is **retired, never deleted**, and says so on the button: a
 * conversation that suggested it still shows its chip. A retired resource can
 * be brought back. Its id is shown and never editable, because past
 * suggestions name it.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import {
  contentEntityEndpoint,
  contentItemEndpoint,
  contentOrderEndpoint,
  contentRetiredEndpoint,
} from '@/lib/app/content/admin/endpoint';
import type { ResourceAdminRow, ResourcesAdminView } from '@/lib/app/content/admin/resources';
import { RESOURCE_KINDS, type ResourceKind } from '@/lib/app/content/resource-view';

type Kind = ResourceKind;

/** What each kind is called on screen: one, several, and its section heading. */
const KIND_LABEL: Readonly<
  Record<Kind, { one: string; many: string; heading: string; add: string }>
> = {
  video: { one: 'video', many: 'videos', heading: 'Videos', add: 'Add a video' },
  audio: { one: 'audio piece', many: 'audio', heading: 'Audio', add: 'Add an audio piece' },
  article: { one: 'article', many: 'articles', heading: 'Articles', add: 'Add an article' },
};

/** A stored row's kind; an unknown one is shown as an article, as the read path would refuse it. */
function kindOf(kind: string): Kind {
  return RESOURCE_KINDS.find((k) => k === kind) ?? 'article';
}

/** The rule her words are held to, said where the source is chosen. */
const VERBATIM_HELP =
  'Where the words are taken from. The drawer shows them as hers, so words from one of her documents are checked word for word against it when you save. Words from the Values module cannot be checked yet: copy them exactly.';

interface ResourceDraft {
  id: string;
  kind: Kind;
  title: string;
  subtitle: string;
  relatesTo: string;
  length: string;
  href: string;
  documentId: string;
}

function draftOf(row?: ResourceAdminRow, kind: Kind = 'video'): ResourceDraft {
  return {
    id: row?.id ?? '',
    kind: row ? kindOf(row.kind) : kind,
    title: row?.title ?? '',
    subtitle: row?.subtitle ?? '',
    relatesTo: row?.relatesTo ?? '',
    length: row?.duration ?? row?.readingTime ?? '',
    href: row?.href ?? '',
    documentId: row?.documentId ?? '',
  };
}

function bodyOf(draft: ResourceDraft) {
  const base = { title: draft.title, subtitle: draft.subtitle, relatesTo: orNull(draft.relatesTo) };
  if (draft.kind !== 'article')
    return { kind: draft.kind, ...base, duration: draft.length, href: draft.href };
  return draft.documentId !== ''
    ? { kind: 'article' as const, ...base, readingTime: draft.length, documentId: draft.documentId }
    : { kind: 'article' as const, ...base, readingTime: draft.length, href: draft.href };
}

function Picker({
  id,
  value,
  options,
  empty,
  onChange,
}: {
  id: string;
  value: string;
  options: readonly string[];
  empty: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{empty}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function ResourceFields({
  id,
  draft,
  view,
  onChange,
}: {
  id: string;
  draft: ResourceDraft;
  view: ResourcesAdminView;
  onChange: (draft: ResourceDraft) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FieldRow
        id={`${id}-title`}
        label="Title"
        help="The resource's title, as the drawer shows it."
      >
        <Input
          id={`${id}-title`}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-subtitle`}
        label="What it is for"
        help="One line, in her words, on what this is for."
      >
        <Input
          id={`${id}-subtitle`}
          value={draft.subtitle}
          onChange={(e) => onChange({ ...draft, subtitle: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-relates`}
        label="Belongs to"
        help="The module (or the journey, or situations) it is offered with. Empty means it belongs to everything."
      >
        <Picker
          id={`${id}-relates`}
          value={draft.relatesTo}
          options={view.relatesToOptions}
          empty="everything"
          onChange={(relatesTo) => onChange({ ...draft, relatesTo })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-length`}
        label={draft.kind === 'article' ? 'Reading time' : 'Length (m:ss)'}
        help={
          draft.kind === 'article'
            ? 'How long it takes to read, as shown: "8 min".'
            : `How long the ${KIND_LABEL[draft.kind].one} runs, as shown: 6:12.`
        }
      >
        <Input
          id={`${id}-length`}
          value={draft.length}
          onChange={(e) => onChange({ ...draft, length: e.target.value })}
        />
      </FieldRow>
      {draft.kind === 'article' && (
        <FieldRow
          id={`${id}-document`}
          label="Opens a document"
          help="An article is either one of the foundational documents, opened in the app, or a link. Choose a document, or leave this empty and give a link."
        >
          <Picker
            id={`${id}-document`}
            value={draft.documentId}
            options={view.documentIds}
            empty="none: a link"
            onChange={(documentId) => onChange({ ...draft, documentId })}
          />
        </FieldRow>
      )}
      {(draft.kind !== 'article' || draft.documentId === '') && (
        <FieldRow id={`${id}-href`} label="Link" help="Where it opens: an http or https address.">
          <Input
            id={`${id}-href`}
            value={draft.href}
            onChange={(e) => onChange({ ...draft, href: e.target.value })}
          />
        </FieldRow>
      )}
    </div>
  );
}

function ResourceRow({
  row,
  view,
  index,
  count,
  onMove,
  onSaved,
}: {
  row: ResourceAdminRow;
  view: ResourcesAdminView;
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
  onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(row));
  const [notice, setNotice] = useState<Notice>(null);
  const id = `resource-${row.id}`;

  function saved(message: string) {
    setOpen(false);
    onSaved(message);
  }

  async function save() {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('resources', 'resource', row.id),
      {
        revision: row.revision,
        ...bodyOf(draft),
      }
    );
    if (result.ok)
      saved(result.data.changed.length ? `Saved "${draft.title}".` : 'Nothing had changed.');
    else setNotice({ tone: 'error', text: result.message });
  }

  async function setRetired(retired: boolean) {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentRetiredEndpoint('resources', 'resource', row.id),
      {
        retired,
        revision: row.revision,
      }
    );
    if (result.ok) {
      saved(
        retired
          ? `Retired "${row.title}". It is no longer offered or suggested; conversations that already suggested it still show it.`
          : `Brought back "${row.title}", at the end of the ${KIND_LABEL[kindOf(row.kind)].many}.`
      );
    } else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <li className={`rounded-md border p-3 ${row.retired ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="font-medium hover:underline"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {row.title}
        </button>
        <code className="text-muted-foreground text-xs">{row.id}</code>
        {row.retired && <Badge variant="outline">retired</Badge>}
        <span className="text-muted-foreground text-xs">
          {row.relatesTo ?? 'everything'} · revision {row.revision}
        </span>
        {!row.retired && (
          <div className="ml-auto flex gap-1">
            <Tip label="Move up the list">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move ${row.title} up`}
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
            </Tip>
            <Tip label="Move down the list">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move ${row.title} down`}
                disabled={index === count - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </Button>
            </Tip>
          </div>
        )}
      </div>
      <EditDialog
        open={open}
        onOpenChange={setOpen}
        title={row.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-xs">{row.id}</code>
            {row.retired && <Badge variant="outline">retired</Badge>}
            <span className="text-xs">revision {row.revision}</span>
          </span>
        }
        footer={
          <>
            <NoticeLine notice={notice} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void save()}>
                Save
              </Button>
              <HistoryButton
                collection="resources"
                entity="resource"
                id={row.id}
                label={`"${row.title}"`}
                revisionRead={row.revision}
                onRestored={saved}
              />
              {row.retired ? (
                <Button type="button" variant="outline" onClick={() => void setRetired(false)}>
                  Bring back
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => void setRetired(true)}>
                  <Trash2 className="mr-1 h-4 w-4" aria-hidden />
                  Retire
                </Button>
              )}
            </div>
            {!row.retired && (
              <p className="text-muted-foreground text-xs">
                Retiring takes it out of the drawer, the list the AI is given and its suggestions.
                It is never deleted: a conversation that already suggested it keeps its chip.
              </p>
            )}
          </>
        }
      >
        <ResourceFields id={id} draft={draft} view={view} onChange={setDraft} />
      </EditDialog>
    </li>
  );
}

function AddResource({
  kind,
  view,
  onSaved,
}: {
  kind: Kind;
  view: ResourcesAdminView;
  onSaved: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(undefined, kind));
  const [notice, setNotice] = useState<Notice>(null);

  async function add() {
    const result = await send<{ id: string }>(
      'POST',
      contentEntityEndpoint('resources', 'resource'),
      { id: draft.id, ...bodyOf(draft) }
    );
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setAdding(false);
    setDraft(draftOf(undefined, kind));
    onSaved(`Added "${draft.title}" at the end of the ${KIND_LABEL[kind].many}.`);
  }

  if (!adding) {
    return (
      <Button type="button" variant="outline" onClick={() => setAdding(true)}>
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        {KIND_LABEL[kind].add}
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      <FieldRow
        id={`new-${kind}-id`}
        label="Id"
        help="Lowercase words joined by hyphens, at most 80 characters. Permanent: conversations will name it once the AI suggests it."
      >
        <Input
          id={`new-${kind}-id`}
          value={draft.id}
          onChange={(e) => setDraft({ ...draft, id: e.target.value })}
        />
      </FieldRow>
      <ResourceFields id={`new-${kind}`} draft={draft} view={view} onChange={setDraft} />
      <NoticeLine notice={notice} />
      <div className="flex gap-2">
        <Button type="button" onClick={() => void add()}>
          Add
        </Button>
        <Button type="button" variant="outline" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type WordsRow = ResourcesAdminView['words'][number];

function WordsEditor({ words, onSaved }: { words: WordsRow; onSaved: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    quote: words.quote,
    paragraphs: words.paragraphs.join('\n\n'),
    sourceCollection: words.sourceCollection,
    sourceId: words.sourceId,
  });
  const [notice, setNotice] = useState<Notice>(null);
  const id = `words-${words.key}`;

  function saved(message: string) {
    setOpen(false);
    onSaved(message);
  }

  const body = () => ({
    quote: draft.quote,
    paragraphs: draft.paragraphs
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
    source: { collection: draft.sourceCollection, id: draft.sourceId },
  });

  async function save() {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('resources', 'words', words.key),
      { revision: words.revision, ...body() }
    );
    if (result.ok)
      saved(
        result.data.changed.length ? `Saved the words for ${words.key}.` : 'Nothing had changed.'
      );
    else setNotice({ tone: 'error', text: result.message });
  }

  async function remove() {
    const result = await send<unknown>(
      'DELETE',
      `${contentItemEndpoint('resources', 'words', words.key)}?revision=${words.revision}`
    );
    if (result.ok) saved(`Removed the words for ${words.key}. It now shows the default words.`);
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <li className="rounded-md border p-3">
      <button
        type="button"
        className="font-medium hover:underline"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {words.key}
      </button>
      <span className="text-muted-foreground ml-2 text-xs">revision {words.revision}</span>
      <EditDialog
        open={open}
        onOpenChange={setOpen}
        title={`The words for ${words.key}`}
        description={<span className="text-xs">revision {words.revision}</span>}
        footer={
          <>
            <NoticeLine notice={notice} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void save()}>
                Save words
              </Button>
              <HistoryButton
                collection="resources"
                entity="words"
                id={words.key}
                label={`the words for ${words.key}`}
                revisionRead={words.revision}
                onRestored={saved}
              />
              {words.key === 'default' ? (
                <span className="text-muted-foreground self-center text-xs">
                  The default words cannot be removed: every key without words of its own shows
                  them.
                </span>
              ) : (
                <Button type="button" variant="ghost" onClick={() => void remove()}>
                  <Trash2 className="mr-1 h-4 w-4" aria-hidden />
                  Remove (falls back to the default)
                </Button>
              )}
            </div>
          </>
        }
      >
        <div className="space-y-3">
          <FieldRow
            id={`${id}-quote`}
            label="Quote"
            help="Her line shown at the top of the drawer. A verbatim excerpt of the source below."
          >
            <Textarea
              id={`${id}-quote`}
              rows={2}
              value={draft.quote}
              onChange={(e) => setDraft({ ...draft, quote: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-paragraphs`}
            label="Paragraphs"
            help="A few short paragraphs, each a verbatim excerpt of the source. Separate paragraphs with an empty line."
          >
            <Textarea
              id={`${id}-paragraphs`}
              rows={6}
              value={draft.paragraphs}
              onChange={(e) => setDraft({ ...draft, paragraphs: e.target.value })}
            />
          </FieldRow>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldRow id={`${id}-collection`} label="Source collection" help={VERBATIM_HELP}>
              <select
                id={`${id}-collection`}
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={draft.sourceCollection}
                onChange={(e) => setDraft({ ...draft, sourceCollection: e.target.value })}
              >
                <option value="foundational_documents">foundational_documents</option>
                <option value="values_module">values_module</option>
              </select>
            </FieldRow>
            <FieldRow
              id={`${id}-source`}
              label="Source id"
              help="The document id, or values step id, the passage is taken from."
            >
              <Input
                id={`${id}-source`}
                value={draft.sourceId}
                onChange={(e) => setDraft({ ...draft, sourceId: e.target.value })}
              />
            </FieldRow>
          </div>
        </div>
      </EditDialog>
    </li>
  );
}

function AddWords({
  freeKeys,
  onSaved,
}: {
  freeKeys: readonly string[];
  onSaved: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    key: '',
    quote: '',
    paragraphs: '',
    sourceCollection: 'foundational_documents',
    sourceId: '',
  });
  const [notice, setNotice] = useState<Notice>(null);

  async function add() {
    const result = await send<{ id: string }>('POST', contentEntityEndpoint('resources', 'words'), {
      key: draft.key,
      quote: draft.quote,
      paragraphs: draft.paragraphs
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean),
      source: { collection: draft.sourceCollection, id: draft.sourceId },
    });
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setAdding(false);
    onSaved(`Added words for ${draft.key}.`);
  }

  if (!adding) {
    return (
      <Button type="button" variant="outline" onClick={() => setAdding(true)}>
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        Give a key words of its own
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      <FieldRow
        id="new-words-key"
        label="Key"
        help="The module (or journey, or situations) these words are shown for. Until it has its own, it shows the default words."
      >
        <Picker
          id="new-words-key"
          value={draft.key}
          options={freeKeys}
          empty="Choose a key…"
          onChange={(key) => setDraft({ ...draft, key })}
        />
      </FieldRow>
      <FieldRow
        id="new-words-quote"
        label="Quote"
        help="Her line, a verbatim excerpt of the source below."
      >
        <Textarea
          id="new-words-quote"
          rows={2}
          value={draft.quote}
          onChange={(e) => setDraft({ ...draft, quote: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id="new-words-paragraphs"
        label="Paragraphs"
        help="Verbatim excerpts of the source. Separate paragraphs with an empty line."
      >
        <Textarea
          id="new-words-paragraphs"
          rows={5}
          value={draft.paragraphs}
          onChange={(e) => setDraft({ ...draft, paragraphs: e.target.value })}
        />
      </FieldRow>
      <div className="grid gap-3 md:grid-cols-2">
        <FieldRow id="new-words-collection" label="Source collection" help={VERBATIM_HELP}>
          <Picker
            id="new-words-collection"
            value={draft.sourceCollection}
            options={['foundational_documents', 'values_module']}
            empty="Choose…"
            onChange={(sourceCollection) => setDraft({ ...draft, sourceCollection })}
          />
        </FieldRow>
        <FieldRow
          id="new-words-source"
          label="Source id"
          help="The document id, or values step id, the passage is taken from."
        >
          <Input
            id="new-words-source"
            value={draft.sourceId}
            onChange={(e) => setDraft({ ...draft, sourceId: e.target.value })}
          />
        </FieldRow>
      </div>
      <NoticeLine notice={notice} />
      <div className="flex gap-2">
        <Button type="button" onClick={() => void add()}>
          Add words
        </Button>
        <Button type="button" variant="outline" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ResourcesPanel({ initialView }: { initialView: ResourcesAdminView }) {
  const router = useRouter();
  const view = initialView;
  const [notice, setNotice] = useState<Notice>(null);
  const [meta, setMeta] = useState({
    title: view.collection?.title ?? '',
    version: view.collection?.version ?? '',
    locale: view.collection?.locale ?? '',
    status: view.collection?.provenance.status ?? 'draft',
    awaitingSignOffFrom: view.collection?.provenance.awaitingSignOffFrom ?? '',
    note: view.collection?.provenance.note ?? '',
  });

  function done(message: string) {
    setNotice({ tone: 'ok', text: message });
    router.refresh();
  }

  if (!view.collection) {
    return (
      <p className="text-muted-foreground text-sm">
        The resource library has not been seeded yet. Run <code>npm run db:seed</code>.
      </p>
    );
  }
  const collection = view.collection;

  async function saveMeta() {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('resources', 'collection', collection.id),
      {
        title: meta.title,
        version: meta.version,
        locale: meta.locale,
        provenance: {
          status: meta.status,
          awaitingSignOffFrom: meta.awaitingSignOffFrom,
          note: meta.note,
        },
        updatedAt: collection.updatedAt,
      }
    );
    if (result.ok) done(result.data.changed.length ? 'Saved the library.' : 'Nothing had changed.');
    else setNotice({ tone: 'error', text: result.message });
  }

  async function move(kind: Kind, list: ResourceAdminRow[], index: number, by: -1 | 1) {
    const order = list.map((row) => ({ id: row.id, revision: row.revision }));
    const [taken] = order.splice(index, 1);
    order.splice(index + by, 0, taken);
    const result = await send<{ moved: number }>('PUT', contentOrderEndpoint('resources'), {
      kind,
      order,
    });
    if (result.ok) done(`Saved the new order of ${KIND_LABEL[kind].many}.`);
    else setNotice({ tone: 'error', text: result.message });
  }

  const freeKeys = view.wordsKeyOptions.filter(
    (key) => !view.words.some((words) => words.key === key)
  );

  return (
    <div className="space-y-6">
      <NoticeLine notice={notice} />
      <ReadersNote readers={view.readers} lead="An edit here reaches, on their next request:" />
      <section className="space-y-3 rounded-md border p-4">
        <h3 className="font-medium">The library</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <FieldRow id="library-title" label="Title" help="The library's name.">
            <Input
              id="library-title"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </FieldRow>
          <FieldRow id="library-version" label="Version" help='major.minor, for example "1.0".'>
            <Input
              id="library-version"
              value={meta.version}
              onChange={(e) => setMeta({ ...meta, version: e.target.value })}
            />
          </FieldRow>
          <FieldRow id="library-locale" label="Locale" help="The language it is written in.">
            <Input
              id="library-locale"
              value={meta.locale}
              onChange={(e) => setMeta({ ...meta, locale: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id="library-status"
            label="Sign-off"
            help="Whether she has signed the library off. Served with every resource, so a surface can say it is a draft."
          >
            <select
              id="library-status"
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={meta.status}
              onChange={(e) =>
                setMeta({
                  ...meta,
                  status: e.target.value === 'signed_off' ? 'signed_off' : 'draft',
                })
              }
            >
              <option value="draft">draft</option>
              <option value="signed_off">signed off</option>
            </select>
          </FieldRow>
          <FieldRow
            id="library-awaiting"
            label="Awaiting sign-off from"
            help="Who has yet to sign it off."
          >
            <Input
              id="library-awaiting"
              value={meta.awaitingSignOffFrom}
              onChange={(e) => setMeta({ ...meta, awaitingSignOffFrom: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id="library-note"
            label="Provenance note"
            help="Where the list came from, and what is still to do."
          >
            <Input
              id="library-note"
              value={meta.note}
              onChange={(e) => setMeta({ ...meta, note: e.target.value })}
            />
          </FieldRow>
        </div>
        <Button type="button" variant="outline" onClick={() => void saveMeta()}>
          Save library
        </Button>
      </section>

      {RESOURCE_KINDS.map((kind) => {
        const live = view.resources.filter((row) => row.kind === kind && !row.retired);
        const retired = view.resources.filter((row) => row.kind === kind && row.retired);
        return (
          <section key={kind} className="space-y-3">
            <h3 className="font-medium">
              {KIND_LABEL[kind].heading} ({live.length})
            </h3>
            <ol className="space-y-2">
              {live.map((row, index) => (
                <ResourceRow
                  key={`${row.id}@${row.revision}`}
                  row={row}
                  view={view}
                  index={index}
                  count={live.length}
                  onMove={(by) => void move(kind, live, index, by)}
                  onSaved={done}
                />
              ))}
            </ol>
            <AddResource kind={kind} view={view} onSaved={done} />
            {retired.length > 0 && (
              <details>
                <summary className="text-muted-foreground cursor-pointer text-sm">
                  Retired {KIND_LABEL[kind].many} ({retired.length})
                </summary>
                <ol className="mt-2 space-y-2">
                  {retired.map((row, index) => (
                    <ResourceRow
                      key={`${row.id}@${row.revision}`}
                      row={row}
                      view={view}
                      index={index}
                      count={retired.length}
                      onMove={() => undefined}
                      onSaved={done}
                    />
                  ))}
                </ol>
              </details>
            )}
          </section>
        );
      })}

      <section className="space-y-3">
        <h3 className="font-medium">Words, by key</h3>
        <ol className="space-y-2">
          {view.words.map((words) => (
            <WordsEditor key={`${words.key}@${words.revision}`} words={words} onSaved={done} />
          ))}
        </ol>
        {freeKeys.length > 0 && <AddWords freeKeys={freeKeys} onSaved={done} />}
      </section>

      <ImportExportPanel
        collection="resources"
        fileName="lelanea_resources.json"
        what="the library"
        onApplied={done}
      />
    </div>
  );
}
