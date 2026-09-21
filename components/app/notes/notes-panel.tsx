'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { NoteCard } from '@/components/app/notes/note-card';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Banner } from '@/components/app/ui/banner';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { fetchNotes } from '@/lib/app/slots/notes-client';
import type { Note, NotesView } from '@/lib/app/slots/notes-view';
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

const EMPTY: NotesView = { groups: [], improvised: [], total: 0 };

export function NotesPanel({ fetchImpl }: NotesPanelProps) {
  const { slotsWritten, setAsk, setPane, setChatSlim, width } = useShellLayout();
  const [notes, setNotes] = useState<NotesView | null>(null);
  const [unreadable, setUnreadable] = useState(false);
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
   */
  const latest = useRef(0);

  const read = useCallback(
    (signal?: AbortSignal) => {
      const mine = ++latest.current;
      const stale = () => signal?.aborted || !mounted.current || mine !== latest.current;
      return fetchNotes({ signal, fetchImpl })
        .then((view) => {
          if (stale()) return;
          setNotes(view);
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
    [fetchImpl]
  );

  // The first read, on mount.
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);

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
   * `fetchImpl` a phantom turn.
   */
  const seenWrites = useRef(slotsWritten);
  useEffect(() => {
    if (slotsWritten === seenWrites.current) return;
    seenWrites.current = slotsWritten;
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [slotsWritten]);

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

  const view = notes ?? EMPTY;
  const improvised: Note[] = view.improvised;

  if (notes === null && !unreadable) return <NotesSkeleton />;

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

      {notes !== null && view.total === 0 ? (
        /*
          An empty page says what will fill it. "Nothing here" on the one
          surface whose promise is that it shows everything reads as a broken
          feature rather than as a new account.
        */
        <p className="text-muted-foreground max-w-[52ch] text-[14px] leading-[1.7]">
          Lelañea has written nothing down yet. As you talk, anything worth remembering appears here
          while you are still in the conversation — with where it came from, and how sure Lelañea is
          of it.
        </p>
      ) : null}

      {view.groups.map((group) => (
        <Group key={group.key} title={group.title} count={group.notes.length}>
          {group.notes.map((note) => (
            <li key={note.slotSlug}>
              <NoteCard
                note={note}
                onAsk={ask}
                onCorrected={() => void read()}
                fetchImpl={fetchImpl}
              />
            </li>
          ))}
        </Group>
      ))}

      {improvised.length > 0 ? (
        <Group
          title="Lelañea’s own headings"
          count={improvised.length}
          note="Things that came up in conversation and add to the picture, though nothing on Lelañea’s own list covered them — so she named them herself."
        >
          {improvised.map((note) => (
            <li key={note.slotSlug}>
              <NoteCard
                note={note}
                onAsk={ask}
                onCorrected={() => void read()}
                fetchImpl={fetchImpl}
              />
            </li>
          ))}
        </Group>
      ) : null}
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
  children,
}: {
  title: string;
  count: number;
  note?: string;
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
      <ul className="flex list-none flex-col gap-2.5 p-0">{children}</ul>
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
