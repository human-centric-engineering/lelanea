'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { JourneyRefused } from '@/lib/app/journey-record/client';
import { logger } from '@/lib/logging';

export interface JourneyAction {
  /** A call is out. Every control that would send another is disabled meanwhile. */
  busy: boolean;
  /** What the last refusal said, written to be shown. Null after a call that went through. */
  error: string | null;
  /**
   * Run one call to the record's routes, then re-read the page. Resolves true
   * when the call went through, so a form can close itself.
   */
  run: (call: () => Promise<void>) => Promise<boolean>;
}

/**
 * One change to the record, from a stop or the composer (t-148).
 *
 * Every change ends in `router.refresh()`: the server page reads the record
 * again, and what is on screen is that read, never a patch made up here. A
 * refusal for `changed_meanwhile` refreshes too, since its whole meaning is
 * that the page is behind.
 */
export function useJourneyAction(): JourneyAction {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await call();
      router.refresh();
      return true;
    } catch (caught: unknown) {
      if (caught instanceof JourneyRefused) {
        setError(caught.message);
        if (caught.code === 'changed_meanwhile') router.refresh();
      } else {
        logger.warn('Journey record change failed', {
          error: caught instanceof Error ? caught.message : String(caught),
        });
        setError('That did not go through. Check your connection and try again.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}
