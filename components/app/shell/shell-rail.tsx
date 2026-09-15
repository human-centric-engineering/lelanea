'use client';

import { BookOpen, Map } from 'lucide-react';

import { type DrawerId, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { Tipped } from '@/components/app/ui/tipped';
import { cn } from '@/lib/utils';

const RAIL_ITEMS: { id: DrawerId; label: string; tip: string; icon: typeof Map }[] = [
  { id: 'map', label: 'Map', tip: 'Your map — the sixteen modules', icon: Map },
  { id: 'resources', label: 'Resources', tip: 'Resources — films and reading', icon: BookOpen },
];

/**
 * The right rail: 70px, and the fourth column of the four-column shell.
 *
 * Both buttons are live, and the panels behind them are honest about what they
 * hold: the map is the published graph, and the resources are the designed
 * placeholder until phase 3 fills them. (`t-9` shipped them `disabled` with the
 * reason in their accessible name, because the rail is a column and the shell is
 * four columns or it is not the shell — but the drawers belonged to `t-10`.)
 *
 * ## Below 900px it is not a smaller rail, it is two keys
 *
 * The rail's vertical form is 62px of icon with an 8.5px uppercase caption under
 * it — legible as a column label beside a full screen of work, and wrong as a
 * phone control: two of them huddled in the middle of a bare strip, hard to hit
 * and not reading as the two ways out of the conversation.
 *
 * So at that width they become the prototype's `.mrail-btn`: two raised keys
 * splitting the full width of the footer between them, 48px tall, icon BESIDE a
 * sentence-case label at body size. The recipe is the one the composer and the
 * pane switch already use here — the lifted ground, a hairline, a resting shadow
 * — so the footer reads as part of the same product rather than as a toolbar.
 *
 * What the footer already had is kept: `order-last`, the top border, and
 * `env(safe-area-inset-bottom)` so the row clears a phone's home indicator
 * rather than sitting under it.
 *
 * The tooltip is deliberately NOT suppressed by width here — `Tipped` ignores
 * touch pointers outright, which is the real rule. A phone with a mouse
 * attached gets the bubble; a tap never does. A hover tooltip that latches on
 * tap sits directly over the button it describes.
 */
export function ShellRail() {
  const { drawer, openDrawer, closeDrawer, width } = useShellLayout();
  const small = width === 'small';

  return (
    <nav
      aria-label="Panels"
      className={cn(
        'bg-card relative z-50 flex flex-none border-[var(--color-divider)]',
        small
          ? // The footer: two keys, full width, with a gap between them so they
            // read as two things rather than one wide strip.
            [
              'order-last w-full flex-row items-stretch gap-3 border-t',
              'px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
            ]
          : 'w-[70px] flex-col items-center gap-1.5 border-l py-3.5'
      )}
    >
      {RAIL_ITEMS.map((item) => {
        const Icon = item.icon;
        const open = drawer === item.id;
        return (
          <Tipped key={item.id} side="left" label={item.tip}>
            {(tip) => (
              <button
                {...tip}
                type="button"
                aria-label={item.tip}
                aria-expanded={open}
                onClick={() => (open ? closeDrawer() : openDrawer(item.id))}
                className={cn(
                  'flex flex-none items-center justify-center',
                  'transition-[background-color,color,border-color,box-shadow,transform]',
                  'duration-200 ease-[var(--ease-brand)] motion-reduce:transition-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                  'focus-visible:outline-[var(--color-ring)]',
                  small
                    ? [
                        // A thumb target: half the row each, 48px tall, icon
                        // beside a sentence-case label at readable size.
                        'text-foreground h-12 min-w-0 flex-1 gap-[9px] rounded-[14px] text-sm',
                        'border border-[var(--color-border)] bg-[var(--color-popover)]',
                        'shadow-[var(--shadow-rest)]',
                        // It goes down under the thumb, like every other button
                        // here. `active:` rather than `hover:` — a phone has no
                        // hover, and a hover style that latches on tap stays
                        // stuck until something else is touched.
                        'active:scale-[0.97] active:shadow-none',
                        open
                          ? [
                              'border-[var(--color-secondary-ink)]',
                              'bg-[var(--color-secondary-wash)] text-[var(--color-secondary-ink)]',
                            ]
                          : 'text-muted-foreground',
                      ]
                    : [
                        'text-muted-foreground w-[62px] flex-col gap-1.5 rounded-xl px-0 pt-2.5 pb-2',
                        'text-[8.5px] leading-none tracking-[0.05em] whitespace-nowrap uppercase',
                        'hover:text-foreground hover:bg-[var(--color-pill-hover)]',
                        open &&
                          'bg-[var(--color-secondary-wash)] text-[var(--color-secondary-ink)]',
                      ]
                )}
              >
                <Icon
                  size={small ? 18 : 20}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  // The prototype keeps the glyph muted inside a key whose label
                  // is not, and takes the secondary ink with it when open.
                  className={cn('flex-none', small && !open && 'text-muted-foreground')}
                />
                <span
                  className={cn(
                    small && 'text-foreground min-w-0 truncate',
                    small && open && 'text-[var(--color-secondary-ink)]'
                  )}
                >
                  {item.label}
                </span>
              </button>
            )}
          </Tipped>
        );
      })}
    </nav>
  );
}
