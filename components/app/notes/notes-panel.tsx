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

  const read = useCallback(
    (signal?: AbortSignal) => {
      return fetchNotes({ signal, fetchImpl })
        .then((view) => {
          if (signal?.aborted || !mounted.current) return;
          setNotes(view);
          setUnreadable(false);
        })
        .catch((error: unknown) => {
          if (signal?.aborted || !mounted.current) return;
          logger.warn('Her notes could not be read', {
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
   * And again whenever a turn has written. Keyed on the counter alone: the
   * mount effect above already did the first read, and adding `read` to this
   * list would make a re-created `fetchImpl` a phantom turn.
   */
  useEffect(() => {
    if (slotsWritten === 0) return;
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

  if (notes === null && !unreadable) return <Skeleton />;

  return (
    <div className="flex flex-col gap-6">
      {unreadable ? (
        <Banner tone="warning" lead={notes ? 'Not refreshed.' : 'Not readable.'}>
          {notes
            ? 'Her notes are as they were a moment ago — the last read did not get through.'
            : 'Her notes could not be read just now. Nothing has been lost; try again shortly.'}
        </Banner>
      ) : null}

      {notes !== null && view.total === 0 ? (
        /*
          An empty page says what will fill it. "Nothing here" on the one
          surface whose promise is that it shows everything reads as a broken
          feature rather than as a new account.
        */
        <p className="text-muted-foreground max-w-[52ch] text-[14px] leading-[1.7]">
          She has written nothing down yet. As you talk, anything she takes to be worth remembering
          appears here while you are still in the conversation — with where it came from, and how
          sure she is.
        </p>
      ) : null}

      {view.groups.map((group) => (
        <Group key={group.key} title={group.title}>
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
          title="Her own headings"
          note="Nothing she was asked to look for covered these, so she chose the heading herself."
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

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <Eyebrow as="h2" className="block px-1 pb-2">
        {title}
      </Eyebrow>
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
 * `aria-hidden` with a live line beside it: the shapes are decoration, and a
 * screen reader is told in words that the page is loading rather than being
 * read three empty boxes.
 */
function Skeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="sr-only" role="status">
        Reading her notes.
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
