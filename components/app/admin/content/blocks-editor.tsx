'use client';

/**
 * A document's blocks, edited in place (f-content-seeds t-91).
 *
 * The blocks read as the page renders them — a heading looks like a heading, a
 * list has bullets — and are typed into directly. Each is still one block, so
 * the single-line cadence of the welcome is kept by the keyboard rather than by
 * a form: Enter ends a paragraph and starts the next, Backspace at the start of
 * one joins it to the one before, and Shift+Enter breaks a line inside one.
 *
 * What is not the words — a block's type, heading level and position — is
 * behind the ⋮ beside it.
 *
 * A section is edited as a passage, never block by block. Its name sits once,
 * on a divider above the run of blocks that carry it, and renaming it renames
 * the run. That is not only tidier: a key's blocks must be contiguous
 * (`storedDocumentBlocksSchema`), and a per-block field let one block in the
 * middle of a run be renamed, splitting the section into a shape the save then
 * refused. For the same reason a move that crosses a divider moves the block
 * into the neighbouring section rather than over it. Every edit here keeps a
 * key's blocks contiguous; `namingProblem` refuses the one name that would not. A key a page or email
 * selects by name (`SECTION_READERS`) is marked in use, and says who reads it
 * instead of offering a rename.
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  Lock,
  Pencil,
  Plus,
  SplitSquareVertical,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { sectionKeySchema, type StoredDocumentBlock } from '@/lib/app/content/schemas';

type Block = StoredDocumentBlock;

const BLOCK_TYPES = [
  { type: 'paragraph', label: 'Paragraph' },
  { type: 'heading', label: 'Heading' },
  { type: 'list', label: 'List' },
] as const satisfies readonly { type: Block['type']; label: string }[];

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** Where the caret goes after an edit that replaces the field it was in. */
interface Focus {
  block: number;
  /** The list item, for a list block. */
  item?: number;
  /** Clamped to the field's length, so `Infinity` means "at the end". */
  caret: number;
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

/** A new block is a paragraph in its neighbour's section; retype it after. */
function newParagraph(section: string | null, text = ''): Block {
  return { type: 'paragraph', text, section };
}

function retype(block: Block, type: Block['type']): Block {
  if (block.type === type) return block;
  const text = block.type === 'list' ? block.items.join('\n') : block.text;
  if (type === 'list')
    return { type, style: 'unordered', items: text.split('\n'), section: block.section };
  if (type === 'heading') return { type, text, level: 2, section: block.section };
  return { type, text, section: block.section };
}

// ─── Sections ───────────────────────────────────────────────────────────────

/** The run of blocks that shares block `index`'s section, as `[start, end)`. */
function runOf(blocks: Block[], index: number): [number, number] {
  const section = blocks[index].section;
  let start = index;
  while (start > 0 && blocks[start - 1].section === section) start -= 1;
  let end = index + 1;
  while (end < blocks.length && blocks[end].section === section) end += 1;
  return [start, end];
}

/** `blocks` with every block in `[start, end)` given `section`. */
function withSection(blocks: Block[], start: number, end: number, section: string | null): Block[] {
  return blocks.map((block, at) => (at >= start && at < end ? { ...block, section } : block));
}

/** The first section that resumes after another block, or `null` if none does. */
function resumedSection(blocks: Block[]): string | null {
  const closed = new Set<string>();
  let open: string | null = null;
  for (const block of blocks) {
    if (block.section === open) continue;
    if (open !== null) closed.add(open);
    open = block.section;
    if (open !== null && closed.has(open)) return open;
  }
  return null;
}

/** What a typed name is stored as: "Purpose limits" becomes `purpose_limits`. */
function toSectionKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Why naming `[start, end)` as `key` would not save, or `null` when it would.
 * A name already used next door is allowed — that joins the two into one.
 */
function namingProblem(blocks: Block[], start: number, end: number, key: string): string | null {
  if (!sectionKeySchema.safeParse(key).success) {
    return 'Use lowercase letters, numbers and underscores, starting with a letter.';
  }
  if (resumedSection(withSection(blocks, start, end, key)) === key) {
    return `Another passage in this document is already called "${key}", and a section has to be one unbroken run.`;
  }
  return null;
}

function fieldKey(block: number, item?: number): string {
  return item === undefined ? `${block}` : `${block}:${item}`;
}

// ─── A field that grows with its words ──────────────────────────────────────

function GrowingText({
  value,
  className,
  register,
  ...props
}: Omit<React.ComponentProps<'textarea'>, 'value' | 'ref'> & {
  value: string;
  register: (element: HTMLTextAreaElement | null) => void;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const element = own.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      {...props}
      ref={(element) => {
        own.current = element;
        register(element);
      }}
      rows={1}
      value={value}
      className={cn(
        'placeholder:text-muted-foreground/60 hover:bg-muted/40 focus:bg-muted/40 focus-visible:ring-ring block w-full resize-none overflow-hidden rounded-sm bg-transparent px-2 py-1 outline-none focus-visible:ring-1',
        className
      )}
    />
  );
}

// ─── The editor ─────────────────────────────────────────────────────────────

export function BlocksEditor({
  idPrefix,
  blocks,
  locked,
  onChange,
}: {
  idPrefix: string;
  blocks: Block[];
  /** Section key → the surfaces that select it by name. */
  locked: ReadonlyMap<string, readonly string[]>;
  onChange: (blocks: Block[]) => void;
}) {
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const pending = useRef<Focus | null>(null);

  // After an edit that split, joined or removed a field, put the caret where
  // the writer expects it. Runs after every render; `pending` is only set by
  // `commit`, so an ordinary keystroke leaves focus alone.
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    const element = fields.current.get(fieldKey(target.block, target.item));
    if (!element) return;
    element.focus();
    const caret = Math.min(target.caret, element.value.length);
    element.setSelectionRange(caret, caret);
  });

  const register = (key: string) => (element: HTMLTextAreaElement | null) => {
    if (element) fields.current.set(key, element);
    else fields.current.delete(key);
  };

  const commit = (next: Block[], focus?: Focus) => {
    if (focus) pending.current = focus;
    onChange(next);
  };
  const set = (index: number, block: Block, focus?: Focus) =>
    commit(
      blocks.map((current, at) => (at === index ? block : current)),
      focus
    );
  const move = (index: number, by: -1 | 1) => {
    const block = blocks[index];
    const neighbour = blocks[index + by];
    if (neighbour.section !== block.section) {
      // Across a divider, the first step is into the neighbouring section, in
      // place. Swapping over it instead would leave this block's key on the
      // far side of a run of another, and split its section.
      set(
        index,
        { ...block, section: neighbour.section },
        { block: index, item: block.type === 'list' ? 0 : undefined, caret: 0 }
      );
      return;
    }
    const next = [...blocks];
    const [taken] = next.splice(index, 1);
    next.splice(index + by, 0, taken);
    // Focus follows the block. Rows are keyed by position, so this is also
    // what closes its ⋮: left open, it would now belong to the neighbour.
    commit(next, { block: index + by, item: taken.type === 'list' ? 0 : undefined, caret: 0 });
  };
  const insertAfter = (index: number, block: Block) => {
    const next = [...blocks];
    next.splice(index + 1, 0, block);
    commit(next, { block: index + 1, caret: 0 });
  };
  /** Focus lands at the end of whatever now sits before the removed block. */
  const remove = (index: number) => {
    if (blocks.length === 1) return;
    const before = index > 0 ? blocks[index - 1] : undefined;
    const focus: Focus =
      before === undefined
        ? { block: 0, item: blocks[1].type === 'list' ? 0 : undefined, caret: 0 }
        : {
            block: index - 1,
            item: before.type === 'list' ? before.items.length - 1 : undefined,
            caret: Infinity,
          };
    commit(
      blocks.filter((_, at) => at !== index),
      focus
    );
  };

  /** Enter and Backspace in a paragraph or a heading. */
  const onTextKey = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    index: number,
    block: Exclude<Block, { type: 'list' }>
  ) => {
    if (event.nativeEvent.isComposing) return;
    const { selectionStart, selectionEnd, value } = event.currentTarget;

    if (event.key === 'Enter' && !event.shiftKey) {
      // The words after the caret become the next paragraph, in this section.
      // A heading keeps its first half and hands the rest on as body text.
      event.preventDefault();
      const next = [...blocks];
      next.splice(
        index,
        1,
        { ...block, text: value.slice(0, selectionStart) },
        newParagraph(block.section, value.slice(selectionEnd))
      );
      commit(next, { block: index + 1, caret: 0 });
      return;
    }

    if (event.key !== 'Backspace' || selectionStart !== 0 || selectionEnd !== 0 || index === 0) {
      return;
    }
    if (value === '') {
      event.preventDefault();
      remove(index);
      return;
    }
    // Joined only into a paragraph or heading of the same section: a join
    // across a boundary would silently move words out of the section a page
    // selects them by.
    const before = blocks[index - 1];
    if (before.type === 'list' || before.section !== block.section) return;
    event.preventDefault();
    const next = [...blocks];
    next.splice(index - 1, 2, { ...before, text: before.text + value });
    commit(next, { block: index - 1, caret: before.text.length });
  };

  /** Enter and Backspace in one item of a list. */
  const onItemKey = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    index: number,
    block: Extract<Block, { type: 'list' }>,
    item: number
  ) => {
    if (event.nativeEvent.isComposing) return;
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    const items = block.items;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value === '' && item === items.length - 1) {
        // Enter on an empty last item leaves the list for a new paragraph —
        // or, when the list is only that empty item, turns it into one.
        if (items.length === 1) {
          const next = [...blocks];
          next.splice(index, 1, newParagraph(block.section));
          commit(next, { block: index, caret: 0 });
          return;
        }
        const next = [...blocks];
        next.splice(index, 1, { ...block, items: items.slice(0, -1) }, newParagraph(block.section));
        commit(next, { block: index + 1, caret: 0 });
        return;
      }
      const nextItems = [...items];
      nextItems.splice(item, 1, value.slice(0, selectionStart), value.slice(selectionEnd));
      set(index, { ...block, items: nextItems }, { block: index, item: item + 1, caret: 0 });
      return;
    }

    if (event.key !== 'Backspace' || selectionStart !== 0 || selectionEnd !== 0) return;
    if (item > 0) {
      // Join into the item above.
      event.preventDefault();
      const above = items[item - 1];
      const nextItems = [...items];
      nextItems.splice(item - 1, 2, above + value);
      set(
        index,
        { ...block, items: nextItems },
        { block: index, item: item - 1, caret: above.length }
      );
      return;
    }
    if (items.length === 1 && value === '') {
      event.preventDefault();
      if (index > 0) remove(index);
      else commit([newParagraph(block.section), ...blocks.slice(1)], { block: 0, caret: 0 });
    }
  };

  const sectioned = blocks.some((block) => block.section !== null);
  // The end of each run, keyed by the block that opens it.
  const runEnds = new Map<number, number>();
  blocks.forEach((block, index) => {
    if (index === 0 || blocks[index - 1].section !== block.section) {
      runEnds.set(index, runOf(blocks, index)[1]);
    }
  });

  return (
    <ol className="space-y-1">
      {blocks.map((block, index) => {
        const number = index + 1;
        const runEnd = runEnds.get(index);

        return (
          <li key={index} aria-label={`Block ${number}`} className="group">
            {sectioned && runEnd !== undefined && (
              <SectionDivider
                idPrefix={idPrefix}
                blocks={blocks}
                start={index}
                end={runEnd}
                readers={block.section === null ? undefined : locked.get(block.section)}
                onName={(section) => commit(withSection(blocks, index, runEnd, section))}
              />
            )}

            <div className={cn('flex gap-1', block.type === 'heading' && index > 0 && 'pt-3')}>
              <BlockOptions
                idPrefix={idPrefix}
                number={number}
                block={block}
                count={blocks.length}
                onRetype={(type) => set(index, retype(block, type))}
                onLevel={(level) => block.type === 'heading' && set(index, { ...block, level })}
                startSection={(section) => {
                  const [, end] = runOf(blocks, index);
                  commit(withSection(blocks, index, end, section));
                }}
                namingProblem={(key) => namingProblem(blocks, index, runOf(blocks, index)[1], key)}
                onMove={(by) => move(index, by)}
                onAddBelow={() => insertAfter(index, newParagraph(block.section))}
                onRemove={() => remove(index)}
              />

              <div className="min-w-0 flex-1">
                {block.type === 'list' ? (
                  <ul className="list-disc space-y-0.5 pl-6 leading-relaxed">
                    {block.items.map((text, item) => (
                      <li key={item} className="pl-0">
                        <GrowingText
                          register={register(fieldKey(index, item))}
                          aria-label={`Block ${number} item ${item + 1}`}
                          placeholder="List item"
                          value={text}
                          onChange={(event) =>
                            set(index, {
                              ...block,
                              items: block.items.map((current, at) =>
                                at === item ? event.target.value : current
                              ),
                            })
                          }
                          onKeyDown={(event) => onItemKey(event, index, block, item)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex items-baseline">
                    {block.type === 'heading' && block.number !== undefined && (
                      <span className="text-muted-foreground pl-2 text-lg font-semibold tabular-nums">
                        {block.number}.
                      </span>
                    )}
                    <GrowingText
                      register={register(fieldKey(index))}
                      aria-label={`Block ${number} text`}
                      placeholder={block.type === 'heading' ? 'Heading' : 'Write a paragraph'}
                      value={block.text}
                      className={cn(
                        block.type === 'heading'
                          ? cn('font-semibold', block.level <= 2 ? 'text-xl' : 'text-lg')
                          : 'leading-relaxed'
                      )}
                      onChange={(event) => set(index, { ...block, text: event.target.value })}
                      onKeyDown={(event) => onTextKey(event, index, block)}
                    />
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── A section's divider ────────────────────────────────────────────────────

function SectionDivider({
  idPrefix,
  blocks,
  start,
  end,
  readers,
  onName,
}: {
  idPrefix: string;
  blocks: Block[];
  start: number;
  end: number;
  /** Who selects this section by name, when something does. */
  readers: readonly string[] | undefined;
  onName: (section: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const section = blocks[start].section;
  const count = end - start;
  const blocksWord = count === 1 ? 'block' : `${count} blocks`;

  return (
    <div
      className={cn(
        'text-muted-foreground flex flex-wrap items-center gap-2 pb-1 pl-9 text-xs',
        start > 0 && 'pt-5'
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              section === null
                ? `Name the passage at block ${start + 1}`
                : readers
                  ? `About section ${section}`
                  : `Rename section ${section}`
            }
            className="hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-mono outline-none focus-visible:ring-1"
          >
            {section ?? 'no section'}
            {!readers && <Pencil className="h-3 w-3" aria-hidden />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2 p-3 text-xs">
          {readers ? (
            <>
              <p>
                <code>{section}</code> is shown by name on {readers.join(', ')}.
              </p>
              <p className="text-muted-foreground">
                You can change its words, and add, move or remove blocks inside it. It can’t be
                renamed or emptied here, because {readers.length === 1 ? 'that' : 'those'} would
                stop working: renaming it needs a code change too.
              </p>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">
                {section === null
                  ? `This ${blocksWord} ${count === 1 ? 'is' : 'are'} in no section. Name ${count === 1 ? 'it' : 'them'} to make a passage a page can ask for by name.`
                  : `Renames the section for the ${blocksWord} in it. Nothing asks for “${section}” by name, so it is free to change.`}
              </p>
              <SectionNameForm
                id={`${idPrefix}-section-${start}`}
                initial={section ?? ''}
                action={section === null ? 'Name it' : 'Rename'}
                problem={(key) => namingProblem(blocks, start, end, key)}
                onApply={(key) => {
                  onName(key);
                  setOpen(false);
                }}
              />
              {section !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-mx-2"
                  onClick={() => {
                    onName(null);
                    setOpen(false);
                  }}
                >
                  Remove the name
                </Button>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
      {readers && (
        <Badge variant="outline" title="A page or email selects this section by name">
          <Lock className="mr-1 h-3 w-3" aria-hidden />
          in use
        </Badge>
      )}
      <span className="bg-border h-px min-w-8 flex-1" aria-hidden />
    </div>
  );
}

/**
 * A section name, typed. Not a `<form>`: the popover portals out of the DOM
 * but not out of React's tree, so a submit here would bubble to the document
 * editor around it.
 */
function SectionNameForm({
  id,
  initial,
  action,
  problem,
  onApply,
}: {
  id: string;
  initial: string;
  action: string;
  problem: (key: string) => string | null;
  onApply: (key: string) => void;
}) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement | null>(null);
  // Opened to be typed into, whether by its popover or by "Start a new section".
  useEffect(() => input.current?.focus(), []);
  const key = toSectionKey(name);
  const unchanged = key === initial;
  const error = key === '' || unchanged ? null : problem(key);
  const ready = key !== '' && !unchanged && error === null;
  const apply = () => {
    if (ready) onApply(key);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs">
        Section name
      </Label>
      <Input
        id={id}
        ref={input}
        placeholder="e.g. purpose_limits"
        className="h-8 font-mono text-xs"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
        }}
      />
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : (
        key !== '' &&
        key !== name && (
          <p className="text-muted-foreground">
            Saved as <code>{key}</code>
          </p>
        )
      )}
      <Button type="button" size="sm" disabled={!ready} onClick={apply}>
        {action}
      </Button>
    </div>
  );
}

// ─── A block's ⋮ ────────────────────────────────────────────────────────────

function BlockOptions({
  idPrefix,
  number,
  block,
  count,
  onRetype,
  onLevel,
  startSection,
  namingProblem: problem,
  onMove,
  onAddBelow,
  onRemove,
}: {
  idPrefix: string;
  number: number;
  block: Block;
  count: number;
  onRetype: (type: Block['type']) => void;
  onLevel: (level: number) => void;
  startSection: (section: string) => void;
  namingProblem: (key: string) => string | null;
  onMove: (by: -1 | 1) => void;
  onAddBelow: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setStarting(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Block ${number} options`}
          title="Type, section, move or remove"
          className="text-muted-foreground mt-0.5 h-7 w-7 shrink-0 p-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <EllipsisVertical className="h-4 w-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="left" className="w-64 space-y-3 p-3">
        <div role="group" aria-label={`Block ${number} type`} className="flex gap-1">
          {BLOCK_TYPES.map(({ type, label }) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={block.type === type ? 'secondary' : 'ghost'}
              aria-pressed={block.type === type}
              onClick={() => onRetype(type)}
            >
              {label}
            </Button>
          ))}
        </div>

        {block.type === 'heading' && (
          <div role="group" aria-label={`Block ${number} heading level`} className="flex gap-1">
            {HEADING_LEVELS.map((level) => (
              <Button
                key={level}
                type="button"
                size="sm"
                className="h-7 w-8 p-0"
                variant={block.level === level ? 'secondary' : 'ghost'}
                aria-pressed={block.level === level}
                aria-label={`Level ${level}`}
                onClick={() => onLevel(level)}
              >
                H{level}
              </Button>
            ))}
          </div>
        )}

        <div className="space-y-2 border-t pt-2">
          <p className="text-muted-foreground text-xs">
            Section: <code className="text-foreground">{block.section ?? 'none'}</code>
          </p>
          {starting ? (
            <SectionNameForm
              id={`${idPrefix}-block-${number}-new-section`}
              initial=""
              action="Start section"
              problem={problem}
              onApply={(key) => {
                startSection(key);
                setOpen(false);
                setStarting(false);
              }}
            />
          ) : (
            <MenuButton icon={SplitSquareVertical} onClick={() => setStarting(true)}>
              Start a new section here
            </MenuButton>
          )}
        </div>

        <div className="-mx-1 flex flex-col">
          <MenuButton icon={ArrowUp} disabled={number === 1} onClick={() => onMove(-1)}>
            Move up
          </MenuButton>
          <MenuButton icon={ArrowDown} disabled={number === count} onClick={() => onMove(1)}>
            Move down
          </MenuButton>
          <MenuButton icon={Plus} onClick={onAddBelow}>
            Add a block below
          </MenuButton>
          <MenuButton icon={Trash2} disabled={count === 1} onClick={onRemove}>
            Remove this block
          </MenuButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({
  icon: Icon,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'type' | 'variant' | 'size'> & {
  icon: typeof ArrowUp;
}) {
  return (
    <Button {...props} type="button" variant="ghost" size="sm" className="justify-start gap-2">
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </Button>
  );
}
