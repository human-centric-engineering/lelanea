'use client';

import { useEffect } from 'react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { LAST_MODULE_STORAGE_KEY } from '@/lib/app/journey/paths';

/**
 * Tells the shell which module is open — twice over, because two parts of the
 * shell need it and they need different things.
 *
 * **The slug, remembered**, so the Workspace nav item can bring the reader back
 * to it later. Per browser, in `localStorage`, because there is no per-user
 * journey yet to hold "the module you are in" — and when there is, that is the
 * one line that moves.
 *
 * **The place, published**, so the conversation column's way back can say
 * `← the main conversation · on 01 · Values`. That is live state rather than a
 * memory, so it goes through the shell provider and not through storage: it has
 * to be right for THIS render and gone the moment the reader leaves.
 *
 * Both exist because a module page is rendered inside the workspace, which is a
 * sibling of the conversation and of the nav — context flows downward only, and
 * the page is the only thing holding the authored number and title. This
 * component renders nothing; it exists to run those two effects from a server
 * page.
 */
export function RememberModule({
  slug,
  displayNumber,
  title,
}: {
  slug: string;
  /** `01` — the authored number, which is a label rather than a position. */
  displayNumber: string;
  title: string;
}) {
  const [, setLastModule] = useLocalStorage<string | null>(LAST_MODULE_STORAGE_KEY, null);
  const { setModulePlace } = useShellLayout();

  useEffect(() => {
    setLastModule(slug);
  }, [slug, setLastModule]);

  useEffect(() => {
    setModulePlace({ slug, label: `${displayNumber} · ${title}` });
    // Cleared on the way out, so leaving a module for a destination that is not
    // one cannot leave the shell claiming the reader is still in it. The
    // provider ALSO guards on the slug matching the route, which covers the
    // other direction — module to module, where this cleanup and the next
    // effect race.
    return () => setModulePlace(null);
  }, [slug, displayNumber, title, setModulePlace]);

  return null;
}
