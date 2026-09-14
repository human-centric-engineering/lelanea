'use client';

import { useEffect } from 'react';

import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { LAST_MODULE_STORAGE_KEY } from '@/lib/app/journey/paths';

/**
 * Remembers the module being read, so the Workspace nav item can bring the
 * reader back to it.
 *
 * Per browser, in `localStorage`, because there is no per-user journey yet to
 * hold "the module you are in" — and when there is, this is the one line that
 * moves. Renders nothing; it exists to run one effect from a server page.
 */
export function RememberModule({ slug }: { slug: string }) {
  const [, setLastModule] = useLocalStorage<string | null>(LAST_MODULE_STORAGE_KEY, null);
  useEffect(() => {
    setLastModule(slug);
  }, [slug, setLastModule]);
  return null;
}
