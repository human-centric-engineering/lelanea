'use client';

/**
 * The register overlays, edited on the Voice page (f-content-seeds t-92).
 *
 * One row per situation, each opened in a dialog; the set's two blocks that
 * belong to no one situation; sign-off; history with restore; a new situation;
 * a delete that names what selects it first; and the file round-trip.
 *
 * Every row is keyed on its revision, so `router.refresh()` after a write
 * remounts it with what is now stored rather than what the form last held.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClientDate } from '@/components/ui/client-date';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { send } from '@/components/app/admin/content/client';
import {
  EditDialog,
  FieldRow,
  HistoryButton,
  ImportExportPanel,
  NoticeLine,
  type Notice,
} from '@/components/app/admin/content/parts';
import {
  VOICE_OVERLAY_SET_ENDPOINT,
  VOICE_OVERLAY_SITUATIONS_ENDPOINT,
  VOICE_OVERLAYS_FILE_ENDPOINTS,
  voiceOverlayEndpoint,
} from '@/lib/app/voice/endpoint';
import type {
  OverlayAdminRow,
  OverlaySetAdminRow,
  OverlaysAdminView,
} from '@/lib/app/voice/overlays-admin';

type Status = 'draft' | 'signed_off';

/** The status an admin reads: signed off, or a draft awaiting it. */
export function VoiceStatusBadge({
  status,
  signedOffAt,
}: {
  status: Status;
  signedOffAt: string | Date | null;
}) {
  return status === 'signed_off' ? (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      <Badge variant="secondary">Signed off</Badge>
      {signedOffAt && <ClientDate date={new Date(signedOffAt)} />}
    </span>
  ) : (
    <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
      Draft — awaiting sign-off
    </Badge>
  );
}

/** One beat per line in the box; blank lines are dropped. */
function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// ─── One overlay ────────────────────────────────────────────────────────────

interface OverlayDraft {
  situation: string;
  label: string;
  when: string;
  heading: string;
  lines: string;
  exemplarQuery: string;
}

function draftOf(row?: OverlayAdminRow): OverlayDraft {
  return {
    situation: row?.situation ?? '',
    label: row?.label ?? '',
    when: row?.when ?? '',
    heading: row?.heading ?? '',
    lines: row?.lines.join('\n') ?? '',
    exemplarQuery: row?.exemplarQuery ?? '',
  };
}

function bodyOf(draft: OverlayDraft) {
  return {
    label: draft.label,
    when: draft.when,
    heading: draft.heading,
    lines: toLines(draft.lines),
    exemplarQuery: draft.exemplarQuery,
  };
}

function OverlayFields({
  id,
  draft,
  onChange,
  withKey,
}: {
  id: string;
  draft: OverlayDraft;
  onChange: (draft: OverlayDraft) => void;
  withKey: boolean;
}) {
  return (
    <div className="space-y-4">
      {withKey && (
        <FieldRow
          id={`${id}-situation`}
          label="Situation key"
          help="The name a chat turn asks for this register by. Lower case, words joined by hyphens, such as first-meeting. It cannot be changed once added, because it is how a context selects the overlay."
        >
          <Input
            id={`${id}-situation`}
            value={draft.situation}
            onChange={(e) => onChange({ ...draft, situation: e.target.value })}
          />
        </FieldRow>
      )}
      <FieldRow id={`${id}-label`} label="Label" help="What admins call this situation.">
        <Input
          id={`${id}-label`}
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-when`}
        label="When it applies"
        help="A note for whoever reviews the overlays. It is never sent to the AI."
      >
        <Textarea
          id={`${id}-when`}
          rows={2}
          value={draft.when}
          onChange={(e) => onChange({ ...draft, when: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-heading`}
        label="Heading"
        help="The heading the AI reads above these lines."
      >
        <Input
          id={`${id}-heading`}
          value={draft.heading}
          onChange={(e) => onChange({ ...draft, heading: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-lines`}
        label="Lines"
        help="One beat per line. These shade the always-on voice for this situation; they do not replace it, so anything true of every turn belongs in the core, not here."
      >
        <Textarea
          id={`${id}-lines`}
          rows={8}
          value={draft.lines}
          onChange={(e) => onChange({ ...draft, lines: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-query`}
        label="Exemplar search"
        help="What the designated voice documents are searched for in this situation, to put real passages in front of the AI. Written, not derived, so it can be read and reviewed."
      >
        <Textarea
          id={`${id}-query`}
          rows={2}
          value={draft.exemplarQuery}
          onChange={(e) => onChange({ ...draft, exemplarQuery: e.target.value })}
        />
      </FieldRow>
    </div>
  );
}

function OverlayRow({ row, onDone }: { row: OverlayAdminRow; onDone: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(row));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await send<{ changed: string[] }>('PUT', voiceOverlayEndpoint(row.situation), {
      ...bodyOf(draft),
      revision: row.revision,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setEditing(false);
    onDone(
      result.data.changed.length === 0
        ? `Nothing in “${row.label}” changed.`
        : `Saved “${row.label}”. It is a draft again until it is signed off.`
    );
  }

  async function signOff() {
    const result = await send('POST', `${voiceOverlayEndpoint(row.situation)}/sign-off`, {
      revision: row.revision,
    });
    if (result.ok) onDone(`Signed off “${row.label}”.`);
    else setNotice({ tone: 'error', text: result.message });
  }

  async function remove() {
    setBusy(true);
    const result = await send(
      'DELETE',
      `${voiceOverlayEndpoint(row.situation)}?revision=${row.revision}`
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setDeleting(false);
    onDone(`Deleted “${row.label}”. Its words are kept in the audit log.`);
  }

  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.label}</span>
        <code className="text-muted-foreground text-xs">{row.situation}</code>
        <VoiceStatusBadge status={row.status} signedOffAt={row.signedOffAt} />
      </div>
      <p className="text-muted-foreground line-clamp-2 text-sm">{row.lines.join(' ')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        {row.status === 'draft' && (
          <Button type="button" variant="outline" size="sm" onClick={() => void signOff()}>
            Sign off
          </Button>
        )}
        <HistoryButton
          endpoints={{
            history: `${voiceOverlayEndpoint(row.situation)}/history`,
            restore: `${voiceOverlayEndpoint(row.situation)}/restore`,
          }}
          label={`“${row.label}”`}
          revisionRead={row.revision}
          restoreNote="A restored overlay is a draft until it is signed off again."
          onRestored={onDone}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(true)}>
          <Trash2 className="mr-1 h-4 w-4" aria-hidden />
          Delete
        </Button>
      </div>
      <NoticeLine notice={notice} />

      <EditDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit “${row.label}”`}
        description="Saved words reach the next turn that asks for this situation. Any change returns it to draft."
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
        <OverlayFields
          id={`overlay-${row.situation}`}
          draft={draft}
          onChange={setDraft}
          withKey={false}
        />
      </EditDialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{row.label}”?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>These select this situation today:</p>
                <ul className="list-disc pl-5">
                  {row.selectedBy.map((selector) => (
                    <li key={selector}>{selector}</li>
                  ))}
                </ul>
                <p>
                  Once it is gone they get the general register used when no overlay matches. Its
                  history goes with it; the audit log keeps its words.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <NoticeLine notice={notice} />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete
            </Button>
            <Button type="button" variant="outline" onClick={() => setDeleting(false)}>
              Keep it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

// ─── The set's framing ──────────────────────────────────────────────────────

interface SetDraft {
  coreOnlyHeading: string;
  coreOnlyLines: string;
  exemplarsHeading: string;
  originLabel: string;
  exemplarLines: string;
  noneFoundNote: string;
  unavailableNote: string;
}

function setDraftOf(set: OverlaySetAdminRow): SetDraft {
  return {
    coreOnlyHeading: set.coreOnly.heading,
    coreOnlyLines: set.coreOnly.lines.join('\n'),
    exemplarsHeading: set.exemplars.heading,
    originLabel: set.exemplars.originLabel,
    exemplarLines: set.exemplars.lines.join('\n'),
    noneFoundNote: set.exemplars.noneFoundNote,
    unavailableNote: set.exemplars.unavailableNote,
  };
}

function SetFraming({
  set,
  onDone,
}: {
  set: OverlaySetAdminRow;
  onDone: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => setDraftOf(set));
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const field = (key: keyof SetDraft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  async function save() {
    setBusy(true);
    const result = await send<{ changed: string[] }>('PUT', VOICE_OVERLAY_SET_ENDPOINT, {
      revision: set.revision,
      coreOnly: { heading: draft.coreOnlyHeading, lines: toLines(draft.coreOnlyLines) },
      exemplars: {
        heading: draft.exemplarsHeading,
        originLabel: draft.originLabel,
        lines: toLines(draft.exemplarLines),
        noneFoundNote: draft.noneFoundNote,
        unavailableNote: draft.unavailableNote,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setEditing(false);
    onDone(
      result.data.changed.length === 0
        ? 'Nothing in the general blocks changed.'
        : 'Saved the general blocks. They are a draft again until they are signed off.'
    );
  }

  async function signOff() {
    const result = await send('POST', `${VOICE_OVERLAY_SET_ENDPOINT}/sign-off`, {
      revision: set.revision,
    });
    if (result.ok) onDone('Signed off the general blocks.');
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">When no situation matches, and around real passages</span>
        <VoiceStatusBadge status={set.status} signedOffAt={set.signedOffAt} />
      </div>
      <p className="text-muted-foreground text-sm">
        The register the AI gets when a turn names no situation, or one with no overlay; and the
        words that frame the real passages put in front of it, including the label that tells the AI
        whose writing they are.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        {set.status === 'draft' && (
          <Button type="button" variant="outline" size="sm" onClick={() => void signOff()}>
            Sign off
          </Button>
        )}
        <HistoryButton
          endpoints={{
            history: `${VOICE_OVERLAY_SET_ENDPOINT}/history`,
            restore: `${VOICE_OVERLAY_SET_ENDPOINT}/restore`,
          }}
          label="the general blocks"
          revisionRead={set.revision}
          restoreNote="A restore is a draft until it is signed off again."
          onRestored={onDone}
        />
      </div>
      <NoticeLine notice={notice} />
      <EditDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit the general blocks"
        description="Both reach the AI on voice turns. Any change returns them to draft."
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
        <div className="space-y-4">
          <h4 className="font-medium">When no situation matches</h4>
          <FieldRow id="core-only-heading" label="Heading" help="The heading above these lines.">
            <Input id="core-only-heading" {...field('coreOnlyHeading')} />
          </FieldRow>
          <FieldRow
            id="core-only-lines"
            label="Lines"
            help="One per line. Sent whenever no overlay matches, so it is never empty: a blank block would look like a broken loader."
          >
            <Textarea id="core-only-lines" rows={4} {...field('coreOnlyLines')} />
          </FieldRow>
          <h4 className="pt-2 font-medium">Around real passages</h4>
          <FieldRow id="exemplars-heading" label="Heading" help="The heading above the passages.">
            <Input id="exemplars-heading" {...field('exemplarsHeading')} />
          </FieldRow>
          <FieldRow
            id="exemplars-origin"
            label="Origin label"
            help="Carried by every passage. It is what tells the AI a passage is from the source writing and not from the person it is talking to, so keep it unmistakable."
          >
            <Input id="exemplars-origin" {...field('originLabel')} />
          </FieldRow>
          <FieldRow
            id="exemplars-lines"
            label="Lines"
            help="One per line: how the AI should use the passages."
          >
            <Textarea id="exemplars-lines" rows={4} {...field('exemplarLines')} />
          </FieldRow>
          <FieldRow
            id="exemplars-none"
            label="When nothing is found"
            help="Said when the search ran and found nothing for this situation."
          >
            <Textarea id="exemplars-none" rows={2} {...field('noneFoundNote')} />
          </FieldRow>
          <FieldRow
            id="exemplars-unavailable"
            label="When the search cannot run"
            help="Said when the search failed. A different fact from finding nothing, so it is worded separately."
          >
            <Textarea id="exemplars-unavailable" rows={2} {...field('unavailableNote')} />
          </FieldRow>
        </div>
      </EditDialog>
    </div>
  );
}

// ─── The editor ─────────────────────────────────────────────────────────────

export function OverlaysEditor({ initialView }: { initialView: OverlaysAdminView }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState(() => draftOf());
  const [addNotice, setAddNotice] = useState<Notice>(null);

  function done(message: string) {
    setNotice({ tone: 'ok', text: message });
    router.refresh();
  }

  async function add() {
    const result = await send<{ situation: string }>('POST', VOICE_OVERLAY_SITUATIONS_ENDPOINT, {
      situation: newDraft.situation.trim(),
      ...bodyOf(newDraft),
    });
    if (!result.ok) {
      setAddNotice({ tone: 'error', text: result.message });
      return;
    }
    setAdding(false);
    setNewDraft(draftOf());
    setAddNotice(null);
    done(`Added “${result.data.situation}” as a draft, at the end of the list.`);
  }

  if (!initialView.seeded) {
    return (
      <p className="text-muted-foreground text-sm">
        The overlays have not been seeded yet. Run <code>npm run db:seed</code>.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {initialView.unservable && (
        <p role="alert" className="text-destructive text-sm">
          What is stored cannot be read, so{' '}
          <strong>voice turns are going without a register</strong> right now. The problem:{' '}
          {initialView.unservable}. Importing a good file repairs it.
        </p>
      )}
      <NoticeLine notice={notice} />
      {initialView.set && (
        <SetFraming key={`set@${initialView.set.revision}`} set={initialView.set} onDone={done} />
      )}
      <ol className="space-y-2">
        {initialView.overlays.map((row) => (
          <OverlayRow key={`${row.situation}@${row.revision}`} row={row} onDone={done} />
        ))}
      </ol>
      <Button type="button" variant="outline" onClick={() => setAdding(true)}>
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        Add a situation
      </Button>
      <EditDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a situation"
        description="It is added as a draft, at the end of the list, and any turn that asks for its key gets it from then on."
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
        <OverlayFields id="new-overlay" draft={newDraft} onChange={setNewDraft} withKey />
      </EditDialog>
      <ImportExportPanel
        endpoints={VOICE_OVERLAYS_FILE_ENDPOINTS}
        fileName="lelanea_voice_overlays.json"
        what="the overlays"
        removal={{
          note: 'A deleted situation takes its history with it; the audit log keeps its words.',
        }}
        onApplied={done}
      />
    </div>
  );
}
