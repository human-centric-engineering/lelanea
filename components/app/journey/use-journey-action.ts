'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { JourneyRefused } from '@/lib/app/journey-record/client';
import { logger } from '@/lib/logging';

export interface JourneyAction {
  /**
   * A call is out, or the re-read after it has not landed yet. Every control
   * that would send another is disabled meanwhile, so nothing acts on what the
   * server has already changed.
   */
  busy: boolean;
  /** What the last refusal said, written to be shown. Null after a call that went through. */
  error: string | null;
  /**
   * Run one call to the record's routes, then re-read the page. Resolves true
   * when the call went through, so a form can close itself.
   */
  run: (call: () => Promise<unknown>) => Promise<boolean>;
}

/**
 * One change to the record, from a stop or the composer (t-148).
 *
 * Every change ends in `router.refresh()`: the server page reads the record
 * again, and what is on screen is that read, never a patch made up here. A
 * refusal for `changed_meanwhile` refreshes too, since its whole meaning is
 * that the page is behind. The refresh runs in a transition, and the action
 * stays busy until it lands: otherwise a stop just removed or kept is briefly
 * live again, and a second click acts on a row that has already changed.
 */
export function useJourneyAction(): JourneyAction {
  const router = useRouter();
  const [calling, setCalling] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => startRefresh(() => router.refresh());

  async function run(call: () => Promise<unknown>): Promise<boolean> {
    setCalling(true);
    setError(null);
    try {
      await call();
      refresh();
      return true;
    } catch (caught: unknown) {
      if (caught instanceof JourneyRefused) {
        setError(caught.message);
        if (caught.code === 'changed_meanwhile') refresh();
      } else {
        logger.warn('Journey record change failed', {
          error: caught instanceof Error ? caught.message : String(caught),
        });
        setError('That did not go through. Check your connection and try again.');
      }
      return false;
    } finally {
      setCalling(false);
    }
  }

  return { busy: calling || refreshing, error, run };
}
