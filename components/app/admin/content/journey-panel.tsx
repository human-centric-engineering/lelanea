'use client';

/**
 * The journey's text, edited (f-content-seeds t-91): the journey's own title,
 * each tier's label and intent, and each module's title, subtitle and phases.
 *
 * Which modules exist, their numbers and their tiers are fixed in code (the
 * roster), so nothing here adds or removes one. A module's subtitle and chart
 * title can be cleared; a tier's label and intent cannot, because the drawer
 * shows both. Phases are edited field by field, since their titles and
 * descriptions are her words; the phase groupings and what a module produces
 * are structure, edited as JSON.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { contentItemEndpoint } from '@/lib/app/content/admin/endpoint';
import { JOURNEY_READERS } from '@/lib/app/content/admin/readers';
import type { JourneyAdminView } from '@/lib/app/content/admin/journey';
import type {
  JourneyModuleView,
  JourneyTierView,
  StoredPhase,
} from '@/lib/app/content/journey-view';

const PHASE_TIERS = ['orientation', 'discernment', 'integration'] as const;

/** A phase as the form holds it: `produces` is whatever JSON was typed, checked on save. */
type Phase = Omit<StoredPhase, 'produces'> & { produces: unknown };

function TierEditor({
  tier,
  onSaved,
}: {
  tier: JourneyTierView;
  onSaved: (message: string) => void;
}) {
  const [label, setLabel] = useState(tier.label);
  const [intent, setIntent] = useState(tier.intent);
  const [notice, setNotice] = useState<Notice>(null);
  const id = `tier-${tier.id}`;

  async function save() {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('journey', 'tier', tier.id),
      {
        revision: tier.revision,
        label,
        intent,
      }
    );
    if (result.ok)
      onSaved(result.data.changed.length ? `Saved the tier "${label}".` : 'Nothing had changed.');
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <li className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <span className="font-medium">{tier.label}</span>
        <code className="text-muted-foreground text-xs">{tier.id}</code>
        <span className="text-muted-foreground text-xs">revision {tier.revision}</span>
      </div>
      <FieldRow
        id={`${id}-label`}
        label="Label"
        help="The tier's name, as the map drawer and the home page show it. Required."
      >
        <Input id={`${id}-label`} value={label} onChange={(e) => setLabel(e.target.value)} />
      </FieldRow>
      <FieldRow
        id={`${id}-intent`}
        label="Intent"
        help="What this tier of the journey is for, in her words. Required: the drawer shows it."
      >
        <Textarea
          id={`${id}-intent`}
          rows={3}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
        />
      </FieldRow>
      <NoticeLine notice={notice} />
      <div className="flex gap-2">
        <Button type="button" onClick={() => void save()}>
          Save tier
        </Button>
        <HistoryButton
          collection="journey"
          entity="tier"
          id={tier.id}
          label={`the tier "${tier.label}"`}
          revisionRead={tier.revision}
          onRestored={onSaved}
        />
      </div>
    </li>
  );
}

function PhaseEditor({
  idPrefix,
  phase,
  onChange,
  onRemove,
}: {
  idPrefix: string;
  phase: Phase;
  onChange: (phase: Phase) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof Phase>(key: K, value: Phase[K]) =>
    onChange({ ...phase, [key]: value });
  const [producesError, setProducesError] = useState(false);
  return (
    <li className="space-y-2 rounded border p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <FieldRow
          id={`${idPrefix}-number`}
          label="Number"
          help="The phase's place in the module, from 1. Unique within the module."
        >
          <Input
            id={`${idPrefix}-number`}
            type="number"
            min={1}
            value={phase.number}
            onChange={(e) => set('number', Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow
          id={`${idPrefix}-display`}
          label="Shown as"
          help="The number as it is shown, for example 1.2."
        >
          <Input
            id={`${idPrefix}-display`}
            value={phase.displayNumber}
            onChange={(e) => set('displayNumber', e.target.value)}
          />
        </FieldRow>
        <FieldRow
          id={`${idPrefix}-tier`}
          label="Phase tier"
          help="orientation, discernment or integration, or empty for none."
        >
          <select
            id={`${idPrefix}-tier`}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            value={phase.phaseTier ?? ''}
            onChange={(e) =>
              set('phaseTier', PHASE_TIERS.find((tier) => tier === e.target.value) ?? null)
            }
          >
            <option value="">none</option>
            {PHASE_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow
          id={`${idPrefix}-questions`}
          label="Questions"
          help="How many questions the phase asks, where it asks a set. Empty for none."
        >
          <Input
            id={`${idPrefix}-questions`}
            type="number"
            min={0}
            value={phase.questionCount ?? ''}
            onChange={(e) =>
              set('questionCount', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </FieldRow>
      </div>
      <FieldRow id={`${idPrefix}-title`} label="Title" help="The phase's title, in her words.">
        <Input
          id={`${idPrefix}-title`}
          value={phase.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </FieldRow>
      <FieldRow
        id={`${idPrefix}-description`}
        label="Description"
        help="What happens in this phase, in her words."
      >
        <Textarea
          id={`${idPrefix}-description`}
          rows={3}
          value={phase.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </FieldRow>
      <div className="grid gap-2 md:grid-cols-2">
        <FieldRow
          id={`${idPrefix}-ref`}
          label="Content reference"
          help="The id of the content this phase opens, or empty where nothing is authored yet."
        >
          <Input
            id={`${idPrefix}-ref`}
            value={phase.contentRef ?? ''}
            onChange={(e) => set('contentRef', orNull(e.target.value))}
          />
        </FieldRow>
        <FieldRow
          id={`${idPrefix}-produces`}
          label="Produces (JSON)"
          help={
            <>
              What the phase produces, as <code>{'{"artifact": …, "revisitable": …}'}</code>, or{' '}
              <code>null</code>.
            </>
          }
        >
          <Input
            id={`${idPrefix}-produces`}
            className="font-mono text-xs"
            defaultValue={JSON.stringify(phase.produces)}
            aria-invalid={producesError}
            onBlur={(e) => {
              try {
                set('produces', JSON.parse(e.target.value) as unknown);
                setProducesError(false);
              } catch {
                setProducesError(true);
              }
            }}
          />
          {producesError && (
            <p role="alert" className="text-destructive text-xs">
              That is not JSON, so it was not taken. Type an object or null.
            </p>
          )}
        </FieldRow>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {(['proposed', 'personalized', 'requiresAcknowledgement'] as const).map((flag) => (
          <div key={flag} className="flex items-center gap-2">
            <Switch
              id={`${idPrefix}-${flag}`}
              checked={phase[flag]}
              onCheckedChange={(checked) => set(flag, checked)}
            />
            <Label htmlFor={`${idPrefix}-${flag}`}>
              {flag === 'requiresAcknowledgement' ? 'must be acknowledged' : flag}
            </Label>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onRemove}>
          <Trash2 className="mr-1 h-4 w-4" aria-hidden />
          Remove phase
        </Button>
      </div>
    </li>
  );
}

function ModuleEditor({
  module,
  open,
  onOpenChange,
  onSaved,
}: {
  module: JourneyModuleView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<{
    displayNumber: string;
    title: string;
    subtitle: string;
    chartTitle: string;
    phases: Phase[];
    phaseTiers: string;
    produces: string;
  }>({
    displayNumber: module.displayNumber,
    title: module.title,
    subtitle: module.subtitle ?? '',
    chartTitle: module.chartTitle ?? '',
    phases: module.phases.map((phase) => ({ ...phase })),
    phaseTiers: JSON.stringify(module.phaseTiers, null, 2),
    produces: JSON.stringify(module.produces, null, 2),
  });
  const [notice, setNotice] = useState<Notice>(null);
  const id = `module-${module.id}`;

  async function save() {
    let phaseTiers: unknown;
    let produces: unknown;
    try {
      phaseTiers = JSON.parse(draft.phaseTiers) as unknown;
      produces = JSON.parse(draft.produces) as unknown;
    } catch {
      setNotice({
        tone: 'error',
        text: 'Phase groupings and "produces" must be valid JSON (or null).',
      });
      return;
    }
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('journey', 'module', module.id),
      {
        revision: module.revision,
        displayNumber: draft.displayNumber,
        title: draft.title,
        subtitle: orNull(draft.subtitle),
        chartTitle: orNull(draft.chartTitle),
        phases: draft.phases,
        phaseTiers,
        produces,
      }
    );
    if (result.ok)
      onSaved(result.data.changed.length ? `Saved "${draft.title}".` : 'Nothing had changed.');
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={module.title}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{module.tier}</Badge>
          <span className="text-xs">revision {module.revision}</span>
        </span>
      }
      footer={
        <>
          <NoticeLine notice={notice} />
          <div className="flex gap-2">
            <Button type="button" onClick={() => void save()}>
              Save module
            </Button>
            <HistoryButton
              collection="journey"
              entity="module"
              id={module.id}
              label={`"${module.title}"`}
              revisionRead={module.revision}
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
            help="Her title for the module. This is the one place it is written: the drawer, the module page, the home page and the AI all read it from here. (Daybreak keeps its own operator label for the module; that is not hers and is not changed.)"
          >
            <Input
              id={`${id}-title`}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-number`}
            label="Shown as"
            help="The module's number as it is shown, for example 01. Its real place in the journey is fixed in code."
          >
            <Input
              id={`${id}-number`}
              value={draft.displayNumber}
              onChange={(e) => setDraft({ ...draft, displayNumber: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-subtitle`}
            label="Subtitle"
            help="Shown under the title. Clear it to remove it."
          >
            <Input
              id={`${id}-subtitle`}
              value={draft.subtitle}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-chart`}
            label="Chart title"
            help="The shorter title the journey chart uses. Clear it to remove it."
          >
            <Input
              id={`${id}-chart`}
              value={draft.chartTitle}
              onChange={(e) => setDraft({ ...draft, chartTitle: e.target.value })}
            />
          </FieldRow>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Phases</h4>
          <ol className="space-y-2">
            {draft.phases.map((phase, index) => (
              <PhaseEditor
                key={index}
                idPrefix={`${id}-phase-${index}`}
                phase={phase}
                onChange={(next) =>
                  setDraft({
                    ...draft,
                    phases: draft.phases.map((p, at) => (at === index ? next : p)),
                  })
                }
                onRemove={() =>
                  setDraft({ ...draft, phases: draft.phases.filter((_, at) => at !== index) })
                }
              />
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft({
                ...draft,
                phases: [
                  ...draft.phases,
                  {
                    number: draft.phases.length + 1,
                    displayNumber: String(draft.phases.length + 1),
                    title: '',
                    description: '',
                    contentRef: null,
                    proposed: true,
                    phaseTier: null,
                    questionCount: null,
                    personalized: false,
                    requiresAcknowledgement: false,
                    produces: null,
                  },
                ],
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Add a phase
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow
            id={`${id}-tiers`}
            label="Phase groupings (JSON)"
            help="How the phases are grouped into orientation, discernment and integration, or null. Each group names phases this module has."
          >
            <Textarea
              id={`${id}-tiers`}
              rows={6}
              className="font-mono text-xs"
              value={draft.phaseTiers}
              onChange={(e) => setDraft({ ...draft, phaseTiers: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id={`${id}-produces`}
            label="Produces (JSON)"
            help="What finishing the module leaves the person with, or null."
          >
            <Textarea
              id={`${id}-produces`}
              rows={6}
              className="font-mono text-xs"
              value={draft.produces}
              onChange={(e) => setDraft({ ...draft, produces: e.target.value })}
            />
          </FieldRow>
        </div>
      </div>
    </EditDialog>
  );
}

function journeyMetaOf(view: JourneyAdminView) {
  return {
    title: view.structure?.collection.title ?? '',
    subtitle: view.structure?.collection.subtitle ?? '',
    version: view.structure?.collection.version ?? '',
    locale: view.structure?.collection.locale ?? '',
    updatedAt: view.updatedAt ?? '',
  };
}

export function JourneyPanel({ initialView }: { initialView: JourneyAdminView }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [open, setOpen] = useState<string | null>(null);
  const structure = initialView.structure;
  // The form holds the lock it was filled at, beside the values. After a
  // refresh brings a newer collection (an import, another admin), the form is
  // refilled from it: sending the new lock with values typed over the old one
  // would pass the check and put the old values back.
  const [meta, setMeta] = useState(() => journeyMetaOf(initialView));
  if (initialView.updatedAt && meta.updatedAt !== initialView.updatedAt) {
    setMeta(journeyMetaOf(initialView));
  }

  function done(message: string) {
    setOpen(null);
    setNotice({ tone: 'ok', text: message });
    router.refresh();
  }

  if (!structure || !initialView.updatedAt) {
    return (
      <p className="text-muted-foreground text-sm">
        The journey has not been seeded yet. Run <code>npm run db:seed</code>.
      </p>
    );
  }
  async function saveMeta() {
    const result = await send<{ changed: string[] }>(
      'PUT',
      contentItemEndpoint('journey', 'journey', structure!.collection.id),
      {
        title: meta.title,
        subtitle: meta.subtitle,
        version: meta.version,
        locale: meta.locale,
        updatedAt: meta.updatedAt,
      }
    );
    if (result.ok) done(result.data.changed.length ? 'Saved the journey.' : 'Nothing had changed.');
    else setNotice({ tone: 'error', text: result.message });
  }

  return (
    <div className="space-y-6">
      <NoticeLine notice={notice} />
      <ReadersNote readers={JOURNEY_READERS} lead="An edit here reaches, on their next request:" />
      <section className="space-y-3 rounded-md border p-4">
        <h3 className="font-medium">The journey</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow
            id="journey-title"
            label="Title"
            help="The journey's title, as the home page shows it."
          >
            <Input
              id="journey-title"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </FieldRow>
          <FieldRow id="journey-subtitle" label="Subtitle" help="Shown under the journey's title.">
            <Input
              id="journey-subtitle"
              value={meta.subtitle}
              onChange={(e) => setMeta({ ...meta, subtitle: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id="journey-version"
            label="Version"
            help="A label for this version of the journey's text."
          >
            <Input
              id="journey-version"
              value={meta.version}
              onChange={(e) => setMeta({ ...meta, version: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            id="journey-locale"
            label="Locale"
            help="The language the journey's text is written in, for example en-US."
          >
            <Input
              id="journey-locale"
              value={meta.locale}
              onChange={(e) => setMeta({ ...meta, locale: e.target.value })}
            />
          </FieldRow>
        </div>
        <Button type="button" variant="outline" onClick={() => void saveMeta()}>
          Save journey
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Tiers</h3>
        <ol className="space-y-3">
          {structure.tiers.map((tier) => (
            <TierEditor key={`${tier.id}@${tier.revision}`} tier={tier} onSaved={done} />
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Modules</h3>
        <ol className="space-y-2">
          {structure.modules.map((module) => (
            <li key={module.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground w-8 text-sm">{module.displayNumber}</span>
                <button
                  type="button"
                  className="font-medium hover:underline"
                  aria-haspopup="dialog"
                  onClick={() => setOpen(module.id)}
                >
                  {module.title}
                </button>
                <Badge variant="outline">{module.tier}</Badge>
                <span className="text-muted-foreground text-xs">
                  {module.phases.length} phases · revision {module.revision}
                </span>
              </div>
              <ModuleEditor
                key={`${module.id}@${module.revision}`}
                module={module}
                open={open === module.id}
                onOpenChange={(next) => setOpen(next ? module.id : null)}
                onSaved={done}
              />
            </li>
          ))}
        </ol>
      </section>

      <ImportExportPanel
        collection="journey"
        fileName="lelanea_module_structure.json"
        what="the journey"
        onApplied={done}
      />
    </div>
  );
}
