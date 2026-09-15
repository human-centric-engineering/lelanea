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
 * The hue each of the five arcs is named in — the prototype's `TIER_TONE`,
 * resolved to the token of that hue that can carry TEXT.
 *
 * The design names its tiers in their own colour (`.tierlab { color:
 * var(--tiertone) }`). `shell.md` recorded why that was not carried over: in
 * light mode the raw hues do not carry 11px type — measured against
 * `--color-background`, `--color-accent-ink` reaches 3.17:1 and raw
 * `--color-status-yellow` 2.03:1, both under AA. So the label was left muted
 * with the raw tone on a bullet beside it, which is a different thing from what
 * the design draws: it reads as a list with dots rather than as five named arcs.
 *
 * The palette already answers this and the first pass simply did not use it.
 * Every status hue ships an `-ink` sibling that flips per theme precisely so it
 * can be set in type. Measured on `--color-background`, light / dark:
 *
 * | Arc                     | Token                       | Light | Dark |
 * | ----------------------- | --------------------------- | ----- | ---- |
 * | onboarding              | `--color-status-green-ink`  | 6.30  | pass |
 * | foundations             | `--color-secondary-ink`     | 4.91  | 6.96 |
 * | inner authority         | `--color-status-yellow-ink` | 5.05  | pass |
 * | embodied relationship   | `--color-status-red-ink`    | 5.92  | 6.46 |
 * | integration & expansion | `--color-status-purple-ink` | 6.43  | pass |
 *
 * The orange arc is the one to notice. `--color-accent-ink` is the ceremonial
 * burnt orange and holds across both modes, which is exactly why it cannot do
 * this: 3.17:1 light and 3.92:1 dark — it fails in BOTH. Its text-carrying
 * sibling here is `--color-status-red-ink`, the same terracotta family, which
 * the stylesheet describes as "where §6.2's danger hue is actually read as a
 * colour rather than sat on". `--color-primary` is the other candidate and
 * fails dark at 2.72:1.
 *
 * **There is deliberately no second table of raw hues.** One stood beside this
 * for a while, left over from painting the bullet — and the moment the bullet
 * went it had no caller and a docblock saying the opposite of this one. Two
 * tables of arc colours, one of them wrong and neither used, is how the next
 * reader ends up acting on whichever they open first. If something ever needs an
 * arc's hue on a SURFACE, where contrast does not arise, add it back then with
 * the caller that wants it.
 */
export const TIER_INKS: Readonly<Record<string, string>> = {
  onboarding: 'var(--color-status-green-ink)',
  foundations: 'var(--color-secondary-ink)',
  inner_authority: 'var(--color-status-yellow-ink)',
  embodied_relationship: 'var(--color-status-red-ink)',
  integration_and_expansion: 'var(--color-status-purple-ink)',
};

/**
 * What a module's `state` reads as in the row, and the dot that goes with it.
 *
 * **`open` reads as "not started", deliberately.** `open` is a fact about the
 * SYSTEM — every module can be jumped into, because no per-user journey exists
 * yet — and putting it in the row made every line say the same non-word about
 * itself. The design's column says where the reader has got to (`complete ●`,
 * `step 5 of 10 ●`, `not started ○`), so while there is nothing to say, the
 * honest thing to say is that nothing has been started.
 *
 * The dot encodes the same thing: a hollow ring for not started, and a filled
 * one in the state's colour once there is a state to fill it with. `null` here
 * means the ring.
 *
 * Widens with per-user journeys — and a tab whose bundle predates that widening
 * stays mounted across every in-app navigation, so a state this table does not
 * know falls back to the raw value rather than rendering `undefined`.
 */
const STATE_ROW: Readonly<
  Record<JourneyMapView['modules'][number]['state'], { text: string; fill: string | null }>
> = {
  open: { text: 'not started', fill: null },
};
function stateRow(state: JourneyMapView['modules'][number]['state']): {
  text: string;
  fill: string | null;
} {
  return STATE_ROW[state] ?? { text: state, fill: null };
}

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
  //
  // Set in the body AND cleared in the cleanup, not cleared alone: React's dev
  // StrictMode mounts, unmounts and mounts again, so a cleanup-only effect
  // leaves the flag false after the second mount and every response is
  // dropped. That shipped past the unit tests (no StrictMode there) and was
  // caught by looking at it in a browser — the drawer sat at "Finding your
  // map…" with a 200 in the network tab.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
        // A failure is retried on the next open — "try again in a moment" is a
        // promise the drawer has to keep, and the shell stays mounted across
        // every in-app navigation, so without this the map would be dead until
        // a hard reload. Found in review.
        if (!unpublished) requested.current = false;
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
        The map could not be loaded. Close this and open it again in a moment.
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
            {/*
              Lowercase, tracked out, and in the arc's own ink — the design's
              `.tierlab`. `lowercase` is safe HERE specifically, which is the
              caveat `Eyebrow` refuses to force on every eyebrow: these five
              labels are common nouns, so nothing loses a capital that meant
              something. An eyebrow carrying Lelañea's name would.

              The colour comes from `TIER_INKS` — see the table at its
              declaration for what each arc was measured at, and why the orange
              one does not use the ceremonial `--color-accent-ink`. Inline
              rather than an arbitrary class because the value is a per-tier
              lookup, not a constant.
            */}
            <Eyebrow
              as="h3"
              id={`map-tier-${tier.id}`}
              style={{ color: TIER_INKS[tier.id] ?? 'var(--color-muted-foreground)' }}
              className="block px-3 pt-4 pb-1 text-[11px] tracking-[0.13em] lowercase"
            >
              {tier.label}
            </Eyebrow>
            <p className="text-muted-foreground px-3 pb-1.5 text-[12.5px] leading-[1.55]">
              {tier.intent}
            </p>
            <ul className="m-0 list-none p-0">
              {modules.map((module) => {
                const href = modulePath(module.slug);
                const current = pathname === href;
                const state = stateRow(module.state);
                return (
                  <li key={module.slug}>
                    <Link
                      href={href}
                      onClick={closeDrawer}
                      aria-current={current ? 'page' : undefined}
                      title={`${module.title} · ${state.text}`}
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
                        {state.text}
                      </span>
                      {/*
                        The dot encodes the state: a hollow ring for not
                        started, filled in the state's colour once there is one.
                        With no per-user journey every row is a ring, honestly —
                        `state.fill` is the seam that stops being null.
                      */}
                      <i
                        aria-hidden="true"
                        style={state.fill ? { background: state.fill } : undefined}
                        className={cn(
                          'h-[7px] w-[7px] flex-none rounded-full',
                          state.fill
                            ? 'border-[1.5px] border-transparent'
                            : 'border-[1.5px] border-[var(--color-border)]'
                        )}
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
