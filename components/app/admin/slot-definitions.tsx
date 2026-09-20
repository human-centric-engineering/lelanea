'use client';

/**
 * The slot taxonomy, edited (f-slots t-71).
 *
 * What the app is trying to learn about a person, grouped, each row opening
 * into an editor and a version history. A slot can be added, reworded, retired
 * and restored; a whole taxonomy file can be reconciled against what is stored,
 * previewed first.
 *
 * ## Three things this surface refuses to do, and says so
 *
 * - **A slug cannot be edited.** It is what every answer already captured points
 *   at, so renaming one would orphan them. The field is shown, disabled, with
 *   the remedy beside it: add the new slug and retire the old. The route refuses
 *   a slug in the body as well — this is the explanation, not the enforcement.
 * - **Retiring does not delete.** The row stays and its answers keep resolving;
 *   the wording is "Retire", the retired rows stay on the page, and restoring is
 *   one click.
 * - **An upload never silently retires.** Nothing is written until a preview has
 *   been read, and the plan names every slug it would retire, every one it would
 *   leave alone, and every retired one it is refusing to revive.
 *
 * **The browser checks nothing the route does not.** The route's schema is the
 * authority and its message is what the admin reads — including the 409 from a
 * stale form, which is shown verbatim because it names both versions.
 *
 * @see app/api/v1/admin/app/slots/
 * @see .context/app/slots.md
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, History, Plus, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import { ClientDate } from '@/components/ui/client-date';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { parseApiResponse } from '@/lib/api/parse-response';
import {
  SLOT_DEFINITIONS_ENDPOINT,
  SLOT_TAXONOMY_EXPORT_ENDPOINT,
  SLOT_TAXONOMY_UPLOAD_ENDPOINT,
  SLOT_TAXONOMY_UPLOAD_PREVIEW_ENDPOINT,
  slotDefinitionActiveEndpoint,
  slotDefinitionEndpoint,
  slotDefinitionHistoryEndpoint,
} from '@/lib/app/slots/endpoint';
import { MAX_DESCRIPTION_LENGTH } from '@/lib/app/slots/validation';
import type { SlotUploadMode } from '@/lib/app/slots/validation';
import type {
  SlotDefinitionRow,
  SlotRevisionRow,
  SlotSyncOutcome,
  SlotTaxonomyAdminView,
  SlotUploadPlan,
} from '@/lib/app/slots/definitions-admin';

/**
 * Dates are strings once serialised.
 *
 * The `Date` arm is tested **before** the nullable one, and that ordering is
 * the point: a non-nullable `Date` also satisfies `Date | null`, so a single
 * `extends Date | null` arm widened every date on these rows to include `null`
 * — a value none of them can hold. That forced an `as string` at the one place
 * a date is read, which is an `as` on API response data and against the house
 * rule. Splitting the arms keeps the nullability the row actually declares and
 * lets the cast go.
 */
type Jsonified<T> = {
  [K in keyof T]: T[K] extends Date
    ? string | Date
    : T[K] extends Date | null
      ? string | Date | null
      : T[K];
};
type DefinitionJson = Jsonified<SlotDefinitionRow>;
type RevisionJson = Jsonified<SlotRevisionRow>;

export interface SlotViewJson {
  definitions: DefinitionJson[];
  groups: string[];
  seeded: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * The first message worth showing from an error envelope: a field's, else the
 * top line.
 *
 * **Named by its field where it has one.** Both producers of this shape —
 * `validateRequestBody` in `lib/api/validation.ts` and the upload's own
 * `parseTaxonomyUploadFile` — build `path` as an already-joined string
 * (`issue.path.join('.')`). Dropping it left a bare Zod string on screen:
 * "Required" against a 200-line taxonomy file names nothing an admin can act
 * on, which undercuts the upload's stated point that the admin reads the same
 * errors the seed would. A refinement whose path is empty is self-describing
 * and is shown unchanged.
 */
function errorMessage(error: { message: string; details?: unknown }): string {
  const details = error.details;
  if (details && typeof details === 'object' && 'errors' in details) {
    const errors = details.errors;
    if (Array.isArray(errors)) {
      const first: unknown = errors[0];
      if (first && typeof first === 'object' && 'message' in first) {
        const message = first.message;
        if (typeof message === 'string') {
          const path = 'path' in first ? first.path : undefined;
          return typeof path === 'string' && path !== '' ? `${path} — ${message}` : message;
        }
      }
    }
  }
  return error.message;
}

async function send<T>(method: string, url: string, body?: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await parseApiResponse<T>(response);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, message: errorMessage(parsed.error) };
  } catch {
    return { ok: false, message: 'The request did not reach the server. Nothing was changed.' };
  }
}

/**
 * What to say when a write landed but the projection did not.
 *
 * The edit IS saved — the route would have refused it otherwise — so this is a
 * warning, not an error, and it names the remedy rather than the diagnosis
 * (`HB10`): the pass is idempotent, so saving again re-runs it.
 */
function syncWarning(sync: SlotSyncOutcome): string | null {
  if (sync.status === 'synced' || sync.status === 'not_needed') return null;
  if (sync.status === 'empty') {
    return 'Saved. Every data slot is now retired, so nothing was handed to the AI — and the last retirement is not propagated until another change is made.';
  }
  return 'Saved — but the AI is still reading the previous wording: the projection did not update. Save again to retry it; a server restart also repairs it.';
}

const VISIBILITY = [
  { value: 'open', label: 'Open — the person sees it' },
  { value: 'hidden', label: 'Hidden — system only' },
];

const DATA_TYPE = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' },
  { value: 'json', label: 'Structured (JSON)' },
];

const SENSITIVITY = [
  { value: 'standard', label: 'Standard' },
  { value: 'sensitive', label: 'Sensitive' },
  { value: 'special_category', label: 'Special category' },
];

const HELP = {
  slug: 'The permanent name of this data slot, and what every answer already captured points at. It cannot be changed — to rename one, add a data slot under the new name and retire this one. The old answers stay readable under the old name.',
  group:
    'Which cluster this data slot belongs to on this page. Moving one between groups changes nothing about what is captured; it is how the taxonomy reads.',
  description:
    'What this data slot means — and the exact words the capture layer is given, so write it as an instruction rather than as a label. Rewording it does not change any answer already given: each answer is read back against the wording that stood when it was captured.',
  visibility:
    'Whether the person this is about can see the value and correct it. Hidden means it never leaves the server to a member — which is what keeps a development-stage reading a tuning signal rather than a grade. Development slots must never rank or score someone to their face, and hiding them is the mechanism, not a default.',
  dataType:
    'How the answer is stored in its typed form. The plain-language answer is always kept as text as well, so changing this does not invalidate anything already captured.',
  sensitivity:
    'How careful the capture layer is with the answer. This classifies the DATA SLOT, not what lands in it — a sensitive one can still receive something special-category in fact. Do not promote everything to special category: that empties the distinction the masking reads.',
  priorityWeight: 'How early this is asked for, relative to the others. Higher is sooner. 0–100.',
};

function definitionBadges(definition: DefinitionJson) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {!definition.isActive && <Badge variant="outline">Retired</Badge>}
      {definition.visibility === 'hidden' && <Badge variant="secondary">Hidden</Badge>}
      {definition.sensitivity !== 'standard' && (
        <Badge variant="outline">{definition.sensitivity.replace('_', ' ')}</Badge>
      )}
      <span className="text-muted-foreground text-xs">v{definition.version}</span>
    </span>
  );
}

// ─── One definition's form ──────────────────────────────────────────────────

interface DraftFields {
  group: string;
  description: string;
  visibility: string;
  dataType: string;
  sensitivity: string;
  priorityWeight: string;
}

function toDraft(definition: DefinitionJson): DraftFields {
  return {
    group: definition.group,
    description: definition.description,
    visibility: definition.visibility,
    dataType: definition.dataType,
    sensitivity: definition.sensitivity,
    priorityWeight: String(definition.priorityWeight),
  };
}

/**
 * The authored fields, as the route takes them.
 *
 * `priorityWeight` is held as a string while it is being typed (an empty input
 * is not the number 0) and converted here. A value that is not a number at all
 * goes over as `NaN`, which the route refuses with its own message — the
 * browser is not a second authority.
 */
function toPayload(draft: DraftFields) {
  return {
    group: draft.group.trim(),
    description: draft.description,
    visibility: draft.visibility,
    dataType: draft.dataType,
    sensitivity: draft.sensitivity,
    priorityWeight: Number(draft.priorityWeight),
  };
}

function FieldRow({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: string;
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

function ClassifierFields({
  idPrefix,
  draft,
  groups,
  disabled,
  onChange,
}: {
  idPrefix: string;
  draft: DraftFields;
  groups: string[];
  disabled: boolean;
  onChange: (next: Partial<DraftFields>) => void;
}) {
  return (
    <>
      <FieldRow id={`${idPrefix}-group`} label="Group" help={HELP.group}>
        <Select
          value={draft.group}
          disabled={disabled}
          onValueChange={(value) => onChange({ group: value })}
        >
          <SelectTrigger id={`${idPrefix}-group`} aria-label="Group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectItem key={group} value={group}>
                {group.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow id={`${idPrefix}-visibility`} label="Visibility" help={HELP.visibility}>
        <Select
          value={draft.visibility}
          disabled={disabled}
          onValueChange={(value) => onChange({ visibility: value })}
        >
          <SelectTrigger id={`${idPrefix}-visibility`} aria-label="Visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISIBILITY.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow id={`${idPrefix}-dataType`} label="Answer type" help={HELP.dataType}>
        <Select
          value={draft.dataType}
          disabled={disabled}
          onValueChange={(value) => onChange({ dataType: value })}
        >
          <SelectTrigger id={`${idPrefix}-dataType`} aria-label="Answer type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATA_TYPE.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow id={`${idPrefix}-sensitivity`} label="Sensitivity" help={HELP.sensitivity}>
        <Select
          value={draft.sensitivity}
          disabled={disabled}
          onValueChange={(value) => onChange({ sensitivity: value })}
        >
          <SelectTrigger id={`${idPrefix}-sensitivity`} aria-label="Sensitivity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SENSITIVITY.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow id={`${idPrefix}-priority`} label="Asked how early" help={HELP.priorityWeight}>
        <Input
          id={`${idPrefix}-priority`}
          type="number"
          min={0}
          max={100}
          value={draft.priorityWeight}
          disabled={disabled}
          onChange={(event) => onChange({ priorityWeight: event.target.value })}
        />
      </FieldRow>
    </>
  );
}

function DefinitionForm({
  definition,
  groups,
  onSaved,
  onError,
}: {
  definition: DefinitionJson;
  groups: string[];
  onSaved: (definition: DefinitionJson, sync: SlotSyncOutcome, changed: string[]) => void;
  onError: (message: string) => void;
}) {
  /**
   * The row this draft was made from — **not** the live `definition` prop.
   *
   * The prop moves on underneath an open form: opening the import panel does
   * not close one, and an upload (or a retirement from the row's own button)
   * re-reads the list at a new version while this form still holds a draft made
   * from the old wording. Sending the *new* version with that *old* draft is a
   * write the route cannot refuse — the conditional `updateMany` matches, and
   * the import's wording is overwritten with nobody told. That is precisely the
   * lost update `versionMoved` exists to prevent, arriving through the one door
   * the lock does not watch.
   *
   * Snapshotting keeps the draft and the version it was derived from in step,
   * so such a save is refused 409 and the admin reads "changed by someone else
   * since you opened it" — with their own text still on screen to re-apply.
   */
  const [loaded, setLoaded] = useState(definition);
  const [draft, setDraft] = useState<DraftFields>(() => toDraft(definition));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await send<{
      definition: DefinitionJson;
      changed: string[];
      sync: SlotSyncOutcome;
    }>('PUT', slotDefinitionEndpoint(loaded.slug), {
      ...toPayload(draft),
      version: loaded.version,
    });
    setBusy(false);
    if (!result.ok) return onError(result.message);
    // This form now stands on the version it just wrote, so a second save in a
    // row names that one rather than the version the form was opened at.
    setLoaded(result.data.definition);
    onSaved(result.data.definition, result.data.sync, result.data.changed);
  }

  return (
    <form
      aria-label={`Edit ${loaded.slug}`}
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="sm:col-span-2">
        <FieldRow id={`${loaded.slug}-slug`} label="Slug" help={HELP.slug}>
          <Input id={`${loaded.slug}-slug`} value={loaded.slug} disabled readOnly />
          <p className="text-muted-foreground text-xs">
            Permanent. To rename, add a data slot under the new name and retire this one — the
            answers already given stay readable under this one.
          </p>
        </FieldRow>
      </div>

      <div className="sm:col-span-2">
        <FieldRow id={`${loaded.slug}-description`} label="What it means" help={HELP.description}>
          <Textarea
            id={`${loaded.slug}-description`}
            rows={4}
            maxLength={MAX_DESCRIPTION_LENGTH}
            value={draft.description}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </FieldRow>
      </div>

      <ClassifierFields
        idPrefix={loaded.slug}
        draft={draft}
        groups={groups}
        disabled={busy}
        onChange={(next) => setDraft({ ...draft, ...next })}
      />

      <div className="flex items-center gap-2 sm:col-span-2">
        {/* The version this form will name, which is the one its draft was made
            from — so the button cannot advertise a version the save is not
            sending. */}
        <Button type="submit" disabled={busy}>
          Save v{loaded.version}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => setDraft(toDraft(loaded))}
        >
          Undo my changes
        </Button>
      </div>
    </form>
  );
}

// ─── Adding ─────────────────────────────────────────────────────────────────

function AddDefinitionForm({
  groups,
  onAdded,
  onError,
}: {
  groups: string[];
  onAdded: (definition: DefinitionJson, sync: SlotSyncOutcome) => void;
  onError: (message: string) => void;
}) {
  const [slug, setSlug] = useState('');
  const [draft, setDraft] = useState<DraftFields>({
    group: groups[0] ?? '',
    description: '',
    visibility: 'open',
    dataType: 'text',
    sensitivity: 'standard',
    priorityWeight: '50',
  });
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    const result = await send<{ definition: DefinitionJson; sync: SlotSyncOutcome }>(
      'POST',
      SLOT_DEFINITIONS_ENDPOINT,
      { slug: slug.trim(), ...toPayload(draft) }
    );
    setBusy(false);
    if (!result.ok) return onError(result.message);
    onAdded(result.data.definition, result.data.sync);
  }

  return (
    <form
      aria-label="Add a data slot"
      className="bg-muted/40 grid gap-4 rounded-md border p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <div className="sm:col-span-2">
        <FieldRow id="new-slug" label="Slug" help={HELP.slug}>
          <Input
            id="new-slug"
            value={slug}
            disabled={busy}
            placeholder="life_physical_health"
            onChange={(event) => setSlug(event.target.value)}
          />
        </FieldRow>
      </div>

      <div className="sm:col-span-2">
        <FieldRow id="new-description" label="What it means" help={HELP.description}>
          <Textarea
            id="new-description"
            rows={4}
            maxLength={MAX_DESCRIPTION_LENGTH}
            value={draft.description}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </FieldRow>
      </div>

      <ClassifierFields
        idPrefix="new"
        draft={draft}
        groups={groups}
        disabled={busy}
        onChange={(next) => setDraft({ ...draft, ...next })}
      />

      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          Add this data slot
        </Button>
      </div>
    </form>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

function HistoryList({ slug, onError }: { slug: string; onError: (message: string) => void }) {
  const [revisions, setRevisions] = useState<RevisionJson[] | null>(null);

  useEffect(() => {
    // Guarded against a slug that changes while the request is in flight: the
    // list is rendered per slug, so a late response for the previous one would
    // otherwise show that slot's history under this one's heading.
    let current = true;
    setRevisions(null);
    void send<{ revisions: RevisionJson[] }>('GET', slotDefinitionHistoryEndpoint(slug)).then(
      (result) => {
        if (!current) return;
        if (result.ok) setRevisions(result.data.revisions);
        else {
          setRevisions([]);
          onError(result.message);
        }
      }
    );
    return () => {
      current = false;
    };
    // `onError` is the panel's `report`, redefined on every render; depending on
    // it would refetch the history on every keystroke elsewhere on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (revisions === null) {
    return <p className="text-muted-foreground text-sm">Reading the history…</p>;
  }

  if (revisions.length === 0) {
    return <p className="text-muted-foreground text-sm">No versions recorded.</p>;
  }

  return (
    <ol aria-label={`History of ${slug}`} className="space-y-3">
      {revisions.map((revision) => (
        <li key={revision.id} className="border-l-2 pl-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong>v{revision.version}</strong>
            <span className="text-muted-foreground text-xs">
              <ClientDate date={new Date(revision.changedAt)} />
            </span>
            <span className="text-muted-foreground text-xs">
              {/* `origin` is what distinguishes the seed from an admin whose
                  account has since been erased — both carry a null editor. */}
              {revision.origin === 'seed'
                ? 'seeded'
                : (revision.editorEmail ?? 'an admin since deleted')}
            </span>
            {!revision.isActive && <Badge variant="outline">Retired at this version</Badge>}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {revision.version === 1 ? 'Created' : `Changed: ${revision.changedFields.join(', ')}`}
          </p>
          <p className="mt-1">{revision.description}</p>
        </li>
      ))}
    </ol>
  );
}

// ─── Upload ─────────────────────────────────────────────────────────────────

function PlanSummary({ plan }: { plan: SlotUploadPlan }) {
  const rows: [string, string[]][] = [
    ['Would add', plan.creates.map((c) => c.slug)],
    ['Would reword', plan.updates.map((u) => `${u.slug} (${u.changedFields.join(', ')})`)],
    ['Would retire', plan.retirements.map((r) => r.slug)],
    ['Already identical', plan.unchanged],
    ['Retired here, left alone', plan.skippedRetired],
    [
      plan.mode === 'replace' ? 'Not in the file (retired above)' : 'Not in the file, left alone',
      plan.absentFromFile,
    ],
  ];

  return (
    <div aria-label="What this file would do" className="space-y-2 text-sm">
      {rows.map(([label, slugs]) => (
        <p key={label}>
          <strong>{label}:</strong>{' '}
          {slugs.length === 0 ? (
            <span className="text-muted-foreground">nothing</span>
          ) : (
            <span>{slugs.join(', ')}</span>
          )}
        </p>
      ))}
      {plan.skippedRetired.length > 0 && (
        <p className="text-muted-foreground text-xs">
          A taxonomy file cannot say whether a data slot is retired, so a retired slug listed in it
          is left retired rather than brought back. Restore those individually if that is what you
          meant.
        </p>
      )}
    </div>
  );
}

/** A sentinel, because `undefined` and `null` are both valid JSON documents. */
const UNPARSEABLE = Symbol('unparseable');

/** The name the server gave the download, so the filename stays its decision. */
const EXPORT_FALLBACK_FILENAME = 'lelanea-slot-taxonomy.json';

function exportFilename(response: Response): string {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? EXPORT_FALLBACK_FILENAME;
}

/**
 * How long the blob URL outlives the click.
 *
 * Not zero, and this is borrowed rather than reasoned out again: Chrome
 * resolves a blob URL synchronously, but Firefox and Safari begin the read
 * asynchronously, so a URL revoked on the next tick fails a large download with
 * a network error while the page says it saved. `components/app/account/
 * export-data-row.tsx` found that in its own review and settled on the minute
 * the file-saver libraries use; an export of 1000 slots is the same shape of
 * payload, so it gets the same treatment.
 */
const REVOKE_AFTER_MS = 60_000;

function UploadPanel({
  onApplied,
  onError,
}: {
  onApplied: (plan: SlotUploadPlan, sync: SlotSyncOutcome) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<SlotUploadMode>('merge');
  const [plan, setPlan] = useState<SlotUploadPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  /**
   * Fetch the file, then hand it to the browser — **not** a plain
   * `<a href download>`.
   *
   * A link was the first shape here, justified as "the way the waitlist export
   * is reached". That precedent was the wrong one to follow: the waitlist is
   * the **outlier**, and every other download in this tree — Sunrise's backup
   * panel, its agent export, and our own Art. 15 row — already fetches. This is
   * the house pattern, not a departure from it.
   *
   * The reason is that this route can refuse: `nothing_to_export` when every
   * slot is retired, and `unexportable` when a hand-edited classifier is
   * outside the vocabulary. A link answers a 409 by saving the JSON error
   * envelope to disk and leaving the page silent — and `unexportable` is the
   * case whose message *names the offending rows*, so it is the one an admin
   * most needs to read. `components/app/account/export-data-row.tsx` documents
   * the identical lesson from t-11, where navigating to an Art. 15 route put a
   * raw `{"success":false,…}` in a tab.
   */
  async function download() {
    setExporting(true);
    try {
      const response = await fetch(SLOT_TAXONOMY_EXPORT_ENDPOINT, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const parsed = await parseApiResponse<unknown>(response);
        onError(parsed.success ? 'The export failed.' : errorMessage(parsed.error));
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement('a');
      link.href = url;
      link.download = exportFilename(response);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    } catch {
      onError('The export did not reach the server. Nothing was downloaded.');
    } finally {
      setExporting(false);
    }
  }

  /**
   * The file is parsed by the route, not here — one schema, one set of
   * messages. All this does is turn the textarea into something sendable, and
   * report the one failure the route could not describe better: text that is
   * not JSON at all never reaches it.
   */
  function parsed(): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      onError('That is not valid JSON. Paste the whole taxonomy file, including its outer braces.');
      return UNPARSEABLE;
    }
  }

  async function preview() {
    const file = parsed();
    if (file === UNPARSEABLE) return;
    setBusy(true);
    const result = await send<{ plan: SlotUploadPlan }>(
      'POST',
      SLOT_TAXONOMY_UPLOAD_PREVIEW_ENDPOINT,
      { mode, file }
    );
    setBusy(false);
    if (!result.ok) {
      setPlan(null);
      return onError(result.message);
    }
    setPlan(result.data.plan);
  }

  async function apply() {
    const file = parsed();
    if (file === UNPARSEABLE) return;
    setBusy(true);
    const result = await send<{ plan: SlotUploadPlan; sync: SlotSyncOutcome }>(
      'POST',
      SLOT_TAXONOMY_UPLOAD_ENDPOINT,
      { mode, file }
    );
    setBusy(false);
    if (!result.ok) return onError(result.message);
    // The plan that RAN, which may differ from the one previewed if someone
    // saved in between. Showing this one is what keeps that honest.
    setPlan(result.data.plan);
    onApplied(result.data.plan, result.data.sync);
  }

  return (
    <div className="bg-muted/40 space-y-4 rounded-md border p-4">
      {/*
        Export sits above import on purpose: exporting first is how you get a
        file in the right shape to edit and bring back, and it is the only one
        of the two that cannot change anything.
      */}
      <div className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Export</p>
          <p className="text-muted-foreground text-xs">
            Every data slot currently being asked about, as a file you can edit and bring back
            below. Retired ones are left out — this format cannot say &ldquo;retired&rdquo;, so
            including them would bring them back on the next import.
          </p>
        </div>
        {/* Fetched rather than linked, so a refusal is read rather than saved
            to disk — see `download()` above. */}
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          disabled={exporting}
          onClick={() => void download()}
        >
          <Download className="mr-1 h-4 w-4" aria-hidden />
          {exporting ? 'Preparing…' : 'Download'}
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Label htmlFor="upload-file">Import a taxonomy file</Label>
        <FieldHelp title="Import a taxonomy file">
          The whole JSON file, in the same format the Download above produces and the app was seeded
          from. It is checked against the same schema the seed uses, so the errors you get here are
          the errors the seed would give.
        </FieldHelp>
      </div>
      <Textarea
        id="upload-file"
        rows={8}
        value={text}
        disabled={busy}
        placeholder='{ "taxonomy": { … }, "groups": [ … ], "slots": [ … ] }'
        onChange={(event) => {
          setText(event.target.value);
          // A plan describes the text it was made from. Keeping a stale one on
          // screen while the text changes is how the wrong thing gets applied.
          setPlan(null);
        }}
        className="font-mono text-xs"
      />

      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <Label htmlFor="upload-mode">How to reconcile it</Label>
          <FieldHelp title="How to reconcile it">
            Merge adds what is missing and rewords what differs, and leaves anything the file does
            not mention exactly as it is. Replace does the same and additionally retires the slots
            the file omits. Neither deletes anything, and neither retires anything the preview below
            has not named.
          </FieldHelp>
        </div>
        <Select
          value={mode}
          disabled={busy}
          onValueChange={(value) => {
            setMode(value as SlotUploadMode);
            setPlan(null);
          }}
        >
          <SelectTrigger id="upload-mode" aria-label="How to reconcile it">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="merge">Merge — never retires anything</SelectItem>
            <SelectItem value="replace">Replace — retires what the file omits</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy || text.trim() === ''}
          onClick={() => void preview()}
        >
          Preview
        </Button>
        {/* Nothing is applied until a preview has been read — the whole point of
            the pair, and why this is disabled rather than merely discouraged. */}
        <Button type="button" disabled={busy || plan === null} onClick={() => void apply()}>
          Apply this file
        </Button>
      </div>

      {plan !== null && <PlanSummary plan={plan} />}
    </div>
  );
}

// ─── The panel ──────────────────────────────────────────────────────────────

export function SlotDefinitionsPanel({
  initialView,
}: {
  initialView: SlotTaxonomyAdminView | SlotViewJson;
}) {
  const [definitions, setDefinitions] = useState<DefinitionJson[]>(initialView.definitions);
  const [groups, setGroups] = useState<string[]>(initialView.groups);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showingHistory, setShowingHistory] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  if (!initialView.seeded) {
    return (
      <p role="alert" className="text-sm">
        The taxonomy has not been loaded into the database yet, so there is nothing to edit. Run{' '}
        <code>npm run db:seed</code>. Until then the app is asking nothing about anyone.
      </p>
    );
  }

  function report(message: string) {
    setError(message);
    setNotice(null);
    setWarning(null);
  }

  function landed(message: string, sync: SlotSyncOutcome) {
    setError(null);
    setNotice(message);
    setWarning(syncWarning(sync));
  }

  function replace(next: DefinitionJson) {
    setDefinitions((current) => {
      const without = current.filter((d) => d.slug !== next.slug);
      return [...without, next].sort((a, b) =>
        a.group === b.group ? a.slug.localeCompare(b.slug) : a.group.localeCompare(b.group)
      );
    });
    setGroups((current) =>
      current.includes(next.group) ? current : [...current, next.group].sort()
    );
  }

  async function setActive(definition: DefinitionJson, isActive: boolean) {
    setBusySlug(definition.slug);
    const result = await send<{ definition: DefinitionJson; sync: SlotSyncOutcome }>(
      'PUT',
      slotDefinitionActiveEndpoint(definition.slug),
      { version: definition.version, isActive }
    );
    setBusySlug(null);
    if (!result.ok) return report(result.message);
    replace(result.data.definition);
    landed(
      isActive
        ? `“${definition.slug}” is being asked about again.`
        : `“${definition.slug}” is retired. Nothing new will be captured under it, and every answer already given stays readable.`,
      result.data.sync
    );
  }

  async function reload() {
    const result = await send<SlotViewJson>('GET', SLOT_DEFINITIONS_ENDPOINT);
    if (!result.ok) return report(result.message);
    setDefinitions(result.data.definitions);
    setGroups(result.data.groups);
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {warning && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      )}
      {notice && !error && <p className="text-muted-foreground text-sm">{notice}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setAdding((open) => !open);
            setUploading(false);
          }}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          {adding ? 'Cancel' : 'Add a data slot'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setUploading((open) => !open);
            setAdding(false);
          }}
        >
          <Upload className="mr-1 h-4 w-4" aria-hidden />
          {uploading ? 'Close' : 'Import / export'}
        </Button>
        <span className="text-muted-foreground text-xs">
          {definitions.filter((d) => d.isActive).length} being asked about,{' '}
          {definitions.filter((d) => !d.isActive).length} retired
        </span>
      </div>

      {adding && (
        <AddDefinitionForm
          groups={groups}
          onAdded={(definition, sync) => {
            replace(definition);
            setAdding(false);
            landed(`“${definition.slug}” added.`, sync);
          }}
          onError={report}
        />
      )}

      {uploading && (
        <UploadPanel
          onApplied={(plan, sync) => {
            void reload();
            landed(
              `Applied: ${plan.creates.length} added, ${plan.updates.length} reworded, ${plan.retirements.length} retired.`,
              sync
            );
          }}
          onError={report}
        />
      )}

      {groups.map((group) => {
        const inGroup = definitions.filter((definition) => definition.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} aria-label={group.replace(/_/g, ' ')} className="space-y-2">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold capitalize">
              {group.replace(/_/g, ' ')}
              {/* The count is how the shape of the taxonomy is legible at all:
                  21 life areas against 3 development slots is the thing an
                  operator wants to see before reading any single row. */}
              <span className="text-muted-foreground text-xs font-normal tabular-nums">
                {inGroup.length}
              </span>
            </h3>
            <ul className="divide-y rounded-md border">
              {inGroup.map((definition) => (
                <li key={definition.slug} className="space-y-3 p-3">
                  {/*
                    Two columns, and deliberately NOT `flex-wrap`. Wrapping let
                    each row decide for itself: a one-line description left the
                    buttons on the right, a two-line one pushed them underneath,
                    and a list of 53 rows shuffled between the two. The column
                    stacks at one breakpoint for every row instead.
                  */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    {/*
                      The badges belong here, with the slot they describe,
                      rather than in the button cluster — which is also what
                      keeps that cluster narrow enough to stay put.
                    */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-sm font-medium">{definition.slug}</code>
                        {definitionBadges(definition)}
                      </div>
                      <p className="text-muted-foreground line-clamp-2 text-xs">
                        {definition.description}
                      </p>
                    </div>

                    {/* `shrink-0` so a long description narrows the text column
                        rather than squeezing the controls. The two toggling
                        labels carry a min-width so the row does not jitter as
                        they change. */}
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-w-14"
                        onClick={() =>
                          setEditing((slug) => (slug === definition.slug ? null : definition.slug))
                        }
                      >
                        {editing === definition.slug ? 'Close' : 'Edit'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`History of ${definition.slug}`}
                        onClick={() =>
                          setShowingHistory((slug) =>
                            slug === definition.slug ? null : definition.slug
                          )
                        }
                      >
                        <History className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={definition.isActive ? 'outline' : 'secondary'}
                        disabled={busySlug === definition.slug}
                        className="min-w-20"
                        onClick={() => void setActive(definition, !definition.isActive)}
                      >
                        {definition.isActive ? 'Retire' : 'Restore'}
                      </Button>
                    </div>
                  </div>

                  {editing === definition.slug && (
                    <DefinitionForm
                      definition={definition}
                      groups={groups}
                      onSaved={(saved, sync, changed) => {
                        replace(saved);
                        landed(
                          changed.length === 0
                            ? 'Nothing had changed, so nothing was written — the history has no entry for a save that changed nothing.'
                            : `Saved as v${saved.version}. Changed: ${changed.join(', ')}.`,
                          sync
                        );
                      }}
                      onError={report}
                    />
                  )}

                  {showingHistory === definition.slug && (
                    <HistoryList slug={definition.slug} onError={report} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
