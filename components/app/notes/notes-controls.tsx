'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useId } from 'react';

import { Chip } from '@/components/app/ui/chip';
import {
  NOTES_LAYOUTS,
  NOTES_OWN_GROUP,
  NOTES_OWN_TITLE,
  NOTES_SEARCH_MAX,
  NOTES_SORTS,
  noteGroupTitle,
  type NoteGroupCount,
  type NotesLayout,
  type NotesSort,
} from '@/lib/app/slots/notes-view';
import { cn } from '@/lib/utils';

/**
 * The search, the group, the sort and the view — what turns a page you glance
 * at into one you can go looking in (f-slots t-79).
 *
 * ## Compact on purpose
 *
 * The page's point is the reading, and on a narrow workspace pane every row of
 * chrome above it is a row of reading pushed below the fold. So the controls
 * are two lines at most: the search, and then the rest wrapped beside each
 * other. The group and the sort are native selects rather than chip rows —
 * five groups as chips wrap to three lines at 320px, and a select is one pill
 * at any width, with the platform's own picker on a phone.
 *
 * ## The options are the groups in use, counted before narrowing
 *
 * `groups` and `own` come from the server's counts of the whole record, so an
 * option does not vanish because the current search found nothing in it. A
 * group with no notes at all is never offered — nor, therefore, is a hidden
 * one, which never reaches this page. A `group` in the URL that is not among
 * them (a stale link, or one typed by hand) is still shown as chosen, with a
 * count of nothing, rather than the select silently claiming "Every heading"
 * while the page shows nothing.
 *
 * Everything here is controlled: the panel owns the URL and hands values down.
 */
export interface NotesControlsProps {
  /** The search box's text — ahead of the URL by up to one pause. */
  draft: string;
  onDraft: (text: string) => void;
  group: string | null;
  onGroup: (group: string | null) => void;
  sort: NotesSort;
  onSort: (sort: NotesSort) => void;
  layout: NotesLayout;
  onLayout: (layout: NotesLayout) => void;
  groups: NoteGroupCount[];
  own: number;
  total: number;
  matched: number;
  /** A search or a group is on — the count reads "n of m", and Clear is offered. */
  filtering: boolean;
  onClear: () => void;
}

/** The chip's focus treatment, for the two controls here that are not chips. */
const FOCUS =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--color-ring)]';

const FIELD = cn(
  'bg-card rounded-full border border-[var(--color-border)] text-[13px] text-[var(--color-heading)]',
  'outline-none',
  FOCUS
);

const SORT_WORDS: Record<NotesSort, string> = {
  grouped: 'By heading',
  recent: 'Most recent first',
};

const LAYOUT_WORDS: Record<NotesLayout, string> = { cards: 'Cards', list: 'List' };

function countOf(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`;
}

export function NotesControls(props: NotesControlsProps) {
  const searchId = useId();
  const { group, groups, own } = props;
  const offered = new Set([...groups.map((g) => g.key), ...(own > 0 ? [NOTES_OWN_GROUP] : [])]);
  const stray = group !== null && !offered.has(group) ? group : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div role="search" className="flex flex-col gap-2">
        <label htmlFor={searchId} className="sr-only">
          Search Lelañea’s notes
        </label>
        <div className="relative">
          <Search
            size={15}
            strokeWidth={1.8}
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
          />
          <input
            id={searchId}
            type="search"
            value={props.draft}
            maxLength={NOTES_SEARCH_MAX}
            autoComplete="off"
            placeholder="Search what Lelañea has noted"
            onChange={(event) => props.onDraft(event.currentTarget.value)}
            className={cn(FIELD, 'placeholder:text-muted-foreground w-full py-2 pr-4 pl-9')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Picker
            label="Show notes under"
            value={group ?? ''}
            onChange={(value) => props.onGroup(value === '' ? null : value)}
          >
            <option value="">Every heading · {props.total}</option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.title} · {g.count}
              </option>
            ))}
            {own > 0 ? (
              <option value={NOTES_OWN_GROUP}>
                {NOTES_OWN_TITLE} · {own}
              </option>
            ) : null}
            {stray ? (
              <option value={stray}>
                {stray === NOTES_OWN_GROUP ? NOTES_OWN_TITLE : noteGroupTitle(stray)} · 0
              </option>
            ) : null}
          </Picker>

          <Picker
            label="Order"
            value={props.sort}
            onChange={(value) =>
              props.onSort(NOTES_SORTS.find((sort) => sort === value) ?? 'grouped')
            }
          >
            {NOTES_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_WORDS[sort]}
              </option>
            ))}
          </Picker>

          <div role="group" aria-label="Show as" className="ml-auto flex gap-1.5">
            {NOTES_LAYOUTS.map((layout) => (
              <Chip
                key={layout}
                selected={props.layout === layout}
                onClick={() => props.onLayout(layout)}
                className="px-3 py-[7px] text-[12.5px]"
              >
                {LAYOUT_WORDS[layout]}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-baseline gap-3 px-1 text-[12.5px] leading-[1.5]">
        {/*
          A live count, so a screen-reader user hears what a search did without
          leaving the box. It says "of", never a bare number, while anything is
          narrowing — "3 notes" alone would read as everything held.
        */}
        <p role="status" className="text-muted-foreground tabular-nums">
          {props.filtering ? `${props.matched} of ${countOf(props.total)}` : countOf(props.total)}
        </p>
        {props.filtering ? (
          <button
            type="button"
            onClick={props.onClear}
            className={cn(
              'rounded-sm text-[var(--color-heading)] underline underline-offset-[3px]',
              FOCUS
            )}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A native select drawn as a pill. Native, for the platform's own picker on a
 * phone and for the keyboard behaviour nobody has to rebuild; `appearance-none`
 * so the pill matches the chips beside it, with our own chevron in its place.
 */
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
        className={cn(
          FIELD,
          'max-w-full cursor-pointer appearance-none truncate py-[7px] pr-8 pl-3.5'
        )}
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
