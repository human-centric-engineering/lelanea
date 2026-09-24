'use client';

import { ExternalLink, FileText, Headphones, Play } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { TIER_INKS } from '@/components/app/shell/map-drawer';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { apiClient } from '@/lib/api/client';
import type { ResourcesSelection } from '@/lib/app/content/resources';
import type { LucideIcon } from 'lucide-react';
import { MODULES_PATH_PREFIX } from '@/lib/app/journey/paths';
import { cn } from '@/lib/utils';

/** The endpoint the drawer reads, minus the key. One place, so a test can name it. */
export const RESOURCES_ENDPOINT = '/api/v1/app/content/resources';

/** The lede while there is nothing to name yet — true of the panel either way. */
export const RESOURCES_FALLBACK_LEDE = 'Videos, audio and articles, in her own words.';

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
 * Where the site renders each foundational document, for an article that names
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
 * keyed on `key` and the pin, and a change while open re-fetches; the
 * ETag on the route makes the repeat cheap. While it loads the panel says so
 * rather than showing the previous key's words under the new key's route.
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
  const { drawer, drawerPin } = useShellLayout();
  const pathname = usePathname();
  const open = drawer === 'resources';
  const key = resourceKeyFor(pathname);
  const [load, setLoad] = useState<ResourcesLoad>({ status: 'idle' });

  // The last request that was answered, and its answer — so an open on the
  // same key is a no-op, and coming back to it after a detour restores the
  // panel without a round trip.
  const answered = useRef<{ request: string; selection: ResourcesSelection } | null>(null);
  // The pin and the key it was made on. A resource pinned on Values is for
  // Values: the shell clears the pin on navigation, but a child's effect runs
  // before its provider's, so without this the first request after a
  // navigation still carried the old pin (`/code-review` round 2). Keyed on
  // the resource id, and settled BEFORE the open guard below, so a pin never
  // inherits a previous pin's key: a close arrives with the pin cleared, and a
  // new id is a new pin (`/code-review` round 3, proved by a probe).
  const pin = useRef<{ id: string; key: string } | null>(null);
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
    if (drawerPin === null) pin.current = null;
    else if (pin.current?.id !== drawerPin) pin.current = { id: drawerPin, key };
    if (!open) return;
    const pinned = pin.current?.key === key ? pin.current.id : null;
    const request = pinned ? `${key}?pin=${encodeURIComponent(pinned)}` : key;
    if (inFlight.current?.request === request) return;
    if (answered.current?.request === request) {
      // Back on the key already answered — and anything still in flight is
      // for a key the reader has LEFT, so it must not be allowed to land.
      // Without this, values → boundaries → values with Boundaries still
      // loading ended with Boundaries' words under a Values route
      // (`/code-review` round 2, proved by a probe). The answer is restored
      // from here, because the detour had put the loading line up.
      inFlight.current = null;
      ticket.current += 1;
      setLoad({ status: 'loaded', selection: answered.current.selection });
      return;
    }
    const mine = ++ticket.current;
    inFlight.current = { request, ticket: mine };
    const current = (): boolean => mounted.current && inFlight.current?.ticket === mine;
    // ALWAYS the loading line, never the previous key's panel. Keeping the last
    // good selection up while the next one loads read well for a drawer that
    // stays open across a navigation — but a fresh open on a different module
    // then said "On Values" over Boundaries for a whole round trip, with
    // nothing on the panel saying so. Honest and brief beats smooth and wrong;
    // the ETag keeps the trip short.
    setLoad({ status: 'loading' });
    apiClient
      .get<ResourcesSelection>(`${RESOURCES_ENDPOINT}/${request}`)
      .then((selection) => {
        if (!current()) return;
        inFlight.current = null;
        answered.current = { request, selection };
        setLoad({ status: 'loaded', selection });
      })
      .catch(() => {
        if (!current()) return;
        inFlight.current = null;
        answered.current = null;
        setLoad({ status: 'failed' });
      });
  }, [open, key, drawerPin]);

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
 * two to listen to, three to read — the prototype's `renderResources`, over the API.
 *
 * ## What is here, and what is deliberately not
 *
 * The card carries her `quote` and `paragraphs` as the API serves them — every
 * paragraph its own element, never re-flowed into prose, because the source
 * files carry her cadence as data (`content.md`). A video or an audio piece is a card with its
 * title, what it is for, and its length, and it opens its link in a new tab;
 * there is **no thumbnail and no inline player**, because nothing exists to
 * show and where her videos and audio will be hosted is not decided (reconciliation ruling
 * 3 on f-resources). An article is a row that opens its link, or the page the
 * site renders its document on.
 *
 * ## The empty states stay honest
 *
 * Until her list lands (t-76) every list is empty, and a section with nothing
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

/** The panel once the selection is here: the card, `to watch`, `to listen`, `to read`. */
function ResourcesSelectionBody({ selection }: { selection: ResourcesSelection }) {
  const { words, wordsAreOwn, videos, audio, articles } = selection;
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

      <TimedSection
        id="resources-to-watch"
        eyebrow="to watch"
        empty="Nothing to watch yet. Her videos land here as the programme opens."
        items={videos}
        Icon={Play}
      />

      <TimedSection
        id="resources-to-listen"
        eyebrow="to listen"
        empty="Nothing to listen to yet. Her audio lands here as the programme opens."
        items={audio}
        Icon={Headphones}
      />

      <section aria-labelledby="resources-to-read" className="flex flex-col gap-2.5">
        <Eyebrow as="h3" id="resources-to-read" className="px-0.5">
          to read
        </Eyebrow>
        {articles.length === 0 ? (
          <p className="text-muted-foreground px-0.5 text-[13px] leading-[1.6]">
            Nothing to read yet. Her pieces land here as the programme opens.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {articles.map((article) => {
              const href =
                'href' in article ? article.href : (DOCUMENT_PAGES[article.documentId] ?? null);
              const external = 'href' in article;
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
                      {article.title}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-[12px] leading-[1.5]">
                      {article.subtitle}
                    </span>
                  </span>
                  <span className="text-muted-foreground mt-1 flex flex-none items-center gap-1 text-[11.5px]">
                    {article.readingTime}
                    {external && <ExternalLink size={11} strokeWidth={1.6} aria-hidden="true" />}
                  </span>
                </>
              );
              return (
                <li key={article.id}>
                  {href ? (
                    <a
                      href={href}
                      {...(external ? EXTERNAL : {})}
                      title={`${article.title} · ${article.readingTime}`}
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

/**
 * A section of things with a length and a link — the videos, or the audio. One
 * component, because the two are the same shape and differ only in their
 * glyph and what the section is called.
 */
function TimedSection({
  id,
  eyebrow,
  empty,
  items,
  Icon,
}: {
  id: string;
  eyebrow: string;
  empty: string;
  items: ResourcesSelection['videos'];
  Icon: LucideIcon;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <Eyebrow as="h3" id={id} className="px-0.5">
        {eyebrow}
      </Eyebrow>
      {items.length === 0 ? (
        <p className="text-muted-foreground px-0.5 text-[13px] leading-[1.6]">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {items.map((item) => (
            <li key={item.id}>
              {/*
                The prototype's `.videocard` minus its 16:9 still — a card,
                not a thumbnail with a caption, because there is no still to
                show and a stock one is what D6 forbids. The glyph says what
                kind of thing it is; the duration says how long.
              */}
              <a
                href={item.href}
                {...EXTERNAL}
                title={`${item.title} · ${item.duration}`}
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
                  <Icon size={15} strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-[1.35] font-medium text-[var(--color-heading)]">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground mt-[3px] block text-[12px] leading-[1.5]">
                    {item.subtitle}
                  </span>
                </span>
                <span className="text-muted-foreground mt-1 flex-none text-[11.5px] tabular-nums">
                  {item.duration}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
