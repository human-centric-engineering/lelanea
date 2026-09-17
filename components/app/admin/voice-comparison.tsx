'use client';

/**
 * The assembled voice against a bare model, one question at a time.
 *
 * A voice fingerprint is tuned by editing prose, and prose edits have no
 * compiler. This is the surface that makes the consequence of one visible: the
 * same fixed questions asked of the assembled prompt path and of a model with no
 * fingerprint at all, with both answers on screen beside the prompt and beside
 * what that prompt was testing.
 *
 * ## The page is two things, in this order
 *
 * **Run** — a single panel that invites the run and then becomes the run. An
 * arriving admin sees what a run would cost, what it would ask, and one button;
 * nothing about reading old results is in the way. Once something is draining,
 * the same panel turns into the progress view, because the thing you pressed and
 * the thing you are waiting on should not be two different places on the page.
 *
 * **Results** — everything about reading runs, under its own heading, with the
 * two pickers beneath it. The pickers used to sit beside the Run button, which
 * put "which run am I reading" and "spend money on a new one" in one row of
 * controls; they are different jobs and they are now in different sections.
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
 * ambiguous between "not yet" and "it failed". A run that is moving says so in
 * motion — a live pulse and a bar per arm that advances as cases land — because
 * a static count is indistinguishable from a page that has quietly stopped
 * polling. The motion is decoration over facts that are also written out, and it
 * is dropped entirely under `prefers-reduced-motion`.
 *
 * ## It uses the PLATFORM primitives
 *
 * Same reasoning as `designation-table.tsx`: `/admin/**` classifies as the
 * `admin` surface in `lib/app/surface.ts`, which `brand-theme.css` deliberately
 * does not reach, so an operator surface keeps Sunrise's chrome. The file is here
 * rather than in `components/admin/` because ownership decides the tier, not
 * styling. Every animation below is a stock Tailwind utility for the same
 * reason: custom keyframes would have to live in `app/globals.css`, which is
 * Sunrise's.
 *
 * @see app/admin/app/voice/page.tsx — the server page that seeds it
 * @see lib/app/voice/comparison.ts — the arms, the guard and the queue
 * @see .context/app/voice.md
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Play, Square } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { VoicePreflight } from '@/lib/app/voice/preflight';
import { VOICE_RUN_DELETED_STATUS } from '@/lib/validations/app-voice-comparison';
// Type-only, and it must stay that way: `comparison-admin.ts` imports Prisma,
// so a value import from it would drag `pg` into this client bundle.
import type {
  VoiceComparisonArmView,
  VoiceComparisonDetail,
  VoiceComparisonSummary,
} from '@/lib/app/voice/comparison-admin';

/** Statuses the platform's worker will still move on. */
const LIVE_STATUSES = new Set(['queued', 'running']);

/**
 * How often the detail is re-read while an arm is still draining.
 *
 * Every route under `/api/v1/admin/` is on the platform's `admin` tier — 30
 * requests a minute, keyed on the admin's user id. This surface used to poll two
 * endpoints every four seconds, which is exactly 30/min on its own: a run long
 * enough to be worth watching spent its whole life at the cap, and the operator
 * watched it through a "Too many requests" banner. One endpoint every five
 * seconds is 12/min, which leaves the rest of the budget for the page they are
 * actually using.
 */
const POLL_INTERVAL_MS = 5000;

/**
 * How long to stop polling for after a 429.
 *
 * Retrying on the next tick is what turns one rate-limited request into a
 * minute of them. The cap is per minute, so backing off past the window lets it
 * refill instead of keeping it empty.
 */
const RATE_LIMITED_BACKOFF_MS = 60_000;

/** The platform's code for a rate-limited request, as it arrives in the envelope. */
const RATE_LIMITED_CODE = 'RATE_LIMIT_EXCEEDED';

/** The `<Select>` value standing for "nothing to compare against". Radix rejects `''`. */
const NO_COMPARISON = '__none__';

interface VoiceComparisonBoardProps {
  initialComparisons: VoiceComparisonSummary[];
  /** True when the server page's own fetch failed — see the empty-state note. */
  initialLoadFailed: boolean;
  /** What a run would use and roughly cost. Null when the page could not read it. */
  preflight: VoicePreflight | null;
}

function isLive(comparison: VoiceComparisonSummary | undefined): boolean {
  return comparison?.arms.some((arm) => LIVE_STATUSES.has(arm.status)) ?? false;
}

/** `2026-09-16 10:00 · test set v1.0` — what both pickers label a run with. */
function comparisonLabel(comparison: VoiceComparisonSummary): string {
  const when = new Date(comparison.createdAt).toISOString().slice(0, 16).replace('T', ' ');
  return `${when} · test set v${comparison.goldenSetVersion}`;
}

/**
 * What an arm actually did, in a clause that cannot overstate it.
 *
 * `casesDone` counts every case-result row the worker wrote, and a case that
 * FAILED still writes one — so it is cases ATTEMPTED, and the questions actually
 * answered are `casesDone - casesFailed`. Reading `casesTotal` as "answered"
 * because the run says `completed` is what produced `answered all 5, 5 failed`:
 * a self-contradiction whose first half was simply false, on the one surface
 * whose job is to say whether her voice has been checked.
 *
 * The upstream half is `sunrise#801` — a run in which every case failed is
 * recorded `completed` with `errorMessage` null, so `completed` cannot be taken
 * to mean "there is a result here". Until that lands this line is the only place
 * a reader is told the column is empty rather than comparable, which is why the
 * all-failed case gets a sentence of its own rather than a count.
 */
function armStatusLine(arm: VoiceComparisonArmView): string {
  const { casesDone, casesTotal, casesFailed } = arm.progress;
  const answered = Math.max(0, casesDone - casesFailed);
  const failed = casesFailed > 0 ? `, ${casesFailed} failed` : '';

  if (arm.status === VOICE_RUN_DELETED_STATUS) {
    // Its counters are all zero, which is also what a queued arm looks like. The
    // difference is the whole point of keeping the row: the prompt below is still
    // what this column was told, and the answers it gave are gone.
    return 'its run has been deleted — the prompt it was given is kept below, the answers are not';
  }

  if (arm.status === 'completed') {
    if (casesTotal === 0) return 'it had no questions to answer';
    if (casesFailed >= casesTotal) {
      return `every one of its ${casesTotal} questions failed — nothing was answered`;
    }
    if (casesFailed > 0) return `answered ${answered} of ${casesTotal}${failed}`;
    return `answered all ${casesTotal}`;
  }

  // Live and terminal-but-not-completed read the same way on purpose: the status
  // word carries the difference, and the counts mean the same thing in both.
  return `${arm.status} — ${answered} of ${casesTotal} answered${failed}`;
}

function scoreLabel(score: number | null): string {
  return score === null ? '—' : score.toFixed(2);
}

/**
 * A USD amount at a precision that does not overstate what is known.
 *
 * Two decimals would render most of these estimates as `$0.00`, which reads as
 * free rather than as cheap — and "free" is the one thing this number must never
 * accidentally say about a button that spends money.
 */
function usd(amount: number): string {
  if (amount > 0 && amount < 0.01) return '<$0.01';
  return `$${amount.toFixed(amount < 1 ? 3 : 2)}`;
}

/**
 * The brand-voice number, with the bar it is a number of.
 *
 * Deliberately monochrome. A red/green treatment would read as pass/fail, and
 * neither arm is failing anything — the whole surface exists so two scores can be
 * read against each other rather than against a threshold somebody invented.
 */
function ScoreMeter({ score }: { score: number | null }) {
  const filled = score === null ? 0 : Math.max(0, Math.min(1, score));
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="bg-muted h-1 w-10 overflow-hidden rounded-full" aria-hidden="true">
        <span
          className="bg-foreground/50 block h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${filled * 100}%` }}
        />
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        brand voice {scoreLabel(score)}
      </span>
    </span>
  );
}

/**
 * The one piece of the page that has to move.
 *
 * A run drains in the background over minutes, and the honest failure this
 * guards against is a page that has silently stopped polling looking exactly
 * like a page that is waiting. A ring that keeps expanding is the cheapest proof
 * the surface is still attached to the run.
 */
function LivePulse() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
      <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:hidden" />
      <span className="bg-primary relative inline-flex h-2.5 w-2.5 rounded-full" />
    </span>
  );
}

/**
 * One arm's share of a run in flight.
 *
 * The bar is the real ratio of drained cases, not a decoration: it advances when
 * a case lands and at no other time. The fading segment sitting just past the
 * fill is the part that is decoration — it says "more is coming" for the long
 * stretches between two answers, which is where a purely determinate bar looks
 * indistinguishable from a stalled one.
 */
function ArmProgress({ arm }: { arm: VoiceComparisonArmView }) {
  const { casesDone, casesTotal, casesFailed } = arm.progress;
  const ratio = casesTotal > 0 ? Math.min(1, casesDone / casesTotal) : 0;
  const moving = LIVE_STATUSES.has(arm.status);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{arm.label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {casesTotal > 0 ? `${casesDone} of ${casesTotal} answered` : arm.status}
          {casesFailed > 0 && ` · ${casesFailed} failed`}
        </span>
      </div>
      <div
        className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-label={arm.label}
        aria-valuenow={casesDone}
        aria-valuemin={0}
        aria-valuemax={casesTotal}
      >
        <div
          className="bg-primary absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${ratio * 100}%` }}
        />
        {moving && (
          <div
            className="bg-primary/40 absolute inset-y-0 w-1/4 animate-pulse rounded-full transition-[left] duration-700 ease-out motion-reduce:hidden"
            style={{ left: `${ratio * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** One fact about a run that has not happened yet, in the row above the button. */
function PreflightFact({
  label,
  value,
  detail,
  help,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  help?: React.ReactNode;
}) {
  return (
    <div className="bg-card p-4">
      <div className="text-muted-foreground flex items-center gap-1 text-xs tracking-wide uppercase">
        {label}
        {help}
      </div>
      <div className="mt-1.5 text-sm font-medium">{value}</div>
      {detail && <div className="text-muted-foreground mt-0.5 text-xs">{detail}</div>}
    </div>
  );
}

export function VoiceComparisonBoard({
  initialComparisons,
  initialLoadFailed,
  preflight,
}: VoiceComparisonBoardProps) {
  const [comparisons, setComparisons] = useState(initialComparisons);
  const [listFailed, setListFailed] = useState(initialLoadFailed);
  const [selectedId, setSelectedId] = useState<string | null>(initialComparisons[0]?.id ?? null);
  const [againstId, setAgainstId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VoiceComparisonDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  // Set to a timestamp when the API rate-limits us; polling resumes past it.
  const [backoffUntil, setBackoffUntil] = useState(0);

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
        // A 429 is the one failure that is made worse by trying again straight
        // away, and the only one this surface can cause on its own.
        if (parsed.error.code === RATE_LIMITED_CODE) {
          setBackoffUntil(Date.now() + RATE_LIMITED_BACKOFF_MS);
          setDetailError(
            'Too many requests, so this page has paused for a minute. The runs keep draining in the background — nothing has been lost.'
          );
          setDetail(null);
          return;
        }
        setDetailError(parsed.error.message);
        // Dropped, not left standing. The table is captioned with whichever
        // comparison the selects currently name, so keeping the PREVIOUS one
        // under an error banner attributes one comparison's answers to another —
        // the same false claim the server page drops its empty state to avoid.
        // A failed poll therefore blanks a live table for one interval, which is
        // the honest trade: the page never shows what it did not just read.
        setDetail(null);
        return;
      }
      setDetailError(null);
      setDetail(parsed.data);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setDetailError('The comparison did not load. Reload the page.');
      setDetail(null);
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
  // immutable, so re-reading it would be a request every five seconds that can
  // never return anything new.
  //
  // Read off the DETAIL rather than the list. The two carry the same arm
  // statuses, so polling both to learn one fact was the request that put this
  // page over the admin cap; the list only feeds the two pickers, whose labels
  // are a timestamp and a version and cannot change under a running comparison.
  //
  // The list is the fallback, and it is load-bearing rather than tidy. `detail`
  // is null before the first read lands and again after any read that failed —
  // and deriving "still moving" from that alone would answer "no" for both, so a
  // single dropped request would end the polling for good and leave a draining
  // comparison looking finished. The list is what the surface knew last.
  const selected = comparisons.find((comparison) => comparison.id === selectedId);
  const against = comparisons.find((comparison) => comparison.id === againstId);
  const live = detail
    ? detail.comparisons.some((comparison) =>
        comparison.arms.some((arm) => LIVE_STATUSES.has(arm.status))
      )
    : isLive(selected) || isLive(against);

  // Which arms the run panel draws bars for. Same fallback as `live` and for the
  // same reason: a dropped poll must not empty the panel somebody is watching,
  // so the list's copy of the arms stands in until the next read lands.
  const knownComparisons: VoiceComparisonSummary[] = detail
    ? detail.comparisons
    : [selected, against].filter((comparison) => comparison !== undefined);
  const liveArms: VoiceComparisonArmView[] = knownComparisons
    .filter((comparison) => comparison.arms.some((arm) => LIVE_STATUSES.has(arm.status)))
    .flatMap((comparison) => comparison.arms);

  const drained = liveArms.reduce((total, arm) => total + arm.progress.casesDone, 0);
  const expected = liveArms.reduce((total, arm) => total + arm.progress.casesTotal, 0);

  // `backoffUntil` is 0 or a deadline the effect below clears when it passes, so
  // "are we backing off" is a state question rather than a clock one — and a
  // render that read the clock would be an impure one that could not be trusted
  // to re-run when the answer changed.
  const shouldPoll = live && backoffUntil === 0;

  // Nothing re-renders when a deadline merely passes, so a backoff with no timer
  // behind it would stop the polling permanently rather than for a minute.
  //
  // Lifting it re-reads immediately rather than waiting for the next tick: the
  // banner says the page paused for a minute, and leaving it up for a further
  // five seconds after the minute is over makes a recovered page look stuck.
  useEffect(() => {
    if (backoffUntil === 0) return;
    const lift = () => {
      setBackoffUntil(0);
      setDetailError(null);
      if (selectedId) void loadDetail(selectedId, againstId);
    };
    const remaining = backoffUntil - Date.now();
    if (remaining <= 0) {
      lift();
      return;
    }
    const timer = setTimeout(lift, remaining);
    return () => clearTimeout(timer);
  }, [backoffUntil, selectedId, againstId, loadDetail]);

  useEffect(() => {
    if (!shouldPoll || !selectedId) return;
    const timer = setInterval(() => {
      void loadDetail(selectedId, againstId);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, selectedId, againstId, loadDetail]);

  // One list read when the last arm goes terminal, so a comparison queued in
  // another tab shows up and the pickers are not left holding a stale set.
  const wasLive = useRef(false);
  useEffect(() => {
    if (wasLive.current && !live) void loadList();
    wasLive.current = live;
  }, [live, loadList]);

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

  const stop = useCallback(async () => {
    if (!selectedId) return;
    setStopping(true);
    setQueueError(null);
    try {
      const response = await fetch(`${VOICE_COMPARISON_ENDPOINT}/${selectedId}/cancel`, {
        method: 'POST',
      });
      const parsed = await parseApiResponse<{ cancelled: string[] }>(response);
      if (!parsed.success) {
        setQueueError(parsed.error.message);
        return;
      }
      // Re-read both rather than assuming: the arms the stop actually caught are
      // the server's answer, and a case that landed in the same tick is still a
      // real answer that belongs on screen.
      await Promise.all([loadList(), loadDetail(selectedId, againstId)]);
    } catch {
      setQueueError('The stop request did not get through. Reload the page and try again.');
    } finally {
      setStopping(false);
    }
  }, [selectedId, againstId, loadList, loadDetail]);

  const caseCount = preflight?.caseCount ?? null;

  return (
    <div className="space-y-10">
      {/* ── Run ──────────────────────────────────────────────────────────────
          The invitation, and then the run itself. One panel, because the thing
          you pressed and the thing you are waiting on are the same thing. */}
      <Card className="overflow-hidden">
        {/* A hairline that only moves while something is draining — the first
            thing visible from across the room, and inert the rest of the time. */}
        <div
          aria-hidden="true"
          className={
            live
              ? 'bg-primary/70 h-0.5 w-full animate-pulse motion-reduce:animate-none'
              : 'bg-border h-0.5 w-full'
          }
        />

        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                {live && <LivePulse />}
                {live ? 'The voice test is running' : 'Run the voice test'}
              </CardTitle>
              <CardDescription className="max-w-2xl leading-relaxed">
                {live ? (
                  <>
                    It runs in the background, a question at a time. You can leave this page — the
                    worker keeps going and the board picks the run back up.
                  </>
                ) : (
                  <>
                    {caseCount === null ? 'The authored questions are' : `${caseCount} questions,`}{' '}
                    asked twice: once through the agent with the voice prompt applied, once through
                    a plain model given no voice instructions. Every run is kept.
                  </>
                )}
              </CardDescription>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button onClick={() => void queue()} disabled={queueing || live} size="lg">
                {queueing || live ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {queueing ? 'Queueing…' : 'Run the voice test'}
              </Button>

              {/* Only while something is actually draining. A Stop that is always
                  there invites a press on a finished run, and answering that press
                  with "already finished" is a worse surface than not offering it. */}
              {live && (
                <Button variant="outline" onClick={() => void stop()} disabled={stopping} size="lg">
                  <Square className="mr-2 h-4 w-4" />
                  {stopping ? 'Stopping…' : 'Stop'}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-6">
          {live ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Progress</p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {drained} of {expected} answers in
                </p>
              </div>
              {liveArms.map((arm, index) => (
                <ArmProgress key={`${arm.arm}:${arm.evaluationRunId ?? index}`} arm={arm} />
              ))}
            </div>
          ) : (
            preflight && (
              // A hairline grid rather than three bordered boxes: the facts belong
              // to one estimate, and three separate cards would read as three.
              <div className="bg-border grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3">
                <PreflightFact
                  label="Questions"
                  value={caseCount === null ? '—' : `${caseCount} × 2 arms`}
                  detail="each answer scored by the judge"
                />
                <PreflightFact
                  label="Model"
                  value={preflight.modelId ?? 'Not resolved'}
                  detail={preflight.modelId === null ? 'no model bound to an arm' : undefined}
                />
                {preflight.cost && (
                  <PreflightFact
                    label="Estimated cost"
                    value={
                      preflight.cost.pricingKnown ? (
                        <>about {usd(preflight.cost.midUsd)} a run</>
                      ) : (
                        // A model with no published rate prices at $0. Rendering
                        // that as a cost would tell an operator the run is free.
                        <>cost unknown</>
                      )
                    }
                    detail={
                      preflight.cost.pricingKnown ? (
                        <>
                          {usd(preflight.cost.lowUsd)}–{usd(preflight.cost.highUsd)}
                        </>
                      ) : (
                        <>a model in this run has no published rate</>
                      )
                    }
                    help={
                      <FieldHelp title="About the estimate">
                        <p>
                          Planning-grade, not a quote. It covers both arms answering every question
                          and the brand-voice judge scoring every answer.
                        </p>
                        <p className="mt-2">
                          {preflight.cost.basedOn === 'empirical'
                            ? 'Based on what past runs of this set actually cost.'
                            : 'Based on a token estimate rather than past runs, so the range is wide until a few runs have accumulated.'}
                        </p>
                        {preflight.cost.notes && (
                          <p className="text-muted-foreground mt-2">{preflight.cost.notes}</p>
                        )}
                      </FieldHelp>
                    }
                  />
                )}
              </div>
            )
          )}

          {queueError && (
            <p role="alert" className="text-destructive mt-4 text-sm">
              {queueError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Results ──────────────────────────────────────────────────────────
          Reading runs, and nothing about starting one. */}
      <section className="space-y-6">
        <div className="space-y-4 border-b pb-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight">Results</h3>
            <p className="text-muted-foreground text-xs tabular-nums">
              {comparisons.length === 1 ? '1 run kept' : `${comparisons.length} runs kept`}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="comparison">Comparison</Label>
              <Select
                value={selectedId ?? undefined}
                onValueChange={(value) => {
                  setSelectedId(value);
                  // The Against list filters out whatever is selected here, so
                  // leaving it pointing at this comparison leaves its trigger
                  // matching no item — Radix renders a blank with no placeholder
                  // and no way back to "Nothing".
                  if (value === againstId) setAgainstId(null);
                }}
                disabled={comparisons.length === 0}
              >
                <SelectTrigger id="comparison" className="w-full">
                  <SelectValue placeholder="Nothing has been run yet" />
                </SelectTrigger>
                <SelectContent>
                  {comparisons.map((comparison) => (
                    <SelectItem key={comparison.id} value={comparison.id}>
                      {comparisonLabel(comparison)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-64 flex-1 space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="against">Against</Label>
                <FieldHelp title="Against">
                  <p>
                    Optional. Put a second comparison&rsquo;s columns in the same table to read two
                    versions of the voice prompt side by side.
                  </p>
                  <p className="mt-2">
                    Each comparison brings its own bare-model column, which is the point: if both
                    versions moved in the same direction as their controls, the model had a
                    different day and the voice prompt did not change anything.
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
                        {comparisonLabel(comparison)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

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
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="font-medium">The voice test has not been run yet.</p>
            <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
              Press Run the voice test above. Answers arrive a question at a time as the background
              worker works through each run, and they appear here.
            </p>
          </div>
        )}

        {detail && detail.comparisons.length > 0 && (
          <div className="space-y-6">
            <div className="divide-y rounded-xl border">
              {detail.comparisons.map((comparison) => (
                <div key={comparison.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium">Test set v{comparison.goldenSetVersion}</span>
                    <span className="text-muted-foreground text-xs">
                      queued <ClientDate date={comparison.createdAt} showTime />
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {comparison.arms.map((arm) => (
                      // Keyed on the arm, not the run id: the run id is null once
                      // the run has been deleted, and two deleted arms would then
                      // share a key.
                      <li
                        key={`${comparison.id}:${arm.arm}`}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                      >
                        <span className="font-medium">{arm.label}</span>
                        <span className="text-muted-foreground flex-1 text-xs">
                          {armStatusLine(arm)}
                        </span>
                        <ScoreMeter score={arm.brandVoiceMean} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {detail.mixedGoldenSets && (
                <p className="bg-muted/50 p-4 text-sm font-medium">
                  These two comparisons ran different questions. A difference between them may be
                  the question rather than the voice prompt.
                </p>
              )}
            </div>

            <div className="rounded-xl border">
              <button
                type="button"
                onClick={() => setPromptsOpen((open) => !open)}
                className="hover:bg-muted/40 flex w-full items-center gap-2 rounded-xl p-4 text-left text-sm font-medium transition-colors"
                aria-expanded={promptsOpen}
              >
                {promptsOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                What each column was told
              </button>
              {promptsOpen && (
                <div className="space-y-4 border-t p-4">
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Composed and stored when the comparison was queued, not read back off the agents
                    now — so this is what actually produced the answers below, even if the voice
                    prompt has since changed.
                  </p>
                  {detail.columns.map((column) => (
                    <div key={column.columnId}>
                      <div className="text-sm font-medium">
                        {column.label}{' '}
                        <span className="text-muted-foreground font-normal">
                          · {column.agentSlug}
                        </span>
                      </div>
                      <pre className="bg-muted mt-1.5 max-h-64 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                        {column.systemPrompt}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {detail.cases.map((entry) => (
                <div key={entry.key} className="overflow-hidden rounded-xl border">
                  <div className="bg-muted/40 border-b p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="bg-background">
                        {entry.kind}
                      </Badge>
                      <span className="text-muted-foreground font-mono text-xs">{entry.key}</span>
                    </div>
                    {entry.promptVaries ? (
                      // No single wording can head this row: the versions on screen
                      // kept the key and changed the words, so each column carries
                      // the question it was actually asked.
                      <p className="mt-2 font-medium">
                        The versions on screen worded this question differently — each column shows
                        what it was asked.
                      </p>
                    ) : (
                      <p className="mt-2 font-medium text-balance">{entry.prompt}</p>
                    )}
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
                    {entry.answers.map((answer) => {
                      // A case the subject FAILED comes back with `subjectOutput`
                      // as an empty string rather than null, so a null check alone
                      // rendered it as a real answer that happened to be blank —
                      // an empty bubble where the page should be saying the column
                      // has nothing in it. Whitespace counts as nothing too.
                      const hasAnswer = answer.output !== null && answer.output.trim().length > 0;
                      return (
                        <div
                          key={answer.columnId}
                          className="border-border/70 space-y-2 border-l pl-4 first:border-l-0 first:pl-0"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm font-medium">{answer.label}</span>
                            <ScoreMeter score={answer.brandVoiceScore} />
                          </div>
                          {entry.promptVaries && (
                            <p className="text-muted-foreground text-xs">
                              {answer.prompt ?? 'This version did not ask this question.'}
                            </p>
                          )}
                          {hasAnswer && (
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                              {answer.output}
                            </p>
                          )}
                          {!hasAnswer && answer.runDeleted && (
                            <p className="text-muted-foreground text-sm italic">
                              The run that produced this answer has been deleted.
                            </p>
                          )}
                          {!hasAnswer && !answer.runDeleted && !answer.errorMessage && (
                            <p className="text-muted-foreground text-sm italic">
                              Not answered yet.
                            </p>
                          )}
                          {/* The error keeps its own treatment whether or not any
                              text came back: a case that failed is not the same
                              fact as one the worker has not reached, and the
                              muted "not yet" styling would say it was. */}
                          {answer.errorMessage && !answer.runDeleted && (
                            <p role="alert" className="text-destructive text-sm">
                              {answer.errorMessage}
                            </p>
                          )}
                          {answer.brandVoiceReasoning && (
                            <p className="text-muted-foreground border-t pt-2 text-xs leading-relaxed">
                              {answer.brandVoiceReasoning}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
