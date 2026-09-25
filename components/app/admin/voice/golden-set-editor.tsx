'use client';

/**
 * The golden set, edited on the Voice page (f-content-seeds t-92): each
 * prompt, what it tests and what kind of moment it is; a new version when the
 * current one has been run; and the file round-trip.
 *
 * A version something has run is locked, and the page says why before anyone
 * tries: its stored answers are only readable beside the questions that
 * produced them. "Start a new version" is the way on, and it leaves the old
 * version and its comparisons exactly as they were.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { send } from '@/components/app/admin/content/client';
import {
  EditDialog,
  FieldRow,
  ImportExportPanel,
  NoticeLine,
  type Notice,
} from '@/components/app/admin/content/parts';
import {
  GOLDEN_SET_FILE_ENDPOINTS,
  GOLDEN_SET_PROMPTS_ENDPOINT,
  GOLDEN_SET_VERSIONS_ENDPOINT,
  goldenPromptEndpoint,
} from '@/lib/app/voice/endpoint';
import { GOLDEN_SET_REQUIRED_KINDS, type GoldenSetKind } from '@/lib/app/content/schemas';
import type { GoldenPrompt, GoldenSetEditorView } from '@/lib/app/voice/golden-set-editor';

/** How each kind of moment reads to an admin. */
const KIND_LABELS: Record<GoldenSetKind, string> = {
  greeting: 'Greeting',
  decline: 'Declining',
  'grounded-claim': 'A claim from the source material',
  'retrieval-empty': 'Nothing to draw on',
  refusal: 'Refusing',
};

interface PromptDraft {
  key: string;
  kind: GoldenSetKind;
  probe: string;
  prompt: string;
}

function draftOf(prompt?: GoldenPrompt): PromptDraft {
  return {
    key: prompt?.key ?? '',
    kind: prompt?.kind ?? 'greeting',
    probe: prompt?.probe ?? '',
    prompt: prompt?.prompt ?? '',
  };
}

function PromptFields({
  id,
  draft,
  onChange,
  withKey,
}: {
  id: string;
  draft: PromptDraft;
  onChange: (draft: PromptDraft) => void;
  withKey: boolean;
}) {
  return (
    <div className="space-y-4">
      {withKey && (
        <FieldRow
          id={`${id}-key`}
          label="Key"
          help="The prompt's name in the comparison. Lower case, words joined by hyphens. It cannot be changed once added."
        >
          <Input
            id={`${id}-key`}
            value={draft.key}
            onChange={(e) => onChange({ ...draft, key: e.target.value })}
          />
        </FieldRow>
      )}
      <FieldRow
        id={`${id}-kind`}
        label="Kind of moment"
        help="The set must keep at least one prompt of every kind, so the voice is heard in each."
      >
        <select
          id={`${id}-kind`}
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          value={draft.kind}
          onChange={(e) =>
            onChange({
              ...draft,
              kind: GOLDEN_SET_REQUIRED_KINDS.find((kind) => kind === e.target.value) ?? draft.kind,
            })
          }
        >
          {GOLDEN_SET_REQUIRED_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        id={`${id}-prompt`}
        label="Prompt"
        help="What a person says. Both arms of a comparison are asked exactly this."
      >
        <Textarea
          id={`${id}-prompt`}
          rows={3}
          value={draft.prompt}
          onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-probe`}
        label="What it tests"
        help="What a good answer should show. It is shown beside both answers, so whoever reads them knows what to look for."
      >
        <Textarea
          id={`${id}-probe`}
          rows={3}
          value={draft.probe}
          onChange={(e) => onChange({ ...draft, probe: e.target.value })}
        />
      </FieldRow>
    </div>
  );
}

function PromptRow({
  prompt,
  contentHash,
  locked,
  onDone,
}: {
  prompt: GoldenPrompt;
  contentHash: string;
  locked: boolean;
  onDone: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(prompt));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await send<{ changed: string[] }>('PUT', goldenPromptEndpoint(prompt.key), {
      kind: draft.kind,
      probe: draft.probe,
      prompt: draft.prompt,
      contentHash,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setEditing(false);
    onDone(
      result.data.changed.length === 0
        ? `Nothing in “${prompt.key}” changed.`
        : `Saved “${prompt.key}”.`
    );
  }

  async function remove() {
    const result = await send(
      'DELETE',
      `${goldenPromptEndpoint(prompt.key)}?contentHash=${contentHash}`
    );
    if (result.ok) onDone(`Removed “${prompt.key}”.`);
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <li className="space-y-1 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-medium">{prompt.key}</code>
        <Badge variant="outline">{KIND_LABELS[prompt.kind]}</Badge>
      </div>
      <p>“{prompt.prompt}”</p>
      <p className="text-muted-foreground">Tests: {prompt.probe}</p>
      {!locked && (
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void remove()}>
            <Trash2 className="mr-1 h-4 w-4" aria-hidden />
            Remove
          </Button>
        </div>
      )}
      <NoticeLine notice={notice} />
      <EditDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit “${prompt.key}”`}
        footer={
          <>
            <NoticeLine notice={notice} />
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => void save()}>
                Save
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </>
        }
      >
        <PromptFields
          id={`prompt-${prompt.key}`}
          draft={draft}
          onChange={setDraft}
          withKey={false}
        />
      </EditDialog>
    </li>
  );
}

export function GoldenSetEditor({ initialView }: { initialView: GoldenSetEditorView }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState(() => draftOf());
  const [addNotice, setAddNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const { pointer, contentHash } = initialView;

  function done(message: string) {
    setNotice({ tone: 'ok', text: message });
    router.refresh();
  }

  if (!initialView.seeded || !pointer || !contentHash) {
    return (
      <p className="text-muted-foreground text-sm">
        The golden set&rsquo;s prompts are not in this install yet. Run <code>npm run db:seed</code>
        .
      </p>
    );
  }

  const locked = initialView.frozen || initialView.malformed.length > 0;

  async function add() {
    const result = await send('POST', GOLDEN_SET_PROMPTS_ENDPOINT, { ...newDraft, contentHash });
    if (!result.ok) {
      setAddNotice({ tone: 'error', text: result.message });
      return;
    }
    setAdding(false);
    setNewDraft(draftOf());
    setAddNotice(null);
    done(`Added “${newDraft.key}” at the end.`);
  }

  async function startNewVersion() {
    setBusy(true);
    const result = await send<{ from: string; to: string }>('POST', GOLDEN_SET_VERSIONS_ENDPOINT, {
      revision: pointer!.revision,
    });
    setBusy(false);
    if (result.ok) {
      done(
        `Started v${result.data.to} from v${result.data.from}. Its prompts can be edited until it is run; v${result.data.from} and its comparisons are unchanged.`
      );
    } else {
      setNotice({ tone: 'error', text: result.message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Version {pointer.version}</span>
        {initialView.frozen && (
          <Badge variant="outline">
            <Lock className="mr-1 h-3 w-3" aria-hidden />
            Locked
          </Badge>
        )}
      </div>
      {initialView.frozen && (
        <div className="space-y-2 rounded-md border border-amber-500 p-3 text-sm">
          <p>
            <strong>
              This version has been run{' '}
              {initialView.runCount === 1 ? 'once' : `${initialView.runCount} times`}, so its
              prompts are locked.
            </strong>{' '}
            Every stored answer is only readable beside the question that produced it, so changing a
            question would quietly re-caption answers it never produced.
          </p>
          <p>
            To change the prompts, start a new version. It begins as a copy of this one and can be
            edited until it is run; this version and its comparisons stay exactly as they are.
          </p>
          <Button type="button" disabled={busy} onClick={() => void startNewVersion()}>
            Start v{initialView.nextVersion}
          </Button>
        </div>
      )}
      {initialView.malformed.length > 0 && (
        <p role="alert" className="text-destructive text-sm">
          Some stored prompts are not in the shape the seed writes, so the set cannot be edited
          prompt by prompt. Importing a good file repairs it.
        </p>
      )}
      <NoticeLine notice={notice} />
      <ol className="space-y-2">
        {initialView.prompts.map((prompt) => (
          <PromptRow
            key={`${prompt.key}@${contentHash}`}
            prompt={prompt}
            contentHash={contentHash}
            locked={locked}
            onDone={done}
          />
        ))}
      </ol>
      {!locked && (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Add a prompt
        </Button>
      )}
      <EditDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a prompt"
        footer={
          <>
            <NoticeLine notice={addNotice} />
            <div className="flex gap-2">
              <Button type="button" onClick={() => void add()}>
                Add
              </Button>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </>
        }
      >
        <PromptFields id="new-prompt" draft={newDraft} onChange={setNewDraft} withKey />
      </EditDialog>
      <ImportExportPanel
        endpoints={GOLDEN_SET_FILE_ENDPOINTS}
        fileName="lelanea_voice_golden_set.json"
        what="the golden set"
        removal={{}}
        onApplied={done}
      />
    </div>
  );
}
