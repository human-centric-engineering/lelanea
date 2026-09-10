'use client';

import { BookOpen, Map } from 'lucide-react';

import { type DrawerId, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { cn } from '@/lib/utils';

const RAIL_ITEMS: { id: DrawerId; label: string; tip: string; icon: typeof Map }[] = [
  { id: 'map', label: 'Map', tip: 'Your map — the sixteen modules', icon: Map },
  { id: 'resources', label: 'Resources', tip: 'Resources — films and reading', icon: BookOpen },
];

/**
 * The right rail: 70px, and the fourth column of the four-column shell.
 *
 * `t-9` shipped its two buttons `disabled` with the reason in their accessible
 * name, because the rail is a column and the shell is four columns or it is not
 * the shell — but the drawers they open belonged to this task. They are live
 * now, and the panels behind them are themselves honest stubs: the map needs
 * §05's modules and the resources need phase 3, so each says what it will hold
 * rather than showing an empty list.
 *
 * Below 900px the rail leaves the right edge and becomes a footer, where the two
 * panels are within reach of a thumb.
 */
export function ShellRail() {
  const { drawer, openDrawer, closeDrawer, width } = useShellLayout();
  const small = width === 'small';

  return (
    <nav
      aria-label="Panels"
      className={cn(
        'bg-card relative z-50 flex flex-none gap-1.5 border-[var(--color-divider)]',
        small
          ? // A footer, with safe-area padding so the last row clears a phone's
            // home indicator rather than sitting under it.
            'order-last w-full flex-row items-stretch justify-center border-t py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
          : 'w-[70px] flex-col items-center border-l py-3.5'
      )}
    >
      {RAIL_ITEMS.map((item) => {
        const Icon = item.icon;
        const open = drawer === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.tip}
            aria-label={item.tip}
            aria-expanded={open}
            onClick={() => (open ? closeDrawer() : openDrawer(item.id))}
            className={cn(
              'text-muted-foreground flex w-[62px] flex-none flex-col items-center',
              'justify-center gap-1.5 rounded-xl px-0 pt-2.5 pb-2 text-[8.5px]',
              'leading-none tracking-[0.05em] whitespace-nowrap uppercase',
              'hover:text-foreground hover:bg-[var(--color-pill-hover)]',
              'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
              'motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
              'focus-visible:outline-[var(--color-ring)]',
              open && 'bg-[var(--color-secondary-wash)] text-[var(--color-secondary-ink)]'
            )}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
