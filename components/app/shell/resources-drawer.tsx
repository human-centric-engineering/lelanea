'use client';

import { ExternalLink, FileText, Play } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { TIER_INKS } from '@/components/app/shell/map-drawer';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { apiClient } from '@/lib/api/client';
import type { ResourcesSelection } from '@/lib/app/content/resources';
import { MODULES_PATH_PREFIX } from '@/lib/app/journey/paths';
import { cn } from '@/lib/utils';

/** The endpoint the drawer reads, minus the key. One place, so a test can name it. */
export const RESOURCES_ENDPOINT = '/api/v1/app/content/resources';

/** The lede while there is nothing to name yet — true of the panel either way. */
export const RESOURCES_FALLBACK_LEDE = 'Films and reading, in her own words.';

/** The tone while there is no module to take an arc from. */
const FALLBACK_TONE = 'var(--color-secondary-ink)';

/**
 * Which key the drawer follows, from the route — the prototype's
 * `resourceKey()`, which reads `S.ws.kind`. Here the workspace is a route, so
 * the pathname is the key, the same way `Panes` finds its tone (`view-tone.ts`).
 *
 * A module page is `/app/modules/<slug>`; the journey and situations views are
 * their own routes; everything else — `/app` itself, settings, usage — is
 * `default`, her words on the whole.
 */
export function resourceKeyFor(pathname: string): string {
  const modulePrefix = `${MODULES_PATH_PREFIX}/`;
  if (pathname.startsWith(modulePrefix)) {
    const slug = pathname.slice(modulePrefix.length).split('/')[0];
    if (slug) return slug;
  }
  if (pathname === '/app/journey' || pathname.startsWith('/app/journey/')) return 'journey';
  if (pathname === '/app/situations' || pathname.startsWith('/app/situations/')) {
    return 'situations';
  }
  return 'default';
}

/**
 * Where the site renders each foundational document, for a reading that names
 * one by `documentId`.
 *
 * The API serves the id and not a path on purpose: a native client renders the
 * document through `/documents/:id`, and a web path would mean nothing to it.
 * So the web client owns this table. A document with no page — `the_initiation`
 * is the first-run welcome and has none — renders as a row without a link
 * rather than a link to nowhere. `resources-drawer.test.tsx` pins every id here
 * against the real collection.
 */
export const DOCUMENT_PAGES: Readonly<Record<string, string>> = {
  the_mission: '/mission',
  disclaimer: '/disclaimer',
  terms_of_use: '/terms',
  the_heart_behind_lelanea: '/lelanea',
  about_the_creator: '/lelanea',
  the_lineage_of_lelanea: '/lelanea',
};

export type ResourcesLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; selection: ResourcesSelection }
  | { status: 'failed' };

/**
 * The selection for whatever is open, fetched when the drawer opens and
 * re-fetched when what is open changes underneath it.
 *
 * ## Keyed on the request, not on the first open
 *
 * The map drawer fetches once a session, because the map does not change under
 * a reader. This panel FOLLOWS the reader: open it on Values, close it, walk to
 * Boundaries and open it again, and it must say Boundaries. So the request is
 * keyed on `key` and the pinned film, and a change while open re-fetches; the
 * ETag on the route makes the repeat cheap, and the last good selection stays
 * on screen while the next loads rather than flashing to a spinner.
 *
 * A failure is retried on the next open — the shell stays mounted across every
 * in-app navigation, so without that the panel would be dead until a reload
 * (the map drawer's review found the same).
 *
 * Lives in `Drawers`' render, not the body's, because the HEAD needs it too:
 * the lede names the module and the rule takes its arc, and the head is chrome
 * that `drawer.tsx` owns.
 */
export function useResourcesSelection(): ResourcesLoad {
  const { drawer, drawerFilm } = useShellLayout();
  const pathname = usePathname();
  const open = drawer === 'resources';
  const key = resourceKeyFor(pathname);
  const [load, setLoad] = useState<ResourcesLoad>({ status: 'idle' });

  // What the current `load` answers, so an open on the same key is a no-op.
  const answered = useRef<string | null>(null);
  // The request in flight, by IDENTITY rather than by its string: a late
  // answer to an earlier request for the SAME key must be dropped too, or a
  // failure that arrives after the reader has come back to that key shadows
  // the fresh success (`/code-review` round 1). A ticket per request, and only
  // the holder of the current ticket may settle the load.
  const ticket = useRef(0);
  const inFlight = useRef<{ request: string; ticket: number } | null>(null);

  // Same construction as `map-drawer.tsx`: set in the body and cleared in the
  // cleanup, so StrictMode's mount-unmount-mount leaves it true.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const request = drawerFilm ? `${key}?film=${encodeURIComponent(drawerFilm)}` : key;
    if (answered.current === request || inFlight.current?.request === request) return;
    const mine = ++ticket.current;
    inFlight.current = { request, ticket: mine };
    const current = (): boolean => mounted.current && inFlight.current?.ticket === mine;
    // Keep the last good panel on screen while the next one loads; only a
    // first open, or an open after a failure, shows the loading line.
    setLoad((state) => (state.status === 'loaded' ? state : { status: 'loading' }));
    apiClient
      .get<ResourcesSelection>(`${RESOURCES_ENDPOINT}/${request}`)
      .then((selection) => {
        if (!current()) return;
        inFlight.current = null;
        answered.current = request;
        setLoad({ status: 'loaded', selection });
      })
      .catch(() => {
        if (!current()) return;
        inFlight.current = null;
        answered.current = null;
        setLoad({ status: 'failed' });
      });
  }, [open, key, drawerFilm]);

  return load;
}

/**
 * What the head says and what colour it takes, from the load.
 *
 * The lede is the prototype's `'On ' + title + '. This follows whatever you
 * have open in the workspace.'`; until there is a title it is the general line,
 * which is true either way. The tone is the module's arc through `TIER_INKS` —
 * the `-ink` token, never the raw hue, because the same value paints the 12px
 * eyebrow and a raw arc hue fails AA there (the table at `TIER_INKS` has the
 * numbers). A fixed key has no arc and keeps the secondary ink.
 */
export function resourcesHead(load: ResourcesLoad): { lede: string; tone: string } {
  if (load.status !== 'loaded') return { lede: RESOURCES_FALLBACK_LEDE, tone: FALLBACK_TONE };
  const { title, tier } = load.selection;
  return {
    lede: `On ${title}. This follows whatever you have open in the workspace.`,
    tone: (tier && TIER_INKS[tier]) || FALLBACK_TONE,
  };
}

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * The resources drawer's body: her words on whatever is open, two to watch,
 * three to read — the prototype's `renderResources`, over the API.
 *
 * ## What is here, and what is deliberately not
 *
 * The card carries her `quote` and `paragraphs` as the API serves them — every
 * paragraph its own element, never re-flowed into prose, because the source
 * files carry her cadence as data (`content.md`). A film is a card with its
 * title, what it is for, and its length, and it opens its link in a new tab;
 * there is **no thumbnail and no inline player**, because nothing exists to
 * show and where her films will be hosted is not decided (reconciliation ruling
 * 3 on f-resources). A reading is a row that opens its link, or the page the
 * site renders its document on.
 *
 * ## The empty states stay honest
 *
 * Until her list lands (t-76) both lists are empty, and a section with nothing
 * under its eyebrow reads as something that failed to load. So each says which
 * it is, inside the section rather than instead of it.
 *
 * ## When the words are not hers on THIS
 *
 * `wordsAreOwn` is false when the API fell back to her words on the whole. The
 * head still says "On Boundaries", so without a line saying so the card would
 * read as her words on Boundaries — which is the wrong kind of true.
 */
export function ResourcesDrawerBody({ load }: { load: ResourcesLoad }) {
  /*
   * ONE status line, always mounted, whose text changes — never a line that
   * mounts with the state. A live region announces changes to content it
   * already had; one that arrives with its text arrives silently, so a
   * screen-reader user heard neither "Finding…" nor its replacement
   * (`/code-review` round 1). Empty once loaded, and `sr-only` then so it
   * takes no room — `hidden` would take it out of the tree and lose the
   * announcement the same way.
   */
  const status =
    load.status === 'failed'
      ? 'Her resources could not be loaded. Close this and open it again in a moment.'
      : load.status === 'loaded'
        ? ''
        : 'Finding her words on this…';

  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        aria-live="polite"
        className={cn('text-muted-foreground text-sm leading-relaxed', status === '' && 'sr-only')}
      >
        {status}
      </p>
      {load.status === 'loaded' && <ResourcesSelectionBody selection={load.selection} />}
    </div>
  );
}

/** The panel once the selection is here: the card, `to watch`, `to read`. */
function ResourcesSelectionBody({ selection }: { selection: ResourcesSelection }) {
  const { words, wordsAreOwn, films, readings } = selection;
  return (
    <>
      {/* The prototype's `.words`: her voice on the card wash, not on the page. */}
      <figure className="m-0 rounded-[18px] border border-[var(--color-card-border)] bg-[var(--color-card)] px-5 py-[18px]">
        <blockquote className="m-0">
          <p className="brand-quote text-[20px] text-[var(--color-heading)]">{words.quote}</p>
          {words.paragraphs.map((paragraph, index) => (
            <p key={index} className="text-foreground mt-3 text-[14.5px] leading-[1.7]">
              {paragraph}
            </p>
          ))}
        </blockquote>
        {!wordsAreOwn && (
          <figcaption className="text-muted-foreground mt-3 text-[12.5px] leading-[1.55]">
            Nothing of hers is written for this yet — these are her words on the whole.
          </figcaption>
        )}
      </figure>

      <section aria-labelledby="resources-to-watch" className="flex flex-col gap-2.5">
        <Eyebrow as="h3" id="resources-to-watch" className="px-0.5">
          to watch
        </Eyebrow>
        {films.length === 0 ? (
          <p className="text-muted-foreground px-0.5 text-[13px] leading-[1.6]">
            Nothing to watch yet. Her films land here as the programme opens.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
            {films.map((film) => (
              <li key={film.id}>
                {/*
                  The prototype's `.videocard` minus its 16:9 still — a card,
                  not a thumbnail with a caption, because there is no still to
                  show and a stock one is what D6 forbids. The play glyph says
                  what kind of thing it is; the duration says how long.
                */}
                <a
                  href={film.href}
                  {...EXTERNAL}
                  title={`${film.title} · ${film.duration}`}
                  className={cn(
                    'flex items-start gap-3 rounded-[16px] border border-[var(--color-card-border)]',
                    'bg-[var(--color-card)] px-[13px] py-[11px] no-underline hover:no-underline',
                    'transition-[box-shadow,transform] duration-[220ms] ease-[var(--ease-brand)]',
                    'hover:-translate-y-px hover:shadow-[var(--shadow-rest)]',
                    'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                    'focus-visible:outline-[var(--color-ring)]'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full',
                      'bg-[var(--color-pill)] text-[var(--color-secondary-ink)]'
                    )}
                  >
                    <Play size={15} strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-[1.35] font-medium text-[var(--color-heading)]">
                      {film.title}
                    </span>
                    <span className="text-muted-foreground mt-[3px] block text-[12px] leading-[1.5]">
                      {film.subtitle}
                    </span>
                  </span>
                  <span className="text-muted-foreground mt-1 flex-none text-[11.5px] tabular-nums">
                    {film.duration}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="resources-to-read" className="flex flex-col gap-2.5">
        <Eyebrow as="h3" id="resources-to-read" className="px-0.5">
          to read
        </Eyebrow>
        {readings.length === 0 ? (
          <p className="text-muted-foreground px-0.5 text-[13px] leading-[1.6]">
            Nothing to read yet. Her pieces land here as the programme opens.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {readings.map((reading) => {
              const href =
                'href' in reading ? reading.href : (DOCUMENT_PAGES[reading.documentId] ?? null);
              const external = 'href' in reading;
              const rowClass = cn(
                'flex w-full items-start gap-3 rounded-[14px] border border-[var(--color-card-border)]',
                'bg-[var(--color-card)] px-3.5 py-3 text-left no-underline hover:no-underline',
                'transition-[background-color] duration-200 ease-[var(--ease-brand)]',
                'motion-reduce:transition-none'
              );
              const inner = (
                <>
                  <FileText
                    size={16}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="text-muted-foreground mt-[3px] flex-none"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="brand-display block text-[17.5px] text-[var(--color-heading)]">
                      {reading.title}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-[12px] leading-[1.5]">
                      {reading.subtitle}
                    </span>
                  </span>
                  <span className="text-muted-foreground mt-1 flex flex-none items-center gap-1 text-[11.5px]">
                    {reading.readingTime}
                    {external && <ExternalLink size={11} strokeWidth={1.6} aria-hidden="true" />}
                  </span>
                </>
              );
              return (
                <li key={reading.id}>
                  {href ? (
                    <a
                      href={href}
                      {...(external ? EXTERNAL : {})}
                      title={`${reading.title} · ${reading.readingTime}`}
                      className={cn(
                        rowClass,
                        'hover:bg-[var(--color-pill-hover)]',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                        'focus-visible:outline-[var(--color-ring)]'
                      )}
                    >
                      {inner}
                    </a>
                  ) : (
                    // A document the site has no page for: the row says what
                    // it is and goes nowhere, rather than linking to nowhere.
                    <div className={rowClass}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
