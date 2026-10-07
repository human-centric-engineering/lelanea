'use client';

import { ChevronDown, Download, PenLine, Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { FOCUS } from '@/components/app/journey/fields';
import { JourneyStop, NextStop } from '@/components/app/journey/journey-stop';
import { OwnEntryForm } from '@/components/app/journey/own-entry-form';
import { OUTCOME_WORDS } from '@/components/app/journey/synopsis-editor';
import { useJourneyAction } from '@/components/app/journey/use-journey-action';
import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { JOURNEY_RECORD_EXPORT, writeOwnEntry } from '@/lib/app/journey-record/client';
import { JOURNEY_OUTCOME_KINDS, type JourneyEntryKind } from '@/lib/app/journey-record/entry';
import {
  JOURNEY_SEARCH_MAX,
  type JourneyRecordPage,
  type JourneyRecordQuery,
} from '@/lib/app/journey-record/query';
import type { JourneySignpost } from '@/lib/app/journey/next';
import { cn } from '@/lib/utils';

/** The head's lede, exported so the page and anything that draws its skeleton say the same. */
export const JOURNEY_LEDE =
  'What was actually discussed, which modules were worked, and what came out of them.';

/** How long typing rests before the search is sent, as on the notes page. */
export const SEARCH_PAUSE_MS = 300;

/** The id the signpost is held open under. Never an entry id, which is a cuid. */
const NEXT_STOP = 'next';

const KIND_WORDS: Record<JourneyEntryKind, string> = {
  synopsis: 'Accounts of sessions',
  own: 'Your own entries',
};

const PICKER = cn(
  'bg-card rounded-full border border-[var(--color-border)] text-[13px] text-[var(--color-heading)]',
  'max-w-full cursor-pointer appearance-none truncate py-[7px] pr-8 pl-3.5 outline-none',
  FOCUS
);

function Picker({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative inline-flex max-w-full">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={PICKER}
      >
        {children}
      </select>
      <ChevronDown
        size={13}
        strokeWidth={1.8}
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
      />
    </label>
  );
}

/** The query as the page's URL, defaults left out. */
export function journeySearch(query: JourneyRecordQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.module) params.set('module', query.module);
  if (query.outcome) params.set('outcome', query.outcome);
  if (query.kind) params.set('kind', query.kind);
  const search = params.toString();
  return search ? `?${search}` : '';
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-[9px] rounded-[13px] border border-[var(--color-card-border)] bg-[var(--color-background)] px-[13px] py-[11px]">
      <b className="text-[21px] font-medium text-[var(--color-heading)] tabular-nums">{value}</b>
      <span className="text-muted-foreground text-[12.5px]">{label}</span>
    </div>
  );
}

/** Write something into the journey yourself. */
function Composer() {
  const action = useJourneyAction();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <PenLine size={14} strokeWidth={1.8} aria-hidden="true" className="mr-1.5" />
          Write an entry
        </Button>
      </div>
    );
  }
  return (
    <section
      aria-label="Write an entry"
      className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-popover)] p-4"
    >
      <OwnEntryForm
        busy={action.busy}
        submitLabel="Keep this entry"
        onCancel={() => setOpen(false)}
        onSubmit={(words) =>
          void action.run(() => writeOwnEntry(words)).then((went) => went && setOpen(false))
        }
      />
      {action.error ? (
        <Banner tone="error" className="mt-3" role="alert">
          {action.error}
        </Banner>
      ) : null}
    </section>
  );
}

interface StopsProps {
  record: JourneyRecordPage;
  next: JourneySignpost | null;
  moduleLabels: Readonly<Record<string, string>>;
}

/**
 * The thread itself. One stop open at a time: the newest starts open, opening
 * another closes it, and opening the open one shuts it. Keyed on the query by
 * its parent, so a new search opens the newest of what it found.
 */
function Stops({ record, next, moduleLabels }: StopsProps) {
  const [open, setOpen] = useState<string | null>(
    () => record.entries[0]?.id ?? (next ? NEXT_STOP : null)
  );
  const toggle = (id: string) => setOpen((current) => (current === id ? null : id));
  const last = record.entries.length - 1;

  return (
    <ol className="relative pl-[30px]" aria-label="Your journey, newest first">
      {record.entries.map((entry, index) => (
        <JourneyStop
          key={entry.id}
          entry={entry}
          notes={record.notes}
          moduleLabels={moduleLabels}
          thread={index < last ? 'solid' : next ? 'dashed' : 'none'}
          open={open === entry.id}
          onToggle={() => toggle(entry.id)}
        />
      ))}
      {next ? (
        <NextStop next={next} open={open === NEXT_STOP} onToggle={() => toggle(NEXT_STOP)} />
      ) : null}
    </ol>
  );
}

export interface JourneyTimelineProps {
  record: JourneyRecordPage;
  /** What the page was asked for: the URL's search and filters. */
  query: JourneyRecordQuery;
  next: JourneySignpost | null;
  /** `onboarding` → `00 · Onboarding`, from the map. A slug missing here is shown in words. */
  moduleLabels: Readonly<Record<string, string>>;
}

/**
 * The journey record, as a timeline (f-journey-record t-148; §3.16; the
 * prototype's `renderJourney`).
 *
 * Newest first, one stop open at a time, with a dashed "What's next" pinned
 * last and never counted. A waiting draft is its session's own stop, with
 * keep, change, ask-for-another and discard. The person's own entries sit in
 * the same thread.
 *
 * ## The URL holds the search and filters
 *
 * The server page reads them, so the record arrives already narrowed and the
 * totals stay whole. Typing replaces the URL after a pause; a picker pushes,
 * so Back steps through them (the notes page's rule).
 *
 * ## No "module closed"
 *
 * The prototype's stat does not carry over: sessions close, modules do not
 * (§6.12).
 */
export function JourneyTimeline({ record, query, next, moduleLabels }: JourneyTimelineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchId = useId();
  const [typed, setTyped] = useState(query.q ?? '');
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pause.current) clearTimeout(pause.current);
    },
    []
  );

  const go = (change: Partial<JourneyRecordQuery>, how: 'push' | 'replace') => {
    const target = `${pathname}${journeySearch({ ...query, ...change })}`;
    if (how === 'push') router.push(target, { scroll: false });
    else router.replace(target, { scroll: false });
  };

  const onType = (text: string) => {
    setTyped(text);
    if (pause.current) clearTimeout(pause.current);
    pause.current = setTimeout(
      () => go({ q: text.trim() || undefined }, 'replace'),
      SEARCH_PAUSE_MS
    );
  };

  const filtering =
    query.q !== undefined ||
    query.module !== undefined ||
    query.outcome !== undefined ||
    query.kind !== undefined;
  const clear = () => {
    if (pause.current) clearTimeout(pause.current);
    setTyped('');
    router.push(pathname, { scroll: false });
  };

  const empty = record.total === 0 && record.drafts === 0;
  const { totals } = record;

  return (
    <div className="flex flex-col gap-[18px]">
      {empty ? null : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
          <Stat value={totals.synopses} label="sessions kept" />
          <Stat value={totals.own} label="of your own" />
          <Stat value={totals.outcomes.action} label="actions" />
          <Stat value={totals.outcomes.insight} label="insights" />
          <Stat value={totals.outcomes.tension} label="tensions open" />
        </div>
      )}

      {record.drafts > 0 && !filtering ? (
        <Banner tone="info" lead="Waiting for you.">
          Lelañea has written an account of a session. Open it to keep it, change it, ask for
          another or discard it. It is not in your journey until you do.
        </Banner>
      ) : null}

      <Composer />

      {empty ? null : (
        <div className="flex flex-col gap-2">
          <div role="search" className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search your journey
            </label>
            <Search
              size={15}
              strokeWidth={1.8}
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
            />
            <input
              id={searchId}
              type="search"
              value={typed}
              maxLength={JOURNEY_SEARCH_MAX}
              autoComplete="off"
              placeholder="Search your journey"
              onChange={(event) => onType(event.currentTarget.value)}
              className={cn(
                'bg-card w-full rounded-full border border-[var(--color-border)] py-2 pr-4 pl-9',
                'placeholder:text-muted-foreground text-[13px] text-[var(--color-heading)] outline-none',
                FOCUS
              )}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Picker
              label="Show entries about a module"
              value={query.module ?? ''}
              onChange={(value) => go({ module: value || undefined }, 'push')}
            >
              <option value="">Every module</option>
              {record.modules.map((slug) => (
                <option key={slug} value={slug}>
                  {moduleLabels[slug] ?? slug.replace(/[_-]/g, ' ')}
                </option>
              ))}
            </Picker>
            <Picker
              label="Show entries with an outcome of this kind"
              value={query.outcome ?? ''}
              onChange={(value) =>
                go({ outcome: JOURNEY_OUTCOME_KINDS.find((kind) => kind === value) }, 'push')
              }
            >
              <option value="">Every outcome</option>
              {JOURNEY_OUTCOME_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {OUTCOME_WORDS[kind]}s
                </option>
              ))}
            </Picker>
            <Picker
              label="Show entries of this kind"
              value={query.kind ?? ''}
              onChange={(value) =>
                go({ kind: value === 'synopsis' || value === 'own' ? value : undefined }, 'push')
              }
            >
              <option value="">Everything</option>
              <option value="synopsis">{KIND_WORDS.synopsis}</option>
              <option value="own">{KIND_WORDS.own}</option>
            </Picker>
            <a
              href={JOURNEY_RECORD_EXPORT}
              download
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-[var(--color-heading)] underline underline-offset-[3px]',
                FOCUS
              )}
            >
              <Download size={14} strokeWidth={1.8} aria-hidden="true" />
              Export
            </a>
          </div>
          {filtering ? (
            <div className="flex items-baseline gap-3 px-1 text-[12.5px]">
              <p role="status" className="text-muted-foreground tabular-nums">
                {record.matched === 1 ? '1 entry found' : `${record.matched} entries found`}
              </p>
              <button
                type="button"
                onClick={clear}
                className={cn(
                  'rounded-sm text-[var(--color-heading)] underline underline-offset-[3px]',
                  FOCUS
                )}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      )}

      {empty ? (
        <section className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-popover)] p-5">
          <h2 className="font-serif text-[19px] text-[var(--color-heading)]">
            Nothing is recorded here yet
          </h2>
          <p className="text-muted-foreground mt-2 text-[14px] leading-[1.65]">
            After a conversation of substance, Lelañea writes an account of what was discussed and
            leaves it here for you to keep, change or discard. Nothing goes into your journey
            without you seeing it first. You can also write here yourself, whenever you want to.
          </p>
        </section>
      ) : record.entries.length === 0 ? (
        <p className="text-muted-foreground px-1 text-[14px]">
          Nothing in your journey matches that.
        </p>
      ) : null}

      {record.entries.length > 0 || (next && !filtering) ? (
        <Stops
          key={journeySearch(query)}
          record={record}
          next={filtering ? null : next}
          moduleLabels={moduleLabels}
        />
      ) : null}

      {empty ? null : (
        <p className="text-muted-foreground text-[12.5px] leading-[1.6]">
          Nothing on this page was concluded for you. Each account is Lelañea’s until you keep it,
          and you can change or remove anything here.
        </p>
      )}
    </div>
  );
}
