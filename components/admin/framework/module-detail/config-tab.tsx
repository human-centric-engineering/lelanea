'use client';

/**
 * ConfigTab (f-ops-views t-2) — the client renderer for A4's generic config form.
 *
 * 06 ships the engine: `GET /config` returns flat `FieldDescriptor`s derived from the
 * module's Zod `configSchema`, and `PUT /config` re-validates a submitted config against
 * that same schema. This tab turns the descriptors into controls and posts the result —
 * "new module, new parameters, zero admin-UI work". The client coercion here is a
 * convenience; the server is the validation source of truth, and its field errors surface
 * below the form.
 *
 * An unregistered module (code removed) has no schema to edit against — its stored values
 * are shown read-only. A registered module with no parameters shows a short notice.
 */

import { useState, type BaseSyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldHelp } from '@/components/ui/field-help';
import { SaveError } from '@/components/forms/form-error';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { saveModuleConfig } from '@/lib/framework/modules/config/client';
import type { FieldDescriptor } from '@/lib/framework/modules/config/schema-descriptors';
import type { ModuleConfigFormView } from '@/lib/framework/modules/view';

/** Coerce an `unknown` to a display string without risking `[object Object]`. */
function displayString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Initial display value per descriptor: stored value → declared default → empty. */
function initialValues(
  descriptors: FieldDescriptor[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of descriptors) {
    const stored = values[d.key];
    if (d.type === 'boolean') {
      out[d.key] = typeof stored === 'boolean' ? stored : (d.default ?? false);
      continue;
    }
    if (d.type === 'json') {
      const source = stored ?? d.default;
      out[d.key] = source === undefined ? '' : JSON.stringify(source, null, 2);
      continue;
    }
    out[d.key] = displayString(stored ?? d.default);
  }
  return out;
}

interface ConfigTabProps {
  slug: string;
  /** null when the config fetch failed (vs `{ registered: false }` for a removed module). */
  form: ModuleConfigFormView | null;
}

export function ConfigTab({ slug, form }: ConfigTabProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues(form?.descriptors ?? [], form?.values ?? {})
  );
  const [changeSummary, setChangeSummary] = useState('');
  const save = useSaveFailure({ fallback: 'Failed to save config', fields: NO_SERVER_FIELDS });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!form) {
    return (
      <p className="text-muted-foreground text-sm" role="alert">
        The configuration couldn&rsquo;t be loaded. Try refreshing the page.
      </p>
    );
  }

  if (!form.registered) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          This module&rsquo;s code is no longer registered, so its config can&rsquo;t be edited. The
          last stored values:
        </p>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
          {JSON.stringify(form.values, null, 2)}
        </pre>
      </div>
    );
  }

  if (form.descriptors.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">This module has no configurable parameters.</p>
    );
  }

  const setField = (key: string, val: unknown) => {
    setValues((v) => ({ ...v, [key]: val }));
    setSaved(false);
  };

  async function handleSubmit(e?: BaseSyntheticEvent) {
    e?.preventDefault();
    if (!form) return; // unreachable — the form isn't rendered when `form` is null
    const config: Record<string, unknown> = {};
    const problems: Array<{ field: string; message: string }> = [];

    for (const d of form.descriptors) {
      const raw = values[d.key];
      if (d.type === 'boolean') {
        config[d.key] = Boolean(raw);
        continue;
      }
      const s = displayString(raw).trim();
      if (s === '') continue; // let the server apply the default / flag a missing required field
      if (d.type === 'number') {
        const n = Number(s);
        const problem = numberProblem(d, n);
        if (problem) problems.push({ field: `cfg-${d.key}`, message: problem });
        else config[d.key] = n;
      } else if (d.type === 'json') {
        try {
          config[d.key] = JSON.parse(s);
        } catch {
          problems.push({ field: `cfg-${d.key}`, message: `${d.label}: invalid JSON.` });
        }
      } else {
        config[d.key] = s; // string | enum
      }
    }

    if (save.block(problems)) return;

    setSaving(true);
    try {
      await saveModuleConfig(slug, {
        config,
        changeSummary: changeSummary.trim() || undefined,
      });
      setSaved(true);
      setChangeSummary('');
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={save.submit(handleSubmit)}
      className="max-w-2xl space-y-5"
    >
      {form.descriptors.map((d) => (
        <div key={d.key} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`cfg-${d.key}`}>
              {d.label}
              {d.required && <span className="text-destructive"> *</span>}
            </Label>
            {d.description && <FieldHelp title={d.label}>{d.description}</FieldHelp>}
          </div>
          {renderControl(d, values[d.key], setField)}
        </div>
      ))}

      <div className="space-y-1.5">
        <Label htmlFor="cfg-change-summary">Change summary (optional)</Label>
        <Input
          id="cfg-change-summary"
          value={changeSummary}
          onChange={(e) => setChangeSummary(e.target.value)}
          maxLength={500}
          placeholder="What changed and why"
        />
      </div>

      <SaveError failure={save.failure} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save config'}
        </Button>
        {saved && <span className="text-muted-foreground text-sm">Saved.</span>}
      </div>
    </form>
  );
}

/**
 * The limits a number field's input declares, held here because the form sets `noValidate`: the
 * browser no longer checks `min`, `max` or a whole-number `step`. The server re-checks them.
 */
function numberProblem(d: FieldDescriptor & { type: 'number' }, n: number): string | null {
  if (Number.isNaN(n)) return `${d.label}: must be a number.`;
  if (d.integer && !Number.isInteger(n)) return `${d.label}: must be a whole number.`;
  if (d.min !== undefined && n < d.min) return `${d.label}: must be at least ${d.min}.`;
  if (d.max !== undefined && n > d.max) return `${d.label}: must be at most ${d.max}.`;
  return null;
}

function renderControl(
  d: FieldDescriptor,
  value: unknown,
  setField: (key: string, val: unknown) => void
) {
  const id = `cfg-${d.key}`;

  if (d.type === 'boolean') {
    return (
      <Switch
        id={id}
        checked={Boolean(value)}
        onCheckedChange={(checked) => setField(d.key, checked)}
      />
    );
  }

  if (d.type === 'enum') {
    return (
      <Select value={displayString(value)} onValueChange={(val) => setField(d.key, val)}>
        <SelectTrigger id={id} className="max-w-xs">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {d.options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (d.type === 'json') {
    return (
      <Textarea
        id={id}
        value={displayString(value)}
        onChange={(e) => setField(d.key, e.target.value)}
        rows={4}
        className="font-mono text-xs"
      />
    );
  }

  if (d.type === 'number') {
    return (
      <Input
        id={id}
        type="number"
        value={displayString(value)}
        onChange={(e) => setField(d.key, e.target.value)}
        min={d.min}
        max={d.max}
        step={d.integer ? 1 : 'any'}
        className="max-w-xs"
      />
    );
  }

  return (
    <Input
      id={id}
      value={displayString(value)}
      onChange={(e) => setField(d.key, e.target.value)}
      maxLength={d.maxLength}
      className="max-w-md"
    />
  );
}
