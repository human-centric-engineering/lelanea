'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { apiClient, APIClientError } from '@/lib/api/client';
import type { JourneyMapView } from '@/lib/app/journey/map';
import { modulePath } from '@/lib/app/journey/paths';
import { cn } from '@/lib/utils';

/** The endpoint the drawer reads. One place, so a test can name it. */
export const JOURNEY_MAP_ENDPOINT = '/api/v1/app/journey/map';

/**
 * The hue each tier carries, keyed by its id — the prototype's `TIER_TONE`,
 * every value an existing palette token.
 *
 * It paints the swatch beside the tier label, NOT the label's text. The
 * prototype tints the text, and `shell.md` records why that is not carried
 * over anywhere in the shell: measured in light mode, `--color-accent-ink`
 * reaches 3.17:1 and `--color-status-yellow` 2.03:1 against the ground — both
 * under AA for text this size — and the rule is set by the worse theme. The
 * label keeps `--color-muted-foreground`, where contrast is measured; the tone
 * is decorative, and the label carries the tier.
 */
export const TIER_TONES: Readonly<Record<string, string>> = {
  onboarding: 'var(--color-status-green)',
  foundations: 'var(--color-secondary-ink)',
  inner_authority: 'var(--color-status-yellow)',
  embodied_relationship: 'var(--color-accent-ink)',
  integration_and_expansion: 'var(--color-status-purple)',
};

/** What a module's `state` reads as in the row. Widens with per-user journeys. */
const STATE_TEXT: Readonly<Record<JourneyMapView['modules'][number]['state'], string>> = {
  open: 'open',
};

type Load =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; map: JourneyMapView }
  | { status: 'unpublished' }
  | { status: 'failed' };

/**
 * The map drawer's body: five tiers, seventeen modules, from the published
 * graph via the leaf's map API.
 *
 * ## It fetches when first opened, not when the shell mounts
 *
 * The drawer is always mounted (it slides rather than mounts — see
 * `drawer.tsx`), so a fetch on mount would run for every signed-in page view
 * whether or not anyone opens the map. Keyed on the first open instead, and
 * kept for the session: the ETag on the route makes a refetch cheap, but a
 * drawer that re-loads every time it slides in would flash, and the map does
 * not change under a reader.
 *
 * ## Every row is simply open
 *
 * No `done`, no `current`: those are per-user journey state, which this phase
 * deliberately does not have. The one state that IS shown is *where you are* —
 * `aria-current="page"` on the module whose page is open — because that is a
 * fact about the route, not about progress.
 *
 * ## Rows are links
 *
 * Opening a row navigates, and the drawer closes on the click. A `<Link>`
 * rather than a button with `router.push` because it IS navigation: it gets
 * the middle-click, the hover URL and the prefetch for free, and the focus trap
 * in `drawer.tsx` already counts `a[href]`.
 */
export function MapDrawerBody() {
  const { drawer, closeDrawer } = useShellLayout();
  const pathname = usePathname();
  const [load, setLoad] = useState<Load>({ status: 'idle' });
  const open = drawer === 'map';
  // Whether the fetch has been started this session. A ref, not a dependency
  // on `load.status`: an effect keyed on the status it sets re-runs its own
  // cleanup the moment it moves to `loading`, and the response then arrives
  // "cancelled". Found by the first test written against it.
  const requested = useRef(false);
  // Unmount only — NOT the fetch effect's own cleanup, which also runs when the
  // drawer closes while the request is in flight, and would leave it loading
  // for the rest of the session.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    setLoad({ status: 'loading' });
    apiClient
      .get<JourneyMapView>(JOURNEY_MAP_ENDPOINT)
      .then((map) => {
        if (mounted.current) setLoad({ status: 'loaded', map });
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        // A 404 is the honest pre-seed state, not a failure to report as one.
        const unpublished = error instanceof APIClientError && error.status === 404;
        setLoad({ status: unpublished ? 'unpublished' : 'failed' });
      });
  }, [open]);

  if (load.status === 'idle' || load.status === 'loading') {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed" aria-live="polite">
        Finding your map…
      </p>
    );
  }
  if (load.status === 'unpublished') {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed">
        The map is not published yet. The modules arrive with it.
      </p>
    );
  }
  if (load.status === 'failed') {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed" role="status">
        The map could not be loaded. Close this and try again in a moment.
      </p>
    );
  }

  const { map } = load;
  return (
    <div className="flex flex-col">
      {map.tiers.map((tier) => {
        const modules = map.modules.filter((m) => m.tier === tier.id);
        return (
          <section key={tier.id} aria-labelledby={`map-tier-${tier.id}`} className="flex flex-col">
            <Eyebrow
              as="h3"
              id={`map-tier-${tier.id}`}
              className="flex items-center gap-2 px-3 pt-3.5 pb-0.5 text-[11px] tracking-[0.13em]"
            >
              <i
                aria-hidden="true"
                className="inline-block h-[7px] w-[7px] flex-none rounded-full"
                style={{ background: TIER_TONES[tier.id] ?? 'var(--color-border)' }}
              />
              {tier.label}
            </Eyebrow>
            <p className="text-muted-foreground px-3 pb-1.5 text-[12.5px] leading-[1.55]">
              {tier.intent}
            </p>
            <ul className="m-0 list-none p-0">
              {modules.map((module) => {
                const href = modulePath(module.slug);
                const current = pathname === href;
                return (
                  <li key={module.slug}>
                    <Link
                      href={href}
                      onClick={closeDrawer}
                      aria-current={current ? 'page' : undefined}
                      title={`${module.title} · ${STATE_TEXT[module.state]}`}
                      className={cn(
                        'flex w-full items-center gap-[11px] rounded-[11px] border border-transparent',
                        'px-3 py-[9px] text-left no-underline hover:no-underline',
                        'hover:bg-[var(--color-pill)]',
                        'transition-[background-color] duration-200 ease-[var(--ease-brand)]',
                        'motion-reduce:transition-none',
                        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
                        'focus-visible:outline-[var(--color-ring)]',
                        'aria-[current=page]:border-[var(--color-divider)]',
                        'aria-[current=page]:bg-[var(--color-muted)]'
                      )}
                    >
                      <span className="text-muted-foreground w-[22px] flex-none text-[12px] tracking-[0.04em]">
                        {module.displayNumber}
                      </span>
                      <span
                        className={cn(
                          'text-muted-foreground min-w-0 flex-1 truncate text-[14px]',
                          current && 'font-medium text-[var(--color-heading)]'
                        )}
                      >
                        {module.title}
                      </span>
                      <span className="text-muted-foreground flex-none text-[12px] tracking-[0.04em]">
                        {STATE_TEXT[module.state]}
                      </span>
                      {/* A hollow ring: no module is done or current this phase. */}
                      <i
                        aria-hidden="true"
                        className="h-[7px] w-[7px] flex-none rounded-full border-[1.5px] border-[var(--color-border)]"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
