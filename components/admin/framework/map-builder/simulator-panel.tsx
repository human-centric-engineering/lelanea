'use client';

/**
 * SimulatorPanel (f-map-editor t-5, F18) — the journey dry-run simulator dialog. An
 * author sets synthetic inputs (which nodes are completed, some slot values, a clock)
 * and runs them against the **current canvas** definition via `POST …/dry-run`, seeing
 * per-node availability + *why* each locked node is locked, plus the guidance ranking —
 * all before publishing, with zero writes.
 *
 * The engine stays server-side: this panel only POSTs the current definition + synthetic
 * inputs and renders the JSON result (types imported type-only, so no engine code bundles
 * here). `getDefinition` reads the live canvas at run time so unsaved edits are testable.
 */

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldHelp } from '@/components/ui/field-help';
import { Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { logger } from '@/lib/logging';
import type { MapDefinition } from '@/lib/framework/facilitation/map/schema';
import type { LockReason } from '@/lib/framework/facilitation/engine/availability';
import type { DryRunResult } from '@/lib/framework/facilitation/dry-run';

export interface SimulatorPanelProps {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every node key on the canvas — the completions checklist. */
  nodeKeys: readonly string[];
  /** Registered slot slugs — suggestions for a synthetic slot row. */
  slotOptions: readonly string[];
  /** Read the current canvas as a definition at run time (so unsaved edits simulate). */
  getDefinition: () => MapDefinition;
}

interface SlotRow {
  slug: string;
  value: string;
  confidence: string;
}

/** Narrate one lock reason for the author (client-side; no engine import needed). */
function describeLockReason(reason: LockReason): string {
  switch (reason.kind) {
    case 'module':
      return `Module "${reason.moduleSlug}" is not live (${reason.reason})`;
    case 'completed':
      return 'Already completed';
    case 'prerequisite':
      return `Prerequisite "${reason.from}" not met`;
    case 'condition':
      return `${reason.edgeType} condition from "${reason.from}" not satisfied`;
    case 'unlock':
      return `Needs one of: ${reason.candidates.length > 0 ? reason.candidates.join(', ') : '(no unlockers)'}`;
  }
}

/** Coerce a raw slot-value string to the number/boolean/string the engine compares. */
function coerceValue(raw: string): number | string | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
}

/** A confidence the dry-run schema accepts (int 1–10), or `undefined` to omit it. */
function validConfidence(raw: string): number | undefined {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 10 ? n : undefined;
}

function dryRunPath(slug: string): string {
  return `/api/v1/admin/framework/maps/${encodeURIComponent(slug)}/dry-run`;
}

export function SimulatorPanel({
  slug,
  open,
  onOpenChange,
  nodeKeys,
  slotOptions,
  getDefinition,
}: SimulatorPanelProps) {
  const [completions, setCompletions] = useState<Set<string>>(new Set());
  const [slotRows, setSlotRows] = useState<SlotRow[]>([]);
  const [now, setNow] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DryRunResult | null>(null);

  // Clear a prior run's result + error when the dialog is closed, so reopening never
  // shows a stale verdict against a since-edited canvas.
  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
    }
  }, [open]);

  const toggleCompletion = (key: string) => {
    setCompletions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateSlot = (index: number, patch: Partial<SlotRow>) => {
    setSlotRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  async function run() {
    setRunning(true);
    setError(null);
    // Drop any prior result up front so a failed re-run can't leave a stale verdict
    // rendered beside the error.
    setResult(null);
    try {
      const body = {
        definition: getDefinition(),
        completions: [...completions],
        slots: slotRows
          .filter((r) => r.slug.trim() !== '')
          .map((r) => {
            // Only forward a confidence the server will accept (int 1–10); anything else
            // (blank, decimal, non-numeric) is dropped so it can't 400 the whole run —
            // the server then defaults it to fully-confident.
            const confidence = validConfidence(r.confidence);
            return {
              slug: r.slug.trim(),
              value: coerceValue(r.value),
              ...(confidence !== undefined ? { confidence } : {}),
            };
          }),
        ...(now.trim() !== '' ? { now } : {}),
      };
      const data = await apiClient.post<DryRunResult>(dryRunPath(slug), { body });
      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Dry run failed';
      setError(message);
      logger.error('Map dry-run failed', { slug, error: message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Journey dry run</DialogTitle>
          <DialogDescription>
            Simulate a synthetic user against the current canvas — see what&rsquo;s available,
            what&rsquo;s locked and why, and how guidance would rank the moves. Nothing is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          {/* ── Inputs ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div>
              <Label className="text-xs">
                Completed nodes{' '}
                <FieldHelp title="Completed nodes">
                  <p>
                    Mark the places the synthetic user has already completed. Completed nodes
                    satisfy state gates that depend on them and are themselves locked as done.
                  </p>
                  <p className="mt-2">
                    Completions are treated as occurring at the simulated clock, so a{' '}
                    <code>cooldown_since_last_visit</code> gate reads zero elapsed time.
                  </p>
                </FieldHelp>
              </Label>
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {nodeKeys.length === 0 ? (
                  <p className="text-muted-foreground text-xs">Add nodes to the canvas first.</p>
                ) : (
                  nodeKeys.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={completions.has(key)}
                        onCheckedChange={() => toggleCompletion(key)}
                        data-testid={`sim-complete-${key}`}
                      />
                      <span className="font-mono break-all">{key}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs">
                Slot values{' '}
                <FieldHelp title="Synthetic slot values">
                  <p>
                    Give the synthetic user some learned slot values to test slot gates. Numbers and{' '}
                    <code>true</code>/<code>false</code> are coerced automatically; anything else is
                    text. Confidence (1–10) defaults to 10.
                  </p>
                </FieldHelp>
              </Label>
              <div className="mt-1 flex flex-col gap-2">
                {slotRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      list="sim-slot-options"
                      data-testid={`sim-slot-slug-${i}`}
                      className="h-8 flex-1"
                      placeholder="slot-slug"
                      value={row.slug}
                      onChange={(e) => updateSlot(i, { slug: e.target.value })}
                    />
                    <Input
                      data-testid={`sim-slot-value-${i}`}
                      className="h-8 w-20"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) => updateSlot(i, { value: e.target.value })}
                    />
                    <Input
                      data-testid={`sim-slot-conf-${i}`}
                      className="h-8 w-14"
                      inputMode="numeric"
                      placeholder="conf"
                      value={row.confidence}
                      onChange={(e) => updateSlot(i, { confidence: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-red-600 dark:text-red-400"
                      aria-label="Remove slot"
                      onClick={() => setSlotRows((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <datalist id="sim-slot-options">
                  {slotOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="sim-add-slot"
                  onClick={() =>
                    setSlotRows((prev) => [...prev, { slug: '', value: '', confidence: '' }])
                  }
                >
                  Add slot
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="sim-now" className="text-xs">
                Clock (ISO-8601){' '}
                <FieldHelp title="Simulated clock">
                  <p>
                    The instant to evaluate temporal gates and guidance deadlines against, e.g.{' '}
                    <code>2026-09-01T09:00:00Z</code>. Leave blank to use the current time.
                  </p>
                </FieldHelp>
              </Label>
              <Input
                id="sim-now"
                data-testid="sim-now"
                className="mt-1 h-8"
                placeholder="now (blank = current time)"
                value={now}
                onChange={(e) => setNow(e.target.value)}
              />
            </div>

            <Button
              type="button"
              data-testid="sim-run"
              onClick={() => void run()}
              disabled={running}
            >
              {running ? 'Running…' : 'Run dry run'}
            </Button>

            {error && (
              // save-error-box-ignore: a dry run writes nothing, so its failure is not a save
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* ── Results ────────────────────────────────────────── */}
          <div className="flex flex-col gap-4" data-testid="sim-results">
            {result === null ? (
              <p className="text-muted-foreground text-sm">
                Set inputs and run to see availability and ranking.
              </p>
            ) : (
              <>
                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wide uppercase">
                    Ranked moves ({result.ranked.length})
                  </p>
                  {result.ranked.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No available moves.</p>
                  ) : (
                    <ol className="space-y-1">
                      {result.ranked.map((move) => (
                        <li
                          key={move.nodeKey}
                          data-testid={`sim-rank-${move.nodeKey}`}
                          className="rounded-md border p-2 text-sm"
                        >
                          <span className="font-mono font-medium break-all">{move.nodeKey}</span>
                          <span className="text-muted-foreground ml-2 text-xs">
                            score {move.score}
                          </span>
                          {move.reasons.length > 0 && (
                            <ul className="text-muted-foreground mt-0.5 text-[11px]">
                              {move.reasons.map((r, i) => (
                                <li key={i}>· {r.detail}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {result.firsts.length > 0 && (
                    <p
                      data-testid="sim-firsts"
                      className="text-muted-foreground mt-1.5 text-[11px]"
                    >
                      First-arrival triggers:{' '}
                      <span className="font-mono">{result.firsts.join(', ')}</span>
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wide uppercase">
                    Per-node availability
                  </p>
                  <ul className="space-y-1">
                    {result.nodes.map((node) => (
                      <li
                        key={node.nodeKey}
                        data-testid={`sim-node-${node.nodeKey}`}
                        className="rounded-md border p-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono break-all">{node.nodeKey}</span>
                          <Badge
                            variant={node.available ? 'secondary' : 'outline'}
                            className={
                              node.available
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                                : 'text-muted-foreground'
                            }
                          >
                            {node.available ? 'available' : 'locked'}
                          </Badge>
                        </div>
                        {node.lockReasons.length > 0 && (
                          <ul className="text-muted-foreground mt-1 text-[11px]">
                            {node.lockReasons.map((r, i) => (
                              <li key={i}>· {describeLockReason(r)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
