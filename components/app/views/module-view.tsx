import { ModuleActions } from '@/components/app/views/module-actions';
import { View } from '@/components/app/views/view';
import { Card } from '@/components/app/ui/card';
import { cn } from '@/lib/utils';

/** One named part of a module — Values has three; every other module has the unnamed pair. */
export interface ModulePart {
  id: string;
  label: string;
  /** The one line under the tab, said honestly: what it is, or that it is not written. */
  summary: string;
}

export interface ModuleViewProps {
  /** `00` … `16`, as authored. */
  displayNumber: string;
  title: string;
  /** The tier's authored label — `Inner Authority`. */
  tierLabel: string;
  /** The tier's authored intent: the one thing that is written. */
  tierIntent: string;
  parts: readonly ModulePart[];
}

/**
 * The two parts every module that is not written gets.
 *
 * The prototype's `PLAIN_TABS`, with its reason kept: "naming them would be
 * inventing the module." Values is the one module with authored phase tiers,
 * and the page passes those instead.
 */
export const UNWRITTEN_PARTS: readonly ModulePart[] = [
  { id: 'part-1', label: 'Part 1', summary: 'The first part of the module. Not written yet.' },
  { id: 'part-2', label: 'Part 2', summary: 'The second part of the module. Not written yet.' },
];

/**
 * A module's page: a real place with an empty interior.
 *
 * The prototype's `renderModule`, less the per-user state it invents (a step
 * counter, a `now` tab, a footer status). What is real is the shape — where the
 * module sits in the arc, what it is for, and how you get to it and back — and
 * everything that would need content or a journey is the placeholder card
 * saying so. The eyebrow is `tier · module NN`, the title the authored name,
 * and the one panel with words in it carries the tier's intent, because that
 * is the one thing that IS written.
 *
 * ## The parts are tabs in shape only
 *
 * The prototype's `.wtabs` switch a per-user tab. Here nothing is behind any
 * tab, so a `tablist` with `aria-selected` would be a control that controls
 * nothing. They render as a static list of named parts with the honest line
 * under each — the shape a reader will recognise when the parts arrive, without
 * claiming an interaction that does not exist.
 *
 * ## The placeholder is the kit's card, in the prototype's dress
 *
 * Same reasons as `PlaceholderCard` (dashed border, plain border colour, page
 * ground), and the same pinned-class caveat: `tailwind-merge` decides which of
 * two classes in a group survives. The tag, the serif title and the skeleton
 * rows are the prototype's `.placeholder` — the skeleton is decorative and
 * `aria-hidden`, because three grey bars are not content.
 */
export function ModuleView({
  displayNumber,
  title,
  tierLabel,
  tierIntent,
  parts,
}: ModuleViewProps) {
  return (
    <View eyebrow={`${tierLabel.toLowerCase()} · module ${displayNumber}`} title={title}>
      <ul aria-label="Parts of this module" className="m-0 flex list-none flex-wrap gap-1 p-0">
        {parts.map((part) => (
          <li
            key={part.id}
            title={part.summary}
            className={cn(
              'text-muted-foreground inline-flex h-[34px] items-center gap-2 rounded-t-[11px]',
              'border border-b-0 border-transparent px-3.5 text-[13.5px] whitespace-nowrap'
            )}
          >
            <i
              aria-hidden="true"
              className="h-[7px] w-[7px] flex-none rounded-full border-[1.5px] border-[var(--color-border)]"
            />
            {part.label}
          </li>
        ))}
      </ul>

      <div
        className={cn(
          'flex max-w-[52rem] flex-col gap-4 rounded-[20px] border border-dashed',
          'bg-background border-[var(--color-border)] px-6 py-[26px] shadow-[var(--shadow-rest)]'
        )}
      >
        <span
          className={cn(
            'text-muted-foreground inline-flex h-6 items-center self-start rounded-full',
            'border border-[var(--color-border)] px-[11px] text-[11px] tracking-[0.12em]'
          )}
        >
          module placeholder
        </span>
        <p className="brand-display text-[24px] leading-[1.14] text-[var(--color-heading)]">
          {title}
        </p>
        <p className="text-muted-foreground max-w-[52ch] text-[14px] leading-[1.65]">
          This module is not written yet. What is here is the shape of it: where it sits in the arc,
          what it is for, and how you get to it and back.
        </p>
        <Skeleton />
        <div aria-hidden="true" className="flex gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 flex-1 rounded-[14px] bg-[var(--color-pill)]" />
          ))}
        </div>
        <Skeleton />
      </div>

      <Card
        title="What this module is for"
        className="max-w-[52rem]"
        meta="The one thing that is written."
      >
        <p className="text-muted-foreground max-w-[52ch] leading-[1.65]">{tierIntent}</p>
      </Card>

      <ModuleActions />
    </View>
  );
}

/** Three grey bars of the prototype's `.skel`: decoration, never content. */
function Skeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5">
      <i className="block h-[11px] w-[84%] rounded-full bg-[var(--color-pill-hover)]" />
      <i className="block h-[11px] w-[96%] rounded-full bg-[var(--color-pill-hover)]" />
      <i className="block h-[11px] w-[62%] rounded-full bg-[var(--color-pill-hover)]" />
    </div>
  );
}
