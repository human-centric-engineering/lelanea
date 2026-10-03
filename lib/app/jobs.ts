/**
 * App recurring-job registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the other
 * `lib/app/*` seams.
 *
 * Auto-wired: the maintenance tick calls this once before it first runs app jobs
 * (server runtime). Add `registerAppJob({ name, intervalMs, run })` calls to run
 * your own periodic work on the existing tick instead of standing up a second
 * scheduler.
 *
 * `intervalMs` is a **minimum** gap, not a guarantee, and last-run times live in
 * process memory — so a multi-instance deployment runs each job about once per
 * instance per interval, and a restart re-arms everything. Write jobs to be
 * idempotent. If a job must run exactly once cluster-wide it needs its own lease;
 * see `execution-reaper` for that pattern.
 *
 * Full guide: CUSTOMIZATION.md §4 · .context/orchestration/scheduling.md
 */

import { registerAppJob } from '@/lib/orchestration/maintenance/app-jobs';
import { backfillMemoryIndex } from '@/lib/app/memory/memory-index';

export function initAppJobs(): void {
  registerAppJob({
    // f-memory t-129. Embeds the person's messages the turn path did not:
    // everything said before the index existed, and any embedding that failed
    // on the turn. Per org (the default scope), a batch per run. Idempotent: an
    // indexed message is never selected again.
    name: 'app:memory-index-backfill',
    intervalMs: 5 * 60 * 1000,
    run: () => backfillMemoryIndex(),
  });
}
