'use client';

/**
 * useRowActions (f-ops-views t-4c) — the shared per-row action state for the module binding
 * tabs' read tables (Agents / Workflows / Knowledge).
 *
 * Each binding table runs at most one row mutation at a time and gates a destructive action
 * (unbind / revoke) behind a two-step confirm. This hook owns that state machine:
 *   - `confirmingId` — the row whose confirm prompt is open (via `setConfirmingId`).
 *   - `busyId` — the row with a mutation in flight; `run()` sets/clears it and reports a failure.
 *   - `failure` — the last refused action, for the one `<SaveError>` above the table.
 *   - `locked` — true while any row is busy OR a confirm is open anywhere. Non-confirm row
 *     actions gate on this, so a confirm can't be interleaved with another row's action into
 *     two concurrent mutations (the asymmetric-guard bug the t-4b review caught). The Confirm/
 *     Cancel buttons themselves gate on `busyId !== null` (see `<RowConfirm>`), so the open
 *     confirm stays actionable until something is actually in flight.
 */

import { useState } from 'react';

import type { SaveFailure } from '@/lib/errors/save-error';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';

export interface RowActions {
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  busyId: string | null;
  /** The last refused action; pass to `<SaveError>`. Null until one is refused. */
  failure: SaveFailure<never> | null;
  /** True while any row is busy or a confirm is open — gate non-confirm row actions on this. */
  locked: boolean;
  /**
   * Run a row mutation with busy tracking: sets `busyId`, awaits `fn`, clears the confirm on
   * success, and reports a failure. The box sits above the table, away from the row, so `context`
   * leads the message and says what was refused (`Failed to unbind agent: …`).
   */
  run: (id: string, fn: () => Promise<void>, context: string) => Promise<void>;
}

export function useRowActions(): RowActions {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const save = useSaveFailure({
    fallback: 'Could not complete that. Try again.',
    fields: NO_SERVER_FIELDS,
  });

  const locked = busyId !== null || confirmingId !== null;

  // Opening a confirm clears any stale row error, so a prior failed action's message doesn't
  // linger over an unrelated confirm prompt (parity with the pre-primitive tabs, which reset
  // the error before opening). Cancelling (`null`) leaves the error as-is.
  function openConfirm(id: string | null) {
    if (id !== null) save.clear();
    setConfirmingId(id);
  }

  async function run(id: string, fn: () => Promise<void>, context: string) {
    setBusyId(id);
    save.clear();
    try {
      await fn();
      setConfirmingId(null);
    } catch (err) {
      save.report(err, context);
    } finally {
      setBusyId(null);
    }
  }

  return { confirmingId, setConfirmingId: openConfirm, busyId, failure: save.failure, locked, run };
}
