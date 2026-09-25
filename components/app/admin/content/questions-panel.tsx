'use client';

/**
 * The discovery questions, edited (f-content-seeds t-91): the set's framing,
 * and each question. Questions can be added at the end, reworded, moved and
 * removed; numbers stay 1 to N, and a removal re-numbers the rest. A question
 * keeps its id whatever happens to its words or its place.
 *
 * f-onboarding t-101: each question has a weight, and the fully weighted ones
 * are core: always asked, never skippable. The Core Set switch is the owning
 * module's config, reported here and set on the module's page. A person's
 * answers are filed under the question's id, so rewording a question
 * re-projects the slot they are filed under (warned here if that fails), and a
 * removed question keeps its answers and its id is never given out again.
 *
 * The weight is also a slider on each row, saved when it is let go of, so the
 * Core Set can be tuned across the whole list without opening each question.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { orNull, send } from '@/components/app/admin/content/client';
import { useTimeout } from '@/lib/hooks/use-timeout';
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
} from '@/lib/app/content/admin/endpoint';
import type { QuestionsAdminView, QuestionsOwningModule } from '@/lib/app/content/admin/questions';
import {
  FULL_WEIGHT,
  type DiscoveryQuestionSet,
  type DiscoveryQuestionView,
} from '@/lib/app/content/question-view';

interface QuestionDraft {
  text: string;
  hint: string;
  branches: boolean;
  ifYes: string;
  ifNo: string;
  /** Kept as typed, so a half-typed number is not snapped back while editing. */
  weight: string;
}

function draftOf(question?: DiscoveryQuestionView): QuestionDraft {
  return {
    text: question?.text ?? '',
    hint: question?.hint ?? '',
    branches: question?.conditionalFollowUp !== undefined,
    ifYes: question?.conditionalFollowUp?.ifYes ?? '',
    ifNo: question?.conditionalFollowUp?.ifNo ?? '',
    weight: String(question?.weight ?? FULL_WEIGHT),
  };
}

/**
 * The weight as the route reads it. An empty box is sent as `null` rather than
 * `Number('')`, which is 0, so a cleared field is refused rather than quietly
 * taking the question out of the Core Set.
 */
function weightOf(draft: QuestionDraft): number | null {
  return draft.weight.trim() === '' ? null : Number(draft.weight);
}

/** How a save is reported: done, or done with something the admin must act on. */
type SavedTone = 'ok' | 'warn';

/** What a question write says about the slot its answers are filed under. */
interface SlotSyncReport {
  slotSync?: { status: string };
}

/**
 * A warning when the write saved but the data slots did not follow. Names a
 * remedy that works after any question write, an add or a removal included
 * (`HB10`): every question save re-syncs, even one that changes nothing.
 */
function slotSyncWarning(report: SlotSyncReport): string | null {
  if (report.slotSync === undefined || report.slotSync.status === 'synced') return null;
  return 'Saved — but the data slots the AI files answers under did not update, so it is still reading the questions as they were. Open any question and save it to retry; a server restart also repairs it.';
}

function bodyOf(draft: QuestionDraft) {
  return {
    text: draft.text,
    inputType: 'long_text' as const,
    hint: orNull(draft.hint),
    conditionalFollowUp: draft.branches ? { ifYes: draft.ifYes, ifNo: draft.ifNo } : null,
    weight: weightOf(draft),
  };
}

function QuestionFields({
  id,
  draft,
  onChange,
}: {
  id: string;
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
}) {
  return (
    <div className="space-y-3">
      <FieldRow
        id={`${id}-text`}
        label="Question"
        help="The question, in her words, as it is asked."
      >
        <Textarea
          id={`${id}-text`}
          rows={2}
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-hint`}
        label="Hint"
        help="A gentle prompt shown with the question. Leave empty for none."
      >
        <Input
          id={`${id}-hint`}
          value={draft.hint}
          onChange={(e) => onChange({ ...draft, hint: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id={`${id}-weight`}
        label="Weight"
        help={`How much this question matters, from 0 to ${FULL_WEIGHT}. A question at ${FULL_WEIGHT} is core: it is always asked and cannot be skipped. When the module's "Core Set only" is on, the core questions are the only ones asked.`}
      >
        <Input
          id={`${id}-weight`}
          type="number"
          inputMode="numeric"
          min={0}
          max={FULL_WEIGHT}
          step={1}
          className="w-28"
          value={draft.weight}
          onChange={(e) => onChange({ ...draft, weight: e.target.value })}
        />
      </FieldRow>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id={`${id}-branches`}
          checked={draft.branches}
          onCheckedChange={(branches) => onChange({ ...draft, branches })}
        />
        <Label htmlFor={`${id}-branches`}>Follows up differently on yes and no</Label>
      </div>
      {draft.branches && (
        <div className="grid gap-3 md:grid-cols-2">
          <FieldRow id={`${id}-yes`} label="If yes" help="What to ask next when the answer is yes.">
            <Textarea
              id={`${id}-yes`}
              rows={2}
              value={draft.ifYes}
              onChange={(e) => onChange({ ...draft, ifYes: e.target.value })}
            />
          </FieldRow>
          <FieldRow id={`${id}-no`} label="If no" help="What to ask next when the answer is no.">
            <Textarea
              id={`${id}-no`}
              rows={2}
              value={draft.ifNo}
              onChange={(e) => onChange({ ...draft, ifNo: e.target.value })}
            />
          </FieldRow>
        </div>
      )}
    </div>
  );
}

/** How long after the slider is let go of before its weight is saved. */
const WEIGHT_AUTOSAVE_MS = 600;

/** What the row's weight slider says about its last save. */
type WeightStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string };

function weightLabel(weight: number): string {
  return weight >= FULL_WEIGHT ? 'Core' : String(weight);
}

/**
 * The weight, as a slider on the row, saved when it is let go of. Saves are
 * debounced, so a run of arrow-key presses is one save, and one at a time: the
 * PUT needs the question's revision, which only moves when the page refreshes
 * after a save. A value let go of meanwhile waits for that revision, then saves.
 */
function WeightSlider({
  question,
  onSaved,
  onWarn,
}: {
  question: DiscoveryQuestionView;
  onSaved: () => void;
  onWarn: (message: string) => void;
}) {
  const [weight, setWeight] = useState(question.weight);
  const [shownWeight, setShownWeight] = useState(question.weight);
  const [status, setStatus] = useState<WeightStatus>({ state: 'idle' });
  /** The slider holds a value not yet saved: moved, waiting, or on its way. */
  const [unsaved, setUnsaved] = useState(false);
  const latest = useRef(question);
  const inFlight = useRef(false);
  const queued = useRef<number | null>(null);
  const generation = useRef(0);
  /** A value let go of whose debounce has not fired yet. */
  const awaiting = useRef(false);
  const later = useTimeout();

  // A refresh brought a weight saved elsewhere (the dialog, a restore, an
  // import): show it, unless the slider holds a value of its own not yet saved.
  if (question.weight !== shownWeight) {
    setShownWeight(question.weight);
    if (!unsaved) setWeight(question.weight);
  }

  async function save(value: number) {
    const current = latest.current;
    if (value === current.weight) {
      setUnsaved(false);
      setStatus({ state: 'idle' });
      return;
    }
    inFlight.current = true;
    setStatus({ state: 'saving' });
    const result = await send<{ changed: string[] } & SlotSyncReport>(
      'PUT',
      contentItemEndpoint('questions', 'question', current.id),
      { revision: current.revision, ...bodyOf(draftOf(current)), weight: value }
    );
    if (!result.ok) {
      inFlight.current = false;
      queued.current = null;
      setUnsaved(false);
      setStatus({ state: 'error', message: result.message });
      return;
    }
    // Stays in flight until the refresh brings the new revision (below). A
    // value let go of meanwhile is still unsaved, so the refresh must not
    // snap the slider back to this save's value.
    setUnsaved(queued.current !== null || awaiting.current);
    setStatus({ state: 'saved' });
    const warning = slotSyncWarning(result.data);
    if (warning) onWarn(warning);
    else onSaved();
  }

  // The refresh after a save has landed: the revision moved, so a value let go
  // of while that save was in flight can be sent against it.
  useEffect(() => {
    latest.current = question;
    if (!inFlight.current) return;
    inFlight.current = false;
    const next = queued.current;
    queued.current = null;
    if (next !== null) void save(next);
    // `save` reads everything it needs through refs; the revision is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.revision]);

  function commit(value: number) {
    const mine = ++generation.current;
    awaiting.current = true;
    later(() => {
      if (mine !== generation.current) return;
      awaiting.current = false;
      if (inFlight.current) queued.current = value;
      else void save(value);
    }, WEIGHT_AUTOSAVE_MS);
  }

  const label = `Weight of question ${question.number}`;
  return (
    <div className="flex w-44 shrink-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <SliderPrimitive.Root
          className="relative flex w-28 touch-none items-center select-none"
          min={0}
          max={FULL_WEIGHT}
          step={1}
          value={[weight]}
          onValueChange={([value]) => {
            if (value === undefined) return;
            setWeight(value);
            setUnsaved(true);
            setStatus({ state: 'idle' });
          }}
          onValueCommit={([value]) => {
            if (value !== undefined) commit(value);
          }}
        >
          <SliderPrimitive.Track className="bg-primary/20 relative h-1.5 w-full grow overflow-hidden rounded-full">
            <SliderPrimitive.Range className="bg-primary absolute h-full" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            aria-label={label}
            aria-valuetext={weight >= FULL_WEIGHT ? `${weight}, Core Set` : String(weight)}
            className="border-primary/50 bg-background focus-visible:ring-ring block h-4 w-4 rounded-full border shadow transition-colors focus-visible:ring-1 focus-visible:outline-none"
          />
        </SliderPrimitive.Root>
        <span className="text-muted-foreground w-10 text-xs tabular-nums">
          {weightLabel(weight)}
        </span>
      </div>
      <span
        aria-live="polite"
        className={
          status.state === 'error' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
        }
      >
        {status.state === 'saving' && 'Saving…'}
        {status.state === 'saved' && 'Saved'}
        {status.state === 'error' && `Not saved: ${status.message}`}
      </span>
    </div>
  );
}

/**
 * The question's edit dialog. Keyed by the question's revision where it is
 * used, so a save anywhere re-reads the draft from the stored question.
 */
function QuestionDialog({
  question,
  count,
  readers,
  open,
  setOpen,
  onSaved,
}: {
  question: DiscoveryQuestionView;
  count: number;
  readers: readonly string[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onSaved: (message: string, tone?: SavedTone) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(question));
  const [notice, setNotice] = useState<Notice>(null);
  const id = `question-${question.id}`;

  function saved(message: string, tone?: SavedTone) {
    setOpen(false);
    onSaved(message, tone);
  }

  async function save() {
    const result = await send<{ changed: string[] } & SlotSyncReport>(
      'PUT',
      contentItemEndpoint('questions', 'question', question.id),
      {
        revision: question.revision,
        ...bodyOf(draft),
      }
    );
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    const warning = slotSyncWarning(result.data);
    if (warning) saved(warning, 'warn');
    else
      saved(
        result.data.changed.length ? `Saved question ${question.number}.` : 'Nothing had changed.'
      );
  }

  async function remove() {
    const result = await send<{ renumbered: number } & SlotSyncReport>(
      'DELETE',
      `${contentItemEndpoint('questions', 'question', question.id)}?revision=${question.revision}`
    );
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    const warning = slotSyncWarning(result.data);
    if (warning) saved(warning, 'warn');
    else saved(`Removed question ${question.number}. The questions after it moved up one.`);
  }

  return (
    <EditDialog
      open={open}
      onOpenChange={setOpen}
      title={`Question ${question.number}`}
      description={<code className="text-xs">{question.id}</code>}
      footer={
        <>
          <NoticeLine notice={notice} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save()}>
              Save question
            </Button>
            <HistoryButton
              collection="questions"
              entity="question"
              id={question.id}
              label={`question ${question.number}`}
              revisionRead={question.revision}
              onRestored={saved}
            />
            {!confirming ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirming(true)}
                disabled={count <= 1}
              >
                <Trash2 className="mr-1 h-4 w-4" aria-hidden />
                Remove
              </Button>
            ) : (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                Remove it, and its history? People&apos;s answers to it are kept, and its id is
                never used again. Read by {readers.join('; ')}.
                <Button type="button" variant="destructive" size="sm" onClick={() => void remove()}>
                  Remove question {question.number}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </Button>
              </span>
            )}
          </div>
        </>
      }
    >
      <QuestionFields id={id} draft={draft} onChange={setDraft} />
    </EditDialog>
  );
}

function QuestionRow({
  question,
  index,
  count,
  readers,
  onMove,
  onSaved,
  onRefresh,
}: {
  question: DiscoveryQuestionView;
  index: number;
  count: number;
  readers: readonly string[];
  onMove: (by: -1 | 1) => void;
  onSaved: (message: string, tone?: SavedTone) => void;
  /** Re-read the page after a save that needs no notice. */
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground w-8 text-sm">{question.number}</span>
        <button
          type="button"
          className="flex-1 text-left text-sm hover:underline"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {question.text}
        </button>
        <WeightSlider
          question={question}
          onSaved={onRefresh}
          onWarn={(message) => onSaved(message, 'warn')}
        />
        <code className="text-muted-foreground text-xs">{question.id}</code>
        <Tip label="Move up the list">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Move question ${question.number} up`}
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
            aria-label={`Move question ${question.number} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </Button>
        </Tip>
      </div>
      <QuestionDialog
        key={question.revision}
        question={question}
        count={count}
        readers={readers}
        open={open}
        setOpen={setOpen}
        onSaved={onSaved}
      />
    </li>
  );
}

function SetEditor({
  set,
  onSaved,
}: {
  set: DiscoveryQuestionSet;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState({
    title: set.collection.title,
    chartTitle: set.collection.chartTitle,
    moduleId: set.collection.module,
    phase: set.collection.phase,
    preambleStyle: set.preamble.style,
    preambleText: set.preamble.text,
    rushDiscouraged: set.pacing.rushDiscouraged,
    allowPartialCompletion: set.pacing.allowPartialCompletion,
    pacingNote: set.pacing.note,
    version: set.collection.version,
    locale: set.collection.locale,
  });
  const [notice, setNotice] = useState<Notice>(null);

  async function save() {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('questions', 'set', set.collection.id),
      {
        revision: set.collection.revision,
        title: draft.title,
        chartTitle: draft.chartTitle,
        moduleId: draft.moduleId,
        phase: draft.phase,
        preamble: { style: draft.preambleStyle, text: draft.preambleText },
        pacing: {
          rushDiscouraged: draft.rushDiscouraged,
          allowPartialCompletion: draft.allowPartialCompletion,
          note: draft.pacingNote,
        },
        version: draft.version,
        locale: draft.locale,
      }
    );
    if (result.ok)
      onSaved(result.data.changed.length ? 'Saved the question set.' : 'Nothing had changed.');
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">How the questions are framed</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <FieldRow id="set-title" label="Title" help="The set's title.">
          <Input
            id="set-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </FieldRow>
        <FieldRow
          id="set-chart"
          label="Chart title"
          help="The shorter title the journey chart uses."
        >
          <Input
            id="set-chart"
            value={draft.chartTitle}
            onChange={(e) => setDraft({ ...draft, chartTitle: e.target.value })}
          />
        </FieldRow>
        <FieldRow
          id="set-module"
          label="Module"
          help="The module these questions are asked in, by id (module_NN_words)."
        >
          <Input
            id="set-module"
            value={draft.moduleId}
            onChange={(e) => setDraft({ ...draft, moduleId: e.target.value })}
          />
        </FieldRow>
        <FieldRow id="set-phase" label="Phase" help="Which phase of that module asks them.">
          <Input
            id="set-phase"
            type="number"
            min={1}
            value={draft.phase}
            onChange={(e) => setDraft({ ...draft, phase: Number(e.target.value) })}
          />
        </FieldRow>
        <FieldRow
          id="set-version"
          label="Version"
          help="A label for this version of the questions."
        >
          <Input
            id="set-version"
            value={draft.version}
            onChange={(e) => setDraft({ ...draft, version: e.target.value })}
          />
        </FieldRow>
        <FieldRow id="set-locale" label="Locale" help="The language the questions are written in.">
          <Input
            id="set-locale"
            value={draft.locale}
            onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
          />
        </FieldRow>
      </div>
      <FieldRow
        id="set-preamble"
        label="Preamble"
        help="Her words before the first question: that these are not to be rushed."
      >
        <Textarea
          id="set-preamble"
          rows={4}
          value={draft.preambleText}
          onChange={(e) => setDraft({ ...draft, preambleText: e.target.value })}
        />
      </FieldRow>
      <FieldRow
        id="set-preamble-style"
        label="Preamble style"
        help="How the preamble is set, as a name clients switch on."
      >
        <Input
          id="set-preamble-style"
          value={draft.preambleStyle}
          onChange={(e) => setDraft({ ...draft, preambleStyle: e.target.value })}
        />
      </FieldRow>
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <Switch
            id="set-rush"
            checked={draft.rushDiscouraged}
            onCheckedChange={(rushDiscouraged) => setDraft({ ...draft, rushDiscouraged })}
          />
          <Label htmlFor="set-rush">Discourage rushing</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="set-partial"
            checked={draft.allowPartialCompletion}
            onCheckedChange={(allowPartialCompletion) =>
              setDraft({ ...draft, allowPartialCompletion })
            }
          />
          <Label htmlFor="set-partial">Allow stopping part-way</Label>
        </div>
      </div>
      <FieldRow
        id="set-pacing"
        label="Pacing note"
        help="Her note on pace, shown with the questions."
      >
        <Textarea
          id="set-pacing"
          rows={2}
          value={draft.pacingNote}
          onChange={(e) => setDraft({ ...draft, pacingNote: e.target.value })}
        />
      </FieldRow>
      <NoticeLine notice={notice} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void save()}>
          Save framing
        </Button>
        <HistoryButton
          collection="questions"
          entity="set"
          id={set.collection.id}
          label="the question set"
          revisionRead={set.collection.revision}
          onRestored={onSaved}
        />
      </div>
    </section>
  );
}

/**
 * Where the questions belong (t-101). They are the slots of the module that
 * asks them, and the Core Set switch is that module's own config, so it is set
 * on the module's Config tab and only reported here.
 */
function OwningModuleNote({ module }: { module: QuestionsOwningModule }) {
  return (
    <section className="space-y-1 rounded-md border p-4 text-sm">
      <h3 className="font-medium">Asked in the {module.name} module</h3>
      <p className="text-muted-foreground">
        Each question is a data slot of the {module.name} module, and a person’s answer is filed
        under it. <strong>Core Set only</strong> is{' '}
        <strong>{module.coreSetOnly ? 'on' : 'off'}</strong>:{' '}
        {module.coreSetOnly
          ? `a person is asked only the questions weighted ${FULL_WEIGHT}.`
          : 'a person is asked every question.'}{' '}
        A question weighted {FULL_WEIGHT} is core: it is always asked and cannot be skipped.{' '}
        <Link href={`/admin/framework/modules/${module.slug}`} className="underline">
          Change it in the module’s settings
        </Link>
        .
      </p>
    </section>
  );
}

export function QuestionsPanel({ initialView }: { initialView: QuestionsAdminView }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState(() => draftOf());
  const set = initialView.set;

  function done(message: string, tone: SavedTone = 'ok') {
    setNotice({ tone, text: message });
    router.refresh();
  }

  if (!set) {
    return (
      <p className="text-muted-foreground text-sm">
        The discovery questions have not been seeded yet. Run <code>npm run db:seed</code>.
      </p>
    );
  }
  const questions = set.questions;

  async function move(index: number, by: -1 | 1) {
    const order = questions.map((question) => ({ id: question.id, revision: question.revision }));
    const [taken] = order.splice(index, 1);
    order.splice(index + by, 0, taken);
    const result = await send<{ moved: number }>('PUT', contentOrderEndpoint('questions'), {
      order,
    });
    if (result.ok) done('Saved the new order.');
    else setNotice({ tone: 'error', text: result.message });
  }

  async function add() {
    const result = await send<{ id: string; number: number } & SlotSyncReport>(
      'POST',
      contentEntityEndpoint('questions', 'question'),
      bodyOf(newDraft)
    );
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setAdding(false);
    setNewDraft(draftOf());
    const warning = slotSyncWarning(result.data);
    if (warning) done(warning, 'warn');
    else done(`Added question ${result.data.number} (${result.data.id}).`);
  }

  return (
    <div className="space-y-6">
      <NoticeLine notice={notice} />
      <ReadersNote readers={initialView.readers} lead="Read today by" />
      {initialView.module && <OwningModuleNote module={initialView.module} />}
      <SetEditor key={`set@${set.collection.revision}`} set={set} onSaved={done} />
      <section className="space-y-3">
        <h3 className="font-medium">The questions ({questions.length})</h3>
        <ol className="space-y-2">
          {questions.map((question, index) => (
            <QuestionRow
              key={question.id}
              question={question}
              index={index}
              count={questions.length}
              readers={initialView.readers}
              onMove={(by) => void move(index, by)}
              onSaved={done}
              onRefresh={() => router.refresh()}
            />
          ))}
        </ol>
        {adding ? (
          <div className="space-y-3 rounded-md border p-3">
            <QuestionFields id="new-question" draft={newDraft} onChange={setNewDraft} />
            <div className="flex gap-2">
              <Button type="button" onClick={() => void add()}>
                Add at the end
              </Button>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Add a question
          </Button>
        )}
      </section>
      <ImportExportPanel
        collection="questions"
        fileName="onboarding_discovery_questions.json"
        what="the questions"
        removal={{
          note: 'A removed question is deleted with its history, and the rest are numbered again. People’s answers to it are kept, and its id is never used again.',
        }}
        onApplied={done}
      />
    </div>
  );
}
