'use client';

/**
 * Her voice against a bare model, one question at a time.
 *
 * A voice fingerprint is tuned by editing prose, and prose edits have no
 * compiler. This is the surface that makes the consequence of one visible: the
 * same fixed questions asked of her assembled prompt path and of a model with no
 * fingerprint at all, with both answers on screen beside the prompt and beside
 * what that prompt was testing.
 *
 * ## Three things it deliberately shows that a scoreboard would not
 *
 * **The prompt each arm was given.** Stored at queue time and rendered in a
 * collapsible panel. A comparison's whole claim is "these two were told
 * different things", and that claim should be checkable by reading rather than
 * trusted.
 *
 * **What each question is for.** The authored `probe` sits under the prompt, so
 * a reader knows whether the answer in front of them is supposed to decline, to
 * ground a claim, or to admit it has nothing.
 *
 * **That a run is not finished.** Answers arrive a case at a time as the
 * platform's maintenance-tick worker drains each run, so a missing answer is
 * ambiguous between "not yet" and "it failed". The status line says which, and
 * the page polls while either arm is still moving rather than leaving somebody
 * looking at a half-empty table wondering.
 *
 * ## It uses the PLATFORM primitives
 *
 * Same reasoning as `designation-table.tsx`: `/admin/**` classifies as the
 * `admin` surface in `lib/app/surface.ts`, which `brand-theme.css` deliberately
 * does not reach, so an operator surface keeps Sunrise's chrome. The file is here
 * rather than in `components/admin/` because ownership decides the tier, not
 * styling.
 *
 * @see app/admin/app/voice/page.tsx — the server page that seeds it
 * @see lib/app/voice/comparison.ts — the arms, the guard and the queue
 * @see .context/app/voice.md
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Play } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClientDate } from '@/components/ui/client-date';
import { FieldHelp } from '@/components/ui/field-help';
import { parseApiResponse } from '@/lib/api/parse-response';
import { VOICE_COMPARISON_ENDPOINT } from '@/lib/app/voice/endpoint';
import type {
  VoiceComparisonDetail,
  VoiceComparisonSummary,
} from '@/lib/app/voice/comparison-admin';

/** Statuses the platform's worker will still move on. */
const LIVE_STATUSES = new Set(['queued', 'running']);

/** How often the detail is re-read while an arm is still draining. */
const POLL_INTERVAL_MS = 4000;

/** The `<Select>` value standing for "nothing to compare against". Radix rejects `''`. */
const NO_COMPARISON = '__none__';

interface VoiceComparisonBoardProps {
  initialComparisons: VoiceComparisonSummary[];
  /** True when the server page's own fetch failed — see the empty-state note. */
  initialLoadFailed: boolean;
}

function isLive(comparison: VoiceComparisonSummary | undefined): boolean {
  return comparison?.arms.some((arm) => LIVE_STATUSES.has(arm.status)) ?? false;
}

/** `Her voice · v1.0 — 3 of 5` : enough to tell "not yet" from "it failed". */
function armStatusLine(arm: VoiceComparisonSummary['arms'][number]): string {
  const { casesDone, casesTotal, casesFailed } = arm.progress;
  const failed = casesFailed > 0 ? `, ${casesFailed} failed` : '';
  if (arm.status === 'completed') {
    return `answered all ${casesTotal}${failed}`;
  }
  if (LIVE_STATUSES.has(arm.status)) {
    return `${arm.status} — ${casesDone} of ${casesTotal}${failed}`;
  }
  return `${arm.status} — ${casesDone} of ${casesTotal} answered${failed}`;
}

function scoreLabel(score: number | null): string {
  return score === null ? '—' : score.toFixed(2);
}

export function VoiceComparisonBoard({
  initialComparisons,
  initialLoadFailed,
}: VoiceComparisonBoardProps) {
  const [comparisons, setComparisons] = useState(initialComparisons);
  const [listFailed, setListFailed] = useState(initialLoadFailed);
  const [selectedId, setSelectedId] = useState<string | null>(initialComparisons[0]?.id ?? null);
  const [againstId, setAgainstId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VoiceComparisonDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);

  // Every fetch this component makes is aborted on unmount and superseded on the
  // next one. Without it a poll landing after the operator switched comparisons
  // overwrites the newer detail with the older — which reads as the page
  // spontaneously going backwards.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const loadList = useCallback(async () => {
    try {
      const response = await fetch(VOICE_COMPARISON_ENDPOINT);
      const parsed = await parseApiResponse<VoiceComparisonSummary[]>(response);
      if (!parsed.success) {
        setListFailed(true);
        return;
      }
      setListFailed(false);
      setComparisons(parsed.data);
      setSelectedId((current) => current ?? parsed.data[0]?.id ?? null);
    } catch {
      setListFailed(true);
    }
  }, []);

  const loadDetail = useCallback(async (id: string, against: string | null) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const query = against ? `?against=${encodeURIComponent(against)}` : '';
    try {
      const response = await fetch(`${VOICE_COMPARISON_ENDPOINT}/${id}${query}`, {
        signal: controller.signal,
      });
      const parsed = await parseApiResponse<VoiceComparisonDetail>(response);
      if (!parsed.success) {
        setDetailError(parsed.error.message);
        return;
      }
      setDetailError(null);
      setDetail(parsed.data);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setDetailError('The comparison did not load. Reload the page.');
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId, againstId);
  }, [selectedId, againstId, loadDetail]);

  // Poll only while something is actually moving. A completed comparison is
  // immutable, so re-reading it would be a request per four seconds that can
  // never return anything new.
  const selected = comparisons.find((comparison) => comparison.id === selectedId);
  const against = comparisons.find((comparison) => comparison.id === againstId);
  const shouldPoll = isLive(selected) || isLive(against);

  useEffect(() => {
    if (!shouldPoll || !selectedId) return;
    const timer = setInterval(() => {
      void loadList();
      void loadDetail(selectedId, againstId);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, selectedId, againstId, loadList, loadDetail]);

  const queue = useCallback(async () => {
    setQueueing(true);
    setQueueError(null);
    try {
      const response = await fetch(VOICE_COMPARISON_ENDPOINT, { method: 'POST' });
      const parsed = await parseApiResponse<{ comparisonId: string }>(response);
      if (!parsed.success) {
        // The refusals from `assertArmsComparable` name the arm and the remedy,
        // so the message is shown verbatim rather than replaced with a generic
        // failure — it is the whole value of the guard.
        setQueueError(parsed.error.message);
        return;
      }
      await loadList();
      setSelectedId(parsed.data.comparisonId);
      setAgainstId(null);
    } catch {
      setQueueError('The comparison could not be queued. Reload the page and try again.');
    } finally {
      setQueueing(false);
    }
  }, [loadList]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <Button onClick={() => void queue()} disabled={queueing}>
          <Play className="mr-2 h-4 w-4" />
          {queueing ? 'Queueing…' : 'Run the golden set'}
        </Button>

        <div className="min-w-64 space-y-1">
          <Label htmlFor="comparison">Comparison</Label>
          <Select
            value={selectedId ?? undefined}
            onValueChange={(value) => setSelectedId(value)}
            disabled={comparisons.length === 0}
          >
            <SelectTrigger id="comparison" className="w-full">
              <SelectValue placeholder="Nothing has been run yet" />
            </SelectTrigger>
            <SelectContent>
              {comparisons.map((comparison) => (
                <SelectItem key={comparison.id} value={comparison.id}>
                  {new Date(comparison.createdAt).toISOString().slice(0, 16).replace('T', ' ')} ·
                  set v{comparison.goldenSetVersion}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-64 space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="against">Against</Label>
            <FieldHelp title="Against">
              <p>
                Optional. Put a second comparison&rsquo;s columns in the same table to read two
                versions of her voice side by side.
              </p>
              <p className="mt-2">
                Each comparison brings its own bare-model column, which is the point: if both
                versions moved in the same direction as their controls, the model had a different
                day and her voice did not change.
              </p>
            </FieldHelp>
          </div>
          <Select
            value={againstId ?? NO_COMPARISON}
            onValueChange={(value) => setAgainstId(value === NO_COMPARISON ? null : value)}
            disabled={comparisons.length < 2}
          >
            <SelectTrigger id="against" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COMPARISON}>Nothing</SelectItem>
              {comparisons
                .filter((comparison) => comparison.id !== selectedId)
                .map((comparison) => (
                  <SelectItem key={comparison.id} value={comparison.id}>
                    {new Date(comparison.createdAt).toISOString().slice(0, 16).replace('T', ' ')} ·
                    set v{comparison.goldenSetVersion}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {queueError && (
        <p role="alert" className="text-destructive text-sm">
          {queueError}
        </p>
      )}
      {listFailed && (
        <p role="alert" className="text-destructive text-sm">
          The list of comparisons did not load, so this page is not saying whether any have been
          run. Reload — if it keeps failing, the comparisons endpoint is the thing to check.
        </p>
      )}
      {detailError && (
        <p role="alert" className="text-destructive text-sm">
          {detailError}
        </p>
      )}

      {!listFailed && comparisons.length === 0 && (
        <div className="rounded-md border p-6">
          <p className="font-medium">Nothing has been run through the golden set yet.</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Running it asks her the same fixed questions twice — once through her own assembled
            prompt, once through a model carrying no fingerprint at all — so you can hear what the
            core is actually doing rather than only that an answer came back. Answers arrive a
            question at a time as the background worker drains each run.
          </p>
        </div>
      )}

      {detail && detail.comparisons.length > 0 && (
        <>
          <div className="space-y-2 rounded-md border p-4">
            {detail.comparisons.map((comparison) => (
              <div key={comparison.id} className="text-sm">
                <span className="font-medium">Golden set v{comparison.goldenSetVersion}</span>{' '}
                <span className="text-muted-foreground">
                  queued <ClientDate date={comparison.createdAt} showTime />
                </span>
                <ul className="text-muted-foreground mt-1 space-y-0.5">
                  {comparison.arms.map((arm) => (
                    <li key={arm.evaluationRunId}>
                      <span className="text-foreground">{arm.label}</span> — {armStatusLine(arm)} ·
                      brand voice {scoreLabel(arm.brandVoiceMean)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {detail.mixedGoldenSets && (
              <p className="text-sm font-medium">
                These two comparisons ran different questions. A difference between them may be the
                question rather than the voice.
              </p>
            )}
          </div>

          <div className="rounded-md border">
            <button
              type="button"
              onClick={() => setPromptsOpen((open) => !open)}
              className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium"
              aria-expanded={promptsOpen}
            >
              {promptsOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              What each column was told
            </button>
            {promptsOpen && (
              <div className="space-y-4 border-t p-4">
                <p className="text-muted-foreground text-sm">
                  Composed and stored when the comparison was queued, not read back off the agents
                  now — so this is what actually produced the answers below, even if her core has
                  since changed.
                </p>
                {detail.columns.map((column) => (
                  <div key={column.columnId}>
                    <div className="text-sm font-medium">
                      {column.label}{' '}
                      <span className="text-muted-foreground font-normal">
                        · {column.agentSlug}
                      </span>
                    </div>
                    <pre className="bg-muted mt-1 max-h-64 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">
                      {column.systemPrompt}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            {detail.cases.map((entry) => (
              <div key={entry.key} className="rounded-md border">
                <div className="border-b p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{entry.kind}</Badge>
                    <span className="text-muted-foreground text-xs">{entry.key}</span>
                  </div>
                  <p className="mt-2 font-medium">{entry.prompt}</p>
                  {entry.probe && (
                    <p className="text-muted-foreground mt-1 text-sm">{entry.probe}</p>
                  )}
                </div>
                <div
                  className="grid gap-4 p-4"
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(entry.answers.length, 1)}, minmax(0, 1fr))`,
                  }}
                >
                  {entry.answers.map((answer) => (
                    <div key={answer.columnId} className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{answer.label}</span>
                        <span className="text-muted-foreground text-xs">
                          brand voice {scoreLabel(answer.brandVoiceScore)}
                        </span>
                      </div>
                      {answer.output === null ? (
                        <p className="text-muted-foreground text-sm italic">
                          {answer.errorMessage ?? 'Not answered yet.'}
                        </p>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{answer.output}</p>
                      )}
                      {answer.errorMessage && answer.output !== null && (
                        <p role="alert" className="text-destructive text-xs">
                          {answer.errorMessage}
                        </p>
                      )}
                      {answer.brandVoiceReasoning && (
                        <p className="text-muted-foreground text-xs">
                          {answer.brandVoiceReasoning}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
