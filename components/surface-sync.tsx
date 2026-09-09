'use client';

import { useEffect, useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';

import { classifySurface } from '@/lib/app/surface';

/**
 * Keeps `<html data-surface>` in sync with the current route on client-side
 * navigation.
 *
 * The root layout sets the attribute once from the proxy's `x-surface` header —
 * correct on a hard load and for first-paint portal theming. But the root
 * `<html>` persists across App Router navigations (the root layout does not
 * re-render), so without this the attribute would stay stuck at whatever the
 * first-loaded page was — e.g. a consumer page's fork theme bleeding into
 * `/admin`. This re-derives the surface from the pathname after each navigation
 * and updates the attribute. Renders nothing.
 *
 * Timing: the update must run BEFORE paint. Upstream uses `useEffect`, which
 * runs after it, so a client-side nav between two differently-themed surfaces
 * shows one frame of the old theme. That is invisible in vanilla Sunrise, whose
 * `app/brand-theme.css` ships empty — but this is the fork that filled it, and
 * `components/auth/user-button.tsx` puts a `<Link href="/admin">` in the site
 * header, so an admin moving between the app and `/admin` gets a full frame of
 * oyster white over the admin's white, and charcoal on the way back.
 *
 * LELAÑEA divergence — see `.context/app/divergences.md`, row 3. The swap to a
 * guarded layout-effect is the remedy upstream's own comment named for exactly
 * this case; the guard avoids React's "useLayoutEffect does nothing on the
 * server" warning during SSR.
 *
 * See `.context/ui/surface-theming.md` constraint 2.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
export function SurfaceSync(): null {
  const pathname = usePathname();

  useIsomorphicLayoutEffect(() => {
    document.documentElement.dataset.surface = classifySurface(pathname);
  }, [pathname]);

  return null;
}
