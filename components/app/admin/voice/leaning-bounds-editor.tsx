'use client';

/**
 * The leaning bounds, edited on the Voice page (f-leanings t-138).
 *
 * Per dial: how far a person may move it toward each pole, which is locked
 * when neither way is allowed, and whether the AI may suggest moving it; plus
 * the switch that turns suggestions off for every dial at once. The bounds are
 * on the overlay set (owner ruling 2, 4 Oct 2026), so they share its sign-off
 * and its history, and this sits inside the set's card rather than beside it.
 *
 * Rest is always inside a dial's range — the controls cannot express anything
 * else, and the API refuses it — so a person can always go back to her voice
 * unshaded.
 */

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldHelp } from '@/components/ui/field-help';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { send } from '@/components/app/admin/content/client';
import { EditDialog, NoticeLine, type Notice } from '@/components/app/admin/content/parts';
import { VOICE_OVERLAY_LEANINGS_ENDPOINT } from '@/lib/app/voice/endpoint';
import {
  LEANING_DIMENSIONS,
  isLocked,
  type LeaningBounds,
  type LeaningDialBounds,
  type LeaningKey,
} from '@/lib/app/voice/leanings';

/** How far a dial may go toward one pole, as the select offers it. */
const REACH = [
  { value: 2, label: 'Strongly' },
  { value: 1, label: 'One stop' },
  { value: 0, label: 'Not at all' },
] as const;

type Reach = (typeof REACH)[number]['value'];

function reachOf(raw: string): Reach {
  return raw === '2' ? 2 : raw === '1' ? 1 : 0;
}

/** A dial's `min` is the left reach, negated. */
function minOf(reach: Reach): LeaningDialBounds['min'] {
  return reach === 2 ? -2 : reach === 1 ? -1 : 0;
}

function leftReach(min: LeaningDialBounds['min']): Reach {
  return min === -2 ? 2 : min === -1 ? 1 : 0;
}

/** What an unlocked dial's range reads as, in a sentence's worth of words. */
function rangeText(dial: LeaningDialBounds, left: string, right: string): string {
  const side = (reach: number, pole: string) =>
    reach === 0 ? null : reach === 2 ? `strongly ${pole}` : `one stop ${pole}`;
  return [side(leftReach(dial.min), `toward ${left}`), side(dial.max, `toward ${right}`)]
    .filter((part): part is string => part !== null)
    .join('; up to ');
}

/** The bounds at a glance, for the card. */
export function LeaningBoundsSummary({ bounds }: { bounds: LeaningBounds }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground">
        The AI may suggest changes: <strong>{bounds.suggest ? 'yes' : 'no, for every dial'}</strong>
      </p>
      <ul className="text-muted-foreground grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        {LEANING_DIMENSIONS.map((dimension) => {
          const dial = bounds.dials[dimension.key];
          return (
            <li key={dimension.key}>
              <span className="text-foreground">
                {dimension.left} ↔ {dimension.right}
              </span>
              {': '}
              {isLocked(dial)
                ? 'locked'
                : `up to ${rangeText(dial, dimension.left, dimension.right)}`}
              {!isLocked(dial) && bounds.suggest && !dial.suggest && ' · not suggested'}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ColumnHead({ label, help }: { label: string; help: string }) {
  return (
    <th scope="col" className="px-2 py-1 text-left font-medium">
      <span className="inline-flex items-center gap-1">
        {label}
        <FieldHelp title={label}>{help}</FieldHelp>
      </span>
    </th>
  );
}

function ReachSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: Reach;
  onChange: (reach: Reach) => void;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
      value={String(value)}
      onChange={(e) => onChange(reachOf(e.target.value))}
    >
      {REACH.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The Edit button and its dialog. `revision` is the set's, read with the
 * bounds, so a save over somebody else's is refused rather than lost.
 */
export function LeaningBoundsEditor({
  bounds,
  revision,
  onDone,
}: {
  bounds: LeaningBounds;
  revision: number;
  onDone: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LeaningBounds>(bounds);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  function setDial(key: LeaningKey, change: Partial<LeaningDialBounds>) {
    setDraft({ ...draft, dials: { ...draft.dials, [key]: { ...draft.dials[key], ...change } } });
  }

  async function save() {
    setBusy(true);
    const result = await send<{ changed: string[] }>('PUT', VOICE_OVERLAY_LEANINGS_ENDPOINT, {
      leanings: draft,
      revision,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setEditing(false);
    onDone(
      result.data.changed.length === 0
        ? 'Nothing in the leaning bounds changed.'
        : 'Saved the leaning bounds. They apply from each person’s next read, and are a draft until signed off.'
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setDraft(bounds);
          setNotice(null);
          setEditing(true);
        }}
      >
        Edit leaning bounds
      </Button>
      <EditDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit the leaning bounds"
        description="How far each person may move each dial in Settings or by asking, and which ones the AI may suggest moving. Nobody’s own setting is rewritten: one beyond a new bound is applied at the bound, and comes back if the bound is loosened. Any change returns the set to draft."
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
          <div className="flex items-center gap-2">
            <Switch
              id="leanings-suggest"
              checked={draft.suggest}
              onCheckedChange={(checked) => setDraft({ ...draft, suggest: checked })}
            />
            <Label htmlFor="leanings-suggest">The AI may suggest changes</Label>
            <FieldHelp title="The AI may suggest changes">
              When this is on, the AI may notice a pattern, say what it noticed and ask before
              moving a dial, for each dial that allows it below. It moves one only when the person
              says yes. When it is off, no dial is suggested; a person can still ask for a change,
              or make one in Settings.
            </FieldHelp>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <ColumnHead
                    label="Leaning"
                    help="The dial, as its two poles. Rest, between them, is her voice with no leaning applied."
                  />
                  <ColumnHead
                    label="Toward the left pole"
                    help="How far a person may move this dial toward its first pole: two stops, one, or not at all."
                  />
                  <ColumnHead
                    label="Toward the right pole"
                    help="How far a person may move this dial toward its second pole: two stops, one, or not at all. With neither way allowed, the dial is locked at rest."
                  />
                  <ColumnHead
                    label="May suggest"
                    help="Whether the AI may suggest moving this dial. It has no effect while suggestions are off for every dial, or while the dial is locked."
                  />
                </tr>
              </thead>
              <tbody>
                {LEANING_DIMENSIONS.map((dimension) => {
                  const dial = draft.dials[dimension.key];
                  const locked = isLocked(dial);
                  const id = `leaning-${dimension.key}`;
                  return (
                    <tr key={dimension.key} className="border-b last:border-0">
                      <th scope="row" className="px-2 py-2 text-left font-normal">
                        <span className="block">
                          {dimension.left} ↔ {dimension.right}
                        </span>
                        {locked && (
                          <Badge variant="secondary" className="mt-1">
                            Locked at rest
                          </Badge>
                        )}
                      </th>
                      <td className="px-2 py-2">
                        <ReachSelect
                          id={`${id}-min`}
                          label={`How far toward ${dimension.left}`}
                          value={leftReach(dial.min)}
                          onChange={(reach) => setDial(dimension.key, { min: minOf(reach) })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <ReachSelect
                          id={`${id}-max`}
                          label={`How far toward ${dimension.right}`}
                          value={dial.max}
                          onChange={(reach) => setDial(dimension.key, { max: reach })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Switch
                          id={`${id}-suggest`}
                          aria-label={`The AI may suggest moving ${dimension.left} ↔ ${dimension.right}`}
                          checked={dial.suggest}
                          disabled={!draft.suggest || locked}
                          onCheckedChange={(checked) =>
                            setDial(dimension.key, { suggest: checked })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </EditDialog>
    </>
  );
}
