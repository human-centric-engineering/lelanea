'use client';

import { Columns2, Menu, MessageCircle } from 'lucide-react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { cn } from '@/lib/utils';

/**
 * The top bar: 58px, ruled off from the panes below it.
 *
 * ## Above 900px it is empty, and that is deliberate
 *
 * The prototype's bar carries five things. Three of them cannot be honest yet:
 *
 * - **Recents** needs a history of opened modules. Nothing opens a module until
 *   §05, so the strip would be permanently empty.
 * - **The budget meter** needs metered spend. Nothing calls a model until phase
 *   2, so `$12.40 left` would be a number we invented (D6, `B31`).
 * - **The `prototype` tag** is the prototype labelling itself.
 *
 * The fourth, the theme toggle, was here until 15 September 2026 and now lives
 * in the account menu (`account-menu.tsx`) with everything else about the
 * person — owner ruling: one place, not two. That leaves the burger and the
 * pane switch, which are ≤900px controls. So above 900px the bar holds nothing
 * until recents and the meter arrive, and it stays: it is part of the frame,
 * and the panes are ruled off from it whether or not it has anything to say.
 * Do not put the toggle back to fill it.
 */
export function ShellTopbar() {
  const { width, wsOpen, navOpen, setNavOpen, pane, setPane } = useShellLayout();

  const small = width === 'small';

  return (
    <header
      className={cn(
        'bg-background flex h-[58px] flex-none items-center gap-3',
        'border-b border-[var(--color-divider)] pr-[18px] pl-[22px]'
      )}
    >
      {/*
        Both of these are ≤900px controls, and neither is rendered above it —
        the nav is a column there with nothing to open, and both panes are on
        screen together with nothing to switch between. A control that exists
        but does nothing is the thing `t-9` refused to ship, and rendering them
        hidden would be the same refusal with extra steps.
      */}
      {small ? (
        <button
          type="button"
          onClick={() => setNavOpen(!navOpen)}
          aria-label={navOpen ? 'Close the menu' : 'Open the menu'}
          aria-expanded={navOpen}
          className={cn(
            'text-muted-foreground hover:text-foreground flex h-9 w-9 flex-none items-center',
            'justify-center rounded-full hover:bg-[var(--color-pill-hover)]',
            'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
            'motion-reduce:transition-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          <Menu size={19} strokeWidth={1.6} aria-hidden="true" />
        </button>
      ) : null}

      {small && wsOpen ? (
        <div
          role="group"
          aria-label="Show"
          className="relative flex min-w-0 flex-1 items-stretch self-stretch"
        >
          {(
            [
              { id: 'chat', label: 'Conversation', Icon: MessageCircle },
              { id: 'ws', label: 'Workspace', Icon: Columns2 },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              aria-pressed={pane === id}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center gap-[7px] px-1.5 text-sm',
                'text-muted-foreground aria-pressed:text-[var(--color-heading)]',
                'aria-pressed:font-medium'
              )}
            >
              <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
              <span className="min-w-0 truncate">{label}</span>
            </button>
          ))}
          {/* The underline slides where the panes slide, so the swipe has a readout. */}
          <span
            aria-hidden="true"
            className={cn(
              'absolute bottom-[-1px] left-0 z-[1] h-0.5 w-1/2 rounded-t-sm',
              'bg-[var(--color-accent-ink)]',
              'transition-transform duration-[340ms] ease-[var(--ease-brand)]',
              'motion-reduce:transition-none',
              pane === 'ws' ? 'translate-x-full' : 'translate-x-0'
            )}
          />
        </div>
      ) : null}
    </header>
  );
}
