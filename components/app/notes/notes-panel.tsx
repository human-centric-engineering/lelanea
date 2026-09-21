'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { NotesControls } from '@/components/app/notes/notes-controls';
import { NoteRow } from '@/components/app/notes/note-row';
import { NoteCard } from '@/components/app/notes/note-card';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { fetchNotes } from '@/lib/app/slots/notes-client';
import {
  NOTES_DEFAULTS,
  noteHeading,
  notesSearch,
  readNotesParams,
  type NotesParams,
  type NotesQuery,
} from '@/lib/app/slots/notes-query';
import {
  NOTES_OWN_TITLE,
  type Note,
  type NotesLayout,
  type NotesSort,
  type NotesView,
} from '@/lib/app/slots/notes-view';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/**
 * The right-hand half of §3.3's pairing, for the thing §3.19 is about: every
 * reading she holds about the person reading it, with its provenance, and two
 * ways to answer back (f-slots t-73).
 *
 * ## Why it re-reads the whole page rather than patching a row
 *
 * A turn can write several notes, mint a slug the panel has never seen, and
 * supersede a version that is on screen — all in one `done`. Applying that
 * from the stream would mean a second implementation of `getNotes()` in the
 * browser, working from `capability_result` payloads that carry the slug and
 * the version and none of the rest. One `GET` is a few hundred bytes and one
 * query plan, and it cannot disagree with the server about what is held.
 *
 * ## The refresh signal comes down through the shell, not across
 *
 * `slotsWritten` is a counter on `ShellLayoutProvider`, incremented once per
 * turn that wrote (`use-conversation.ts`). The conversation and this panel are
 * SIBLINGS — the provider is their nearest common ancestor, exactly as it is
 * for `modulePlace`. An effect keyed on the counter re-reads, and because the
 * first read is the mount rather than a reaction to the counter, a mount is
 * never counted as a refresh.
 *
 * ## The register: Lelañea by name, and the reader as "you"
 *
 * Owner corrections, 21 September 2026. Nothing on this surface says "she" or
 * "her" where a name would do, and nothing calls the reader "they". The one
 * third-person wording that survives is the taxonomy's own `description`, shown
 * inside a card's disclosure as a quotation of what Lelañea was looking for —
 * see `note-card.tsx`, where both rules and their reasons are set out.
 *
 * ## An in-turn refresh must not blank the page
 *
 * The fetch keeps the notes it already has on screen while it runs, and a
 * refresh that fails leaves them there with a quiet line rather than replacing
 * a full page of someone's record with an error. The loading skeleton belongs
 * to the FIRST read only, which is the one where there is nothing to keep.
 *
 * ## Every control lives in the URL (t-79)
 *
 * The search, the group, the sort and the view are read from the query string
 * and written back to it, with defaults left out — so a filtered page can be
 * linked, and a reload lands where the reader was. **Typing replaces** the
 * current entry after a short pause, because a history entry per keystroke
 * would make Back useless; **picking a group, a sort or a view pushes** one, so
 * Back steps through them.
 *
 * The search, the group and the sort are the server's (`notes-query.ts`); the
 * view is only how this page draws the same response. Switching between cards
 * and a list therefore re-reads nothing — one fetch, two renderings.
 *
 * @see .context/app/slots.md — "Her notes"
 * @see .context/app/conversation.md — "What a turn changes on the other side"
 */
export interface NotesPanelProps {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * The head's copy, exported because THREE things render it: the page, its
 * loading boundary, and nothing else may invent a fourth. Same reasoning as
 * `ACCOUNT_LEDE` — the skeleton's bars have to sit on the lines the content
 * replaces them with, and two hardcoded copies drift the first time one is
 * edited, silently, with nothing failing.
 */
export const NOTES_LEDE =
  'Everything Lelañea holds about you, where each of it came from, and how certain it is.';

export const NOTES_NOTE =
  'These are Lelañea’s readings, not your words back. She can be wrong, and nothing here is fixed: correct one and both versions are kept, or ask Lelañea about it and take it up in the conversation.';

/** How long typing rests before the search is sent and the URL updated. */
export const SEARCH_PAUSE_MS = 300;

export function NotesPanel({ fetchImpl }: NotesPanelProps) {
  const { slotsWritten, setAsk, setPane, setChatSlim, width } = useShellLayout();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    q,
    group,
    sort,
    view: layout,
  } = readNotesParams(new URLSearchParams(searchParams.toString()));

  const [notes, setNotes] = useState<NotesView | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  /** The query the notes on screen answer — behind the URL while a read is out. */
  const [answered, setAnswered] = useState<string | null>(null);
  /**
   * The sort the notes on screen were fetched with — which is not the URL's
   * while a read is out. Drawing a `recent` response as `grouped` splits each
   * heading into several runs (duplicate React keys, the same heading drawn
   * twice), so the page is always drawn in the order it was answered in.
   */
  const [answeredSort, setAnsweredSort] = useState<NotesSort>(NOTES_DEFAULTS.sort);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /*
   * The number of the most recent read this panel has STARTED.
   *
   * Reads are not cancelled and not queued — a correction's re-read and a
   * turn's can be in flight together — so they can answer in either order.
   * Before this, whichever response arrived last was what `setNotes` kept: an
   * older page could land after a newer one and put a note back on screen as
   * it was before the write that changed it, until the next write. Found by
   * `/code-review`, round 1. A response now applies only if nothing started
   * after it did. Sequencing rather than aborting, because an abort would also
   * discard a read that failed for a real reason the reader should be told.
   *
   * t-79 leans on the same guard: a reader who types, pauses and types again
   * starts two reads, and only the second may land.
   */
  const latest = useRef(0);
  const asked = notesSearch({ q, group, sort });
  /** What the URL asks the server for — the search, the group, the sort. */
  const current: NotesQuery = { q: q || undefined, group: group ?? undefined, sort };
  /** The URL as it has committed, view included — see `target` below. */
  const committed = notesSearch({ q, group, sort, view: layout });

  /*
   * The query is an argument, not a closure over the URL. Each caller says
   * what it is reading — and `read` then depends on `fetchImpl` alone, which is
   * what keeps the React Compiler optimising this component: with `q`, `group`
   * and `sort` in this memo's dependencies it could not prove them unmutated
   * once `navigate` stopped reading them, and skipped the whole component.
   */
  const read = useCallback(
    (query: NotesQuery, signal?: AbortSignal) => {
      const mine = ++latest.current;
      const stale = () => signal?.aborted || !mounted.current || mine !== latest.current;
      return fetchNotes({ signal, fetchImpl, query })
        .then((view) => {
          if (stale()) return;
          setNotes(view);
          setAnswered(notesSearch(query));
          setAnsweredSort(query.sort ?? NOTES_DEFAULTS.sort);
          setUnreadable(false);
        })
        .catch((error: unknown) => {
          if (stale()) return;
          logger.warn('Lelañea’s notes could not be read', {
            error: error instanceof Error ? error.message : String(error),
          });
          setUnreadable(true);
        });
    },
    // The setters are stable; they are listed because the React Compiler's
    // inference asks for them here, and a mismatch makes it skip the component.
    [fetchImpl, setNotes, setAnswered, setAnsweredSort, setUnreadable]
  );

  // The first read, on mount — and again whenever the search, the group or the
  // sort changes, since `read` is rebuilt with them. The view is not in `read`,
  // which is what makes a cards/list switch cost nothing.
  useEffect(() => {
    const controller = new AbortController();
    void read(current, controller.signal);
    return () => controller.abort();
    // `current` is rebuilt every render; `asked` is its identity as a string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, asked]);

  /*
   * And again whenever a turn has written — measured against the counter as it
   * stood when THIS panel mounted, not against zero.
   *
   * The provider outlives the panel. Leave `/app/notes` after a turn wrote, and
   * come back: the new panel mounts under a provider whose counter is already
   * above zero, so a `slotsWritten === 0` guard let this fire on mount beside
   * the mount read — two requests for one arrival. Remembering the value at
   * mount makes a mount a mount (`/code-review`, round 1).
   *
   * Keyed on the counter alone: adding `read` would make a re-created
   * `fetchImpl` — or a changed filter — a phantom turn. It calls the CURRENT
   * `read`, so a turn re-reads with whatever filters are on.
   */
  const seenWrites = useRef(slotsWritten);
  useEffect(() => {
    if (slotsWritten === seenWrites.current) return;
    seenWrites.current = slotsWritten;
    void read(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [slotsWritten]);

  /*
   * Where the page has asked the URL to be — which, on this route, runs ahead
   * of where it is.
   *
   * `useSearchParams` moves only when a navigation commits, a server round trip
   * after it is sent, and the reader goes on typing and clicking meanwhile.
   * Three review rounds found the same shape of defect three ways, every one of
   * them a navigation built from the COMMITTED URL while a newer one was still
   * in flight: a late echo reset the box over newer typing and lost keystrokes
   * (round 1); a pending search fired after a group pick and put the old group
   * back (round 2); Clear re-armed the search, which then restored the filter
   * Clear had just removed, and a pick's own echo was taken for a Back (round
   * 3). So every navigation is built from `target` — the last URL asked for —
   * and never from the committed one.
   *
   * `sent` is the queries asked for and not yet seen commit, oldest first. A
   * committed URL found there is our own echo: it, and anything older (the
   * router abandons a navigation a newer one overtakes, so an older echo may
   * never come), are dropped, and nothing else happens. A committed URL NOT
   * there — Back, Forward, a followed link — is the reader going somewhere
   * else, and the page follows it: the box takes its search, `target` resets
   * to it.
   */
  /** The last search asked for, as its query string — parsed where it is used. */
  const target = useRef('');
  const sent = useRef<string[]>([]);
  /** The search waiting out its pause, so a choice made meanwhile can cancel it. */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [draft, setDraft] = useState(q);

  useEffect(() => {
    const echo = sent.current.indexOf(committed);
    if (echo !== -1) {
      sent.current.splice(0, echo + 1);
      return;
    }
    sent.current = [];
    // This is also the mount: the first commit is "somewhere else".
    target.current = committed;
    const moved = readNotesParams(new URLSearchParams(committed)).q;
    // Not trimmed out from under the caret when the words already agree.
    setDraft((current) => (current.trim() === moved ? current : moved));
  }, [committed]);

  /** Move the URL: `push` for a choice Back should undo, `replace` for typing. */
  const navigate = useCallback(
    (next: Partial<NotesParams>, how: 'push' | 'replace') => {
      const base = readNotesParams(new URLSearchParams(target.current));
      const search = notesSearch({ ...base, ...next, q: (next.q ?? base.q).trim() });
      target.current = search;
      sent.current.push(search);
      router[how](`${pathname}${search}`, { scroll: false });
    },
    [router, pathname]
  );

  // The search box's text reaches the URL after a pause, as a `replace`.
  useEffect(() => {
    if (draft.trim() === readNotesParams(new URLSearchParams(target.current)).q) return;
    const timer = setTimeout(() => {
      pending.current = null;
      navigate({ q: draft }, 'replace');
    }, SEARCH_PAUSE_MS);
    pending.current = timer;
    return () => clearTimeout(timer);
  }, [draft, navigate]);

  /**
   * A group, a sort, a view or a Clear — each pushes a history entry, and
   * carries the box's current text, cancelling a search still waiting out its
   * pause rather than letting it land on top afterwards.
   */
  const choose = (next: Partial<NotesParams>) => {
    if (pending.current !== null) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    navigate({ q: draft, ...next }, 'push');
  };

  /**
   * Bring the question to the composer, and bring the composer into view.
   *
   * The two halves are separate on purpose. Handing over the words is the
   * cross-pane channel; making the conversation visible is layout, and which
   * gesture that takes depends on the width — below 900px the panes are a
   * carousel and the conversation is a pane you switch to, at `medium` it is a
   * panel parked off to the side, and above that it is already on screen and
   * neither call does anything.
   */
  const ask = useCallback(
    (text: string) => {
      setAsk(text);
      if (width === 'small') setPane('chat');
      else setChatSlim(false);
    },
    [setAsk, setPane, setChatSlim, width]
  );

  /*
   * Which notes are open as cards, and which are folded to rows.
   *
   * The view sets the default — every note open in `cards`, every note folded
   * in `list` — and a chevron on each note overrides it for that note. The
   * overrides belong to the view they were made in, so switching view starts
   * from that view's default rather than carrying a half-folded page across.
   * Kept here rather than in each note so they survive a re-read: a correction
   * re-reads the page, and the card someone just corrected must not snap shut.
   */
  const [overrides, setOverrides] = useState<{
    layout: NotesLayout;
    open: ReadonlyMap<string, boolean>;
  }>({ layout, open: new Map() });
  /** The note whose chevron was just used — it takes focus in its new shape. */
  const [focused, setFocused] = useState<string | null>(null);
  /*
   * Spent once used. A child's effects run before this one in the same commit,
   * so the note has taken focus by the time this clears the flag. Left set, a
   * note that dropped out of the results and came back — a search narrowed and
   * then widened, or a switch of view — remounted still holding it, and took
   * focus out of the search box mid-keystroke (`/code-review`, round 1).
   */
  useEffect(() => {
    if (focused !== null) setFocused(null);
  }, [focused]);
  const isOpen = (slug: string) =>
    (overrides.layout === layout ? overrides.open.get(slug) : undefined) ?? layout === 'cards';
  const toggle = (slug: string) => {
    const next = new Map(overrides.layout === layout ? overrides.open : []);
    next.set(slug, !isOpen(slug));
    setOverrides({ layout, open: next });
    setFocused(slug);
  };

  /** Search and group back to their defaults; the sort and the view are kept. */
  const clear = () => {
    // `choose` first, so `target` already holds the empty search by the time
    // the emptied box is compared against it — no pause is armed.
    choose({ q: NOTES_DEFAULTS.q, group: NOTES_DEFAULTS.group });
    setDraft(NOTES_DEFAULTS.q);
  };

  if (notes === null && !unreadable) return <NotesSkeleton />;

  const filtering = q !== '' || group !== null;
  // Not busy once a read has failed: the banner already says the page is as it
  // stood, and a page left dimmed and `aria-busy` forever reads as still
  // loading (`/code-review`, round 2).
  const busy = notes !== null && answered !== asked && !unreadable;

  const item = (note: Note) => {
    const heading = answeredSort === 'recent' ? noteHeading(note) : undefined;
    const focus = focused === note.slotSlug;
    return (
      <li key={note.slotSlug}>
        {isOpen(note.slotSlug) ? (
          <NoteCard
            note={note}
            onAsk={ask}
            onCorrected={() => void read(current)}
            fetchImpl={fetchImpl}
            heading={heading}
            onFold={() => toggle(note.slotSlug)}
            focusFold={focus}
          />
        ) : (
          <NoteRow
            note={note}
            heading={heading}
            onOpen={() => toggle(note.slotSlug)}
            focusOnMount={focus}
          />
        )}
      </li>
    );
  };

  return (
    /*
      No width of its own: the page is the column.

      This carried `max-w-[46rem]` when the cards were the only thing being
      held in, which put them on a different axis from the title and the lede
      above them. `View`'s `column` does it for the whole page instead — see
      the prop, which this view is the reason for.
    */
    <div className="flex flex-col gap-6">
      {unreadable ? (
        <Banner tone="warning" lead={notes ? 'Not refreshed.' : 'Not readable.'}>
          {notes
            ? 'This page is as it stood a moment ago — the last read did not get through.'
            : 'Lelañea’s notes could not be read just now. Nothing has been lost; try again shortly.'}
        </Banner>
      ) : null}

      {notes !== null && notes.total === 0 ? (
        /*
          An empty page says what will fill it. "Nothing here" on the one
          surface whose promise is that it shows everything reads as a broken
          feature rather than as a new account.

          And it gets no controls: there is nothing yet to find.
        */
        <p className="text-muted-foreground max-w-[52ch] text-[14px] leading-[1.7]">
          Lelañea has written nothing down yet. As you talk, anything worth remembering appears here
          while you are still in the conversation — with where it came from, and how sure Lelañea is
          of it.
        </p>
      ) : null}

      {notes !== null && notes.total > 0 ? (
        <>
          <NotesControls
            draft={draft}
            onDraft={setDraft}
            group={group}
            onGroup={(next) => choose({ group: next })}
            sort={sort}
            onSort={(next) => choose({ sort: next })}
            layout={layout}
            onLayout={(next) => choose({ view: next })}
            groups={notes.groups}
            own={notes.own}
            total={notes.total}
            matched={notes.matched}
            filtering={filtering}
            onClear={clear}
          />

          <div
            aria-busy={busy}
            className={cn(
              'flex flex-col gap-6 transition-opacity duration-200',
              busy && 'opacity-60'
            )}
          >
            {notes.matched === 0 ? (
              <NoMatches onClear={clear} />
            ) : answeredSort === 'recent' ? (
              <ul className={LIST[layout]}>{notes.notes.map(item)}</ul>
            ) : (
              runsOf(notes.notes).map((run) => (
                <Group
                  key={reactKey(run.key)}
                  title={run.title}
                  count={run.notes.length}
                  note={run.key === OWN_RUN ? OWN_NOTE : undefined}
                  layout={layout}
                >
                  {run.notes.map(item)}
                </Group>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** A card has room around it; rows sit closer, because a list is read down. */
const LIST = {
  cards: 'flex list-none flex-col gap-2.5 p-0',
  list: 'flex list-none flex-col gap-1.5 p-0',
} as const;

/**
 * The run key for Lelañea's own headings. A symbol, so it cannot equal any
 * real group key; `reactKey` turns it into a string only for React.
 */
const OWN_RUN = Symbol('own');

function reactKey(key: string | typeof OWN_RUN): string {
  return key === OWN_RUN ? 'own:' : `group:${key}`;
}

const OWN_NOTE =
  'Things that came up in conversation and add to the picture, though nothing on Lelañea’s own list covered them — so she named them herself.';

/**
 * Consecutive notes under one heading. The server has already put them in
 * heading order (`queryNotes`), so grouping is a single pass that never
 * re-sorts — the order on screen is the server's.
 */
function runsOf(notes: Note[]): { key: string | typeof OWN_RUN; title: string; notes: Note[] }[] {
  const runs: { key: string | typeof OWN_RUN; title: string; notes: Note[] }[] = [];
  for (const note of notes) {
    const key = note.group ?? OWN_RUN;
    const last = runs.at(-1);
    if (last && last.key === key) last.notes.push(note);
    else
      runs.push({
        key,
        title: note.group === null ? NOTES_OWN_TITLE : noteHeading(note),
        notes: [note],
      });
  }
  return runs;
}

/**
 * Nothing matched — which is not the same page as a new account, and does not
 * say the same thing. Someone here has notes; the search found none of them,
 * and the one useful next step is to undo it.
 */
function NoMatches({ onClear }: { onClear: () => void }) {
  const id = useId();
  return (
    <div className="flex flex-col items-start gap-3" aria-labelledby={id}>
      <p id={id} className="text-muted-foreground max-w-[52ch] text-[14px] leading-[1.7]">
        Nothing in Lelañea’s notes matches that. Try fewer words, or look under every heading.
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="border border-[var(--color-border)]"
        onClick={onClear}
      >
        Clear the search
      </Button>
    </div>
  );
}

/**
 * A group of notes under its heading.
 *
 * The heading is an eyebrow, a hairline that runs to the edge, and a count —
 * the editorial rule the design uses to separate sections, and the reason it
 * earns its keep here is the count: it tells a reader at a glance whether
 * "Life areas" is three notes or twenty before they scroll into it. Without
 * the rule the eyebrow floated between two cards and read as a caption on the
 * one below it.
 */
function Group({
  title,
  count,
  note,
  layout,
  children,
}: {
  title: string;
  count: number;
  note?: string;
  layout: keyof typeof LIST;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 px-1 pb-2.5">
        <Eyebrow as="h2">{title}</Eyebrow>
        <span
          aria-hidden="true"
          className="h-px min-w-6 flex-1 translate-y-[-3px] bg-[var(--color-divider)]"
        />
        <span className="text-muted-foreground flex-none text-[11.5px] tabular-nums">{count}</span>
      </div>
      {note ? (
        <p className="text-muted-foreground max-w-[52ch] px-1 pb-2.5 text-[12.5px] leading-[1.6]">
          {note}
        </p>
      ) : null}
      <ul className={LIST[layout]}>{children}</ul>
    </section>
  );
}

/**
 * The first read's placeholder — three card-shaped bars, not a spinner.
 *
 * Exported, because the route's `loading.tsx` renders the SAME component. The
 * page waits on a session read and the panel then waits on a fetch, so a
 * reader crosses two loading states back to back; drawing them from one
 * component is what stops the second from being a visibly different shape
 * arriving where the first was.
 *
 * `aria-hidden` with a live line beside it: the shapes are decoration, and a
 * screen reader is told in words that the page is loading rather than being
 * read three empty boxes.
 */
export function NotesSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="sr-only" role="status">
        Reading Lelañea’s notes.
      </p>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          aria-hidden="true"
          className={cn(
            'bg-card h-[120px] rounded-lg border border-[var(--color-card-border)]',
            'opacity-60 shadow-[var(--shadow-rest)]'
          )}
        />
      ))}
    </div>
  );
}
