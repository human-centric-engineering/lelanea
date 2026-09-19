'use client';

/**
 * The crisis resource, edited by region — and signed off (f-safety t-63).
 *
 * Two parts, one page. The shared wording (both intros, the emergency line,
 * "your message is kept", the international directory) is one form. Each
 * region is a card that opens into an editor: its emergency number and its
 * services, in the order they are shown. A region can be added and removed.
 *
 * **Every save that changes something comes back as a draft** — the route says
 * so and the card shows it — and "Sign off" sends the version on screen, so a
 * sign-off is refused if someone else edited in between. Sign-off is offered
 * only for a saved draft: unsaved edits have to be saved (and so become the
 * draft) first.
 *
 * Before the tables are seeded nothing here is editable: the bundled file is
 * being served, and the page says to run the seed.
 *
 * The browser checks nothing the route does not; the route's schema is the
 * authority, and its message is what the admin reads.
 */

import * as React from 'react';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelp } from '@/components/ui/field-help';
import { ClientDate } from '@/components/ui/client-date';
import { parseApiResponse } from '@/lib/api/parse-response';
import {
  CRISIS_COPY_ENDPOINT,
  CRISIS_COPY_SIGN_OFF_ENDPOINT,
  CRISIS_REGIONS_ENDPOINT,
  crisisRegionEndpoint,
  crisisRegionSignOffEndpoint,
} from '@/lib/app/safety/endpoint';
import { MAX_SERVICES_PER_REGION } from '@/lib/validations/app-crisis-resources';
import type { CrisisService } from '@/lib/validations/app-crisis-resources';
import type {
  CrisisAdminView,
  CrisisCopyRow,
  CrisisRegionRow,
} from '@/lib/app/safety/crisis-admin';

/** Dates are strings once serialised. */
type Jsonified<T> = { [K in keyof T]: T[K] extends Date | null ? string | Date | null : T[K] };
type CopyJson = Jsonified<CrisisCopyRow>;
type RegionJson = Jsonified<CrisisRegionRow>;
export interface CrisisViewJson {
  seeded: boolean;
  unservable: string | null;
  copy: CopyJson | null;
  regions: RegionJson[];
}

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

/** The first message worth showing from an error envelope: a field's, else the top line. */
function errorMessage(error: { message: string; details?: unknown }): string {
  const details = error.details;
  if (details && typeof details === 'object' && 'errors' in details) {
    const errors = details.errors;
    if (Array.isArray(errors)) {
      const first: unknown = errors[0];
      if (first && typeof first === 'object' && 'message' in first) {
        const message = first.message;
        if (typeof message === 'string') return message;
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

function StatusBadge({
  status,
  version,
  signedOffAt,
}: {
  status: 'draft' | 'signed_off';
  version: number;
  signedOffAt: string | Date | null;
}) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      {status === 'signed_off' ? (
        <Badge variant="secondary">Signed off</Badge>
      ) : (
        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
          Draft — awaiting sign-off
        </Badge>
      )}
      <span>v{version}</span>
      {status === 'signed_off' && signedOffAt && (
        <span>
          signed off <ClientDate date={new Date(signedOffAt)} />
        </span>
      )}
    </span>
  );
}

export function CrisisResourcesPanel({
  initialView,
}: {
  initialView: CrisisAdminView | CrisisViewJson;
}) {
  const [copy, setCopy] = useState<CopyJson | null>(initialView.copy);
  const [regions, setRegions] = useState<RegionJson[]>(initialView.regions);
  const [adding, setAdding] = useState(false);

  if (!initialView.seeded || copy === null) {
    return (
      <div role="alert" className="max-w-3xl rounded-md border border-amber-500 p-4 text-sm">
        <p className="font-medium">The helplines have not been loaded into the database yet.</p>
        <p className="text-muted-foreground mt-1">
          Until they are, everyone is shown the version built into the code, which is safe but
          cannot be edited here. Run <code>npm run db:seed</code> on this environment, then reload
          this page.
        </p>
      </div>
    );
  }

  const malformed = regions.filter((r) => r.malformed).map((r) => r.region);
  const replaceRegion = (row: RegionJson) =>
    setRegions((all) => all.map((r) => (r.region === row.region ? row : r)));

  return (
    <div className="space-y-10">
      {initialView.unservable && (
        <p role="alert" className="text-destructive max-w-3xl text-sm">
          What is stored here cannot be shown to anyone, so everyone is being shown the version
          built into the code instead. The problem: {initialView.unservable}. Correct it and save;
          until then, edits and sign-offs here reach nobody.
        </p>
      )}

      {malformed.length > 0 && (
        <p role="alert" className="text-destructive max-w-3xl text-sm">
          The stored services for {malformed.join(', ')} are malformed, so everyone is being shown
          the version built into the code instead of this page. Open{' '}
          {malformed.length === 1 ? 'that region' : 'those regions'}, correct the services and save.
        </p>
      )}

      <CopyForm copy={copy} onSaved={setCopy} />

      <section aria-labelledby="crisis-regions-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="crisis-regions-heading" className="text-base font-semibold">
              Countries
            </h3>
            <p className="text-muted-foreground text-sm">
              Each country&rsquo;s helplines, shown in this order, then the international directory.
            </p>
          </div>
          {!adding && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden /> Add a country
            </Button>
          )}
        </div>

        {adding && (
          <RegionEditor
            mode="create"
            existing={regions.map((r) => r.region)}
            onCancel={() => setAdding(false)}
            onSaved={(row) => {
              setRegions((all) => [...all, row].sort((a, b) => a.region.localeCompare(b.region)));
              setAdding(false);
            }}
          />
        )}

        {regions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No countries are listed. Everyone is shown the international directory and &ldquo;your
            local emergency number&rdquo;.
          </p>
        ) : (
          <ul className="space-y-3">
            {regions.map((region) => (
              <li key={region.region}>
                <RegionCard
                  region={region}
                  onChanged={replaceRegion}
                  onRemoved={() =>
                    setRegions((all) => all.filter((r) => r.region !== region.region))
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── The shared wording ──────────────────────────────────────────────────────

const COPY_FIELDS: Array<{
  key: keyof Omit<CopyJson, 'status' | 'version' | 'signedOffAt' | 'updatedAt'>;
  label: string;
  help: string;
  multiline?: boolean;
}> = [
  {
    key: 'hardIntro',
    label: 'Opening — when the conversation stops',
    help: 'Shown first when what someone wrote suggests they may be in immediate danger. The conversation ends here and nothing the AI would have said is shown, so this is the whole message. Plain, direct, and about getting them to a person.',
    multiline: true,
  },
  {
    key: 'softIntro',
    label: 'Opening — when the conversation carries on',
    help: 'Shown above the AI’s reply when someone sounds overwhelmed but not in immediate danger. The conversation continues after it, so this is an offer, not a stop.',
    multiline: true,
  },
  {
    key: 'emergency',
    label: 'Emergency line',
    help: 'Always shown. For a listed country its emergency number is added in brackets after this sentence — “(999)” — so do not put a number in it. For anyone else it is shown as it is.',
    multiline: true,
  },
  {
    key: 'keptMessage',
    label: '“Your message is kept”',
    help: 'Shown only when the conversation stops. Tells them what they typed has not been lost — it is still in the box.',
  },
  {
    key: 'internationalName',
    label: 'Directory — name',
    help: 'The international helpline directory, listed last for every country and alone for anyone whose country is not listed.',
  },
  {
    key: 'internationalContact',
    label: 'Directory — how to reach it',
    help: 'What the person does, shown as written: a web address, a number.',
  },
  {
    key: 'internationalUrl',
    label: 'Directory — link',
    help: 'The directory’s https:// address, so the app can make it a link.',
  },
  {
    key: 'internationalHours',
    label: 'Directory — description',
    help: 'One line after the name, in place of opening hours: what it covers.',
  },
];

type CopyText = Record<(typeof COPY_FIELDS)[number]['key'], string>;

function copyText(copy: CopyJson): CopyText {
  return Object.fromEntries(COPY_FIELDS.map((f) => [f.key, copy[f.key]])) as CopyText;
}

function CopyForm({ copy, onSaved }: { copy: CopyJson; onSaved: (copy: CopyJson) => void }) {
  const [text, setText] = useState<CopyText>(() => copyText(copy));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saved = copyText(copy);
  const dirty = COPY_FIELDS.some((f) => text[f.key] !== saved[f.key]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await send<{ copy: CopyJson; changed: string[] }>('PUT', CRISIS_COPY_ENDPOINT, {
      ...text,
      version: copy.version,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onSaved(result.data.copy);
    setText(copyText(result.data.copy));
    setNotice(
      result.data.changed.length > 0
        ? 'Saved. It is a draft until someone signs it off.'
        : 'Nothing had changed, so nothing was saved.'
    );
  };

  const signOff = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await send<{ copy: CopyJson }>('POST', CRISIS_COPY_SIGN_OFF_ENDPOINT, {
      version: copy.version,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onSaved(result.data.copy);
    setNotice('Signed off.');
  };

  return (
    <section aria-labelledby="crisis-copy-heading" className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h3 id="crisis-copy-heading" className="text-base font-semibold">
          The wording every country shares
        </h3>
        <StatusBadge status={copy.status} version={copy.version} signedOffAt={copy.signedOffAt} />
      </div>

      <form onSubmit={(event) => void save(event)} className="space-y-4" noValidate>
        {COPY_FIELDS.map((field) => {
          const id = `crisis-copy-${field.key}`;
          const Control = field.multiline ? Textarea : Input;
          return (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor={id}>{field.label}</Label>
                <FieldHelp title={field.label}>{field.help}</FieldHelp>
              </div>
              <Control
                id={id}
                value={text[field.key]}
                onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  setText((t) => ({ ...t, [field.key]: event.target.value }))
                }
                disabled={busy}
                {...(field.multiline ? { rows: 3 } : {})}
              />
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !dirty}>
            {busy ? 'Working…' : 'Save'}
          </Button>
          {copy.status === 'draft' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty}
              onClick={() => void signOff()}
              title={
                dirty ? 'Save your changes first — a sign-off covers what is saved.' : undefined
              }
            >
              Sign off v{copy.version}
            </Button>
          )}
          {notice && !error && (
            <span role="status" className="text-muted-foreground text-sm">
              {notice}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

// ─── One country ─────────────────────────────────────────────────────────────

function RegionCard({
  region,
  onChanged,
  onRemoved,
}: {
  region: RegionJson;
  onChanged: (row: RegionJson) => void;
  onRemoved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <RegionEditor
        mode="edit"
        initial={region}
        onCancel={() => setEditing(false)}
        onSaved={(row) => {
          onChanged(row);
          setEditing(false);
        }}
      />
    );
  }

  const signOff = async () => {
    setBusy(true);
    setError(null);
    const result = await send<{ region: RegionJson }>(
      'POST',
      crisisRegionSignOffEndpoint(region.region),
      { version: region.version }
    );
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onChanged(result.data.region);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const result = await send<{ removed: string }>('DELETE', crisisRegionEndpoint(region.region));
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onRemoved();
  };

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{region.region}</span>
            <span className="text-muted-foreground text-sm">
              emergency number {region.emergencyNumber}
            </span>
          </div>
          <StatusBadge
            status={region.status}
            version={region.version}
            signedOffAt={region.signedOffAt}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
          {region.status === 'draft' && !region.malformed && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void signOff()}>
              Sign off v{region.version}
            </Button>
          )}
          {confirmingRemove ? (
            <>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
                Remove {region.region}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmingRemove(false)}
              >
                Keep it
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmingRemove(true)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {confirmingRemove && (
        <p className="text-muted-foreground mt-2 text-sm">
          People in {region.region} will then be shown only the international directory and
          &ldquo;your local emergency number&rdquo;.
        </p>
      )}

      {region.malformed ? (
        <p className="text-destructive mt-3 text-sm">
          The stored services are malformed. Edit and save this country to repair it.
        </p>
      ) : (
        <ol className="mt-3 space-y-1 text-sm">
          {region.services.map((service, index) => (
            <li key={index}>
              <span className="font-medium">{service.name}</span> — {service.contact}{' '}
              <span className="text-muted-foreground">({service.hours})</span>
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

const EMPTY_SERVICE: CrisisService = { name: '', contact: '', hours: '' };

function RegionEditor(
  props:
    | {
        mode: 'create';
        existing: string[];
        onSaved: (row: RegionJson) => void;
        onCancel: () => void;
      }
    | {
        mode: 'edit';
        initial: RegionJson;
        onSaved: (row: RegionJson) => void;
        onCancel: () => void;
      }
) {
  const initial = props.mode === 'edit' ? props.initial : null;
  const [code, setCode] = useState(initial?.region ?? '');
  const [emergencyNumber, setEmergencyNumber] = useState(initial?.emergencyNumber ?? '');
  const [services, setServices] = useState<CrisisService[]>(
    initial && initial.services.length > 0 ? initial.services : [{ ...EMPTY_SERVICE }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idPrefix = `crisis-region-${initial?.region ?? 'new'}`;

  const setService = (index: number, field: keyof CrisisService, value: string) =>
    setServices((all) => all.map((s, i) => (i === index ? { ...s, [field]: value } : s)));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      props.mode === 'create'
        ? await send<{ region: RegionJson }>('POST', CRISIS_REGIONS_ENDPOINT, {
            region: code,
            emergencyNumber,
            services,
          })
        : await send<{ region: RegionJson }>('PUT', crisisRegionEndpoint(props.initial.region), {
            emergencyNumber,
            services,
            version: props.initial.version,
          });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    props.onSaved(result.data.region);
  };

  return (
    <form
      onSubmit={(event) => void save(event)}
      noValidate
      className="space-y-4 rounded-md border border-dashed p-4"
      aria-label={initial ? `Edit ${initial.region}` : 'Add a country'}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${idPrefix}-code`}>Country code</Label>
            <FieldHelp title="Country code">
              The two-letter ISO code (GB, IE, US…). It is matched against the region in the
              person&rsquo;s browser language — en-GB is GB. It cannot be changed once added: remove
              the country and add it again instead.
            </FieldHelp>
          </div>
          <Input
            id={`${idPrefix}-code`}
            value={code}
            maxLength={2}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            disabled={busy || props.mode === 'edit'}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${idPrefix}-emergency`}>Emergency number</Label>
            <FieldHelp title="Emergency number">
              The local emergency services number, shown in brackets after the emergency line — for
              example 999, or &ldquo;112 or 999&rdquo;. Check it is right: a wrong number here is
              worse than none.
            </FieldHelp>
          </div>
          <Input
            id={`${idPrefix}-emergency`}
            value={emergencyNumber}
            onChange={(event) => setEmergencyNumber(event.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Helplines, in the order shown</legend>
        {services.map((service, index) => (
          <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <ServiceField
              id={`${idPrefix}-s${index}-name`}
              label="Name"
              help="The service's own name, as the person would search for it."
              value={service.name}
              onChange={(value) => setService(index, 'name', value)}
              disabled={busy}
            />
            <ServiceField
              id={`${idPrefix}-s${index}-contact`}
              label="How to reach them"
              help="What the person does, in a few words: “Call 116 123”, “Text SHOUT to 85258”."
              value={service.contact}
              onChange={(value) => setService(index, 'contact', value)}
              disabled={busy}
            />
            <ServiceField
              id={`${idPrefix}-s${index}-hours`}
              label="When they answer"
              help="Opening hours and cost, briefly: “Free, 24 hours a day”."
              value={service.hours}
              onChange={(value) => setService(index, 'hours', value)}
              disabled={busy}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove helpline ${index + 1}`}
              disabled={busy || services.length === 1}
              onClick={() => setServices((all) => all.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        {services.length < MAX_SERVICES_PER_REGION && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setServices((all) => [...all, { ...EMPTY_SERVICE }])}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Add a helpline
          </Button>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : props.mode === 'create' ? 'Add as a draft' : 'Save as a draft'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </form>
  );
}

function ServiceField({
  id,
  label,
  help,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        <FieldHelp title={label}>{help}</FieldHelp>
      </div>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
