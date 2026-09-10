'use client';

import { Columns2, Menu, MessageCircle, Moon, Sun } from 'lucide-react';

import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

/**
 * The top bar: 58px, ruled off from the panes below it.
 *
 * ## What is deliberately absent, and why the bar still earns its place
 *
 * The prototype's bar carries five things. Three of them cannot be honest yet:
 *
 * - **Recents** needs a history of opened modules. Nothing opens a module until
 *   §05, so the strip would be permanently empty.
 * - **The budget meter** needs metered spend. Nothing calls a model until phase
 *   2, so `$12.40 left` would be a number we invented (D6, `B31`).
 * - **The `prototype` tag** is the prototype labelling itself.
 *
 * That leaves the theme toggle, which is real, plus the burger and pane switch —
 * and those two are `t-10`'s: they drive the ≤900px nav drawer and the pane
 * carousel, neither of which exists in this task. A burger rendered here now
 * would be a control that opens nothing, which reads as a broken app rather than
 * an unfinished one. `t-10` adds them beside the toggle when the state they
 * drive arrives.
 */
/**
 * Both faces are always in the DOM, and CSS picks one. This is not a style
 * preference — it is what keeps the button hydration-safe.
 *
 * `ThemeProvider` resolves to `'light'` on the server (it cannot read storage
 * or the OS) and to the real value on the client's first render. Branching on
 * `theme` in the returned markup therefore emits a moon and "Switch to the dark
 * theme" from the server and wants a sun and "…light theme" on the client, for
 * every reader in dark mode. `<body suppressHydrationWarning>` covers body's own
 * attributes, not its descendants, so React logs a hydration error and re-renders
 * the tree.
 *
 * The `dark:` variant keys on `.dark` on `<html>`, which the root layout's
 * no-flash script sets BEFORE first paint — so the correct face is showing from
 * the first frame, and the server and client agree on the markup because both
 * faces are in it either way. `components/theme-toggle.tsx` solves it the same
 * way, for the same reason.
 *
 * The accessible name gets the same treatment rather than a static "Toggle
 * theme": a label that says where the click takes you is worth keeping, and
 * `hidden` removes an element from the accessibility tree, so exactly one of
 * these is ever the button's name.
 */
export function ShellTopbar() {
  const { theme, setTheme } = useTheme();
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
      ) : (
        <span className="flex-1" />
      )}
      <button
        type="button"
        // `theme` is safe to read in a HANDLER — it runs after hydration, when
        // the value is correct. Only the returned markup has to be agnostic.
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className={cn(
          'text-muted-foreground hover:text-foreground flex h-8 w-8 flex-none items-center',
          'justify-center rounded-full border border-[var(--color-border)]',
          'hover:bg-[var(--color-pill-hover)]',
          'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
          'focus-visible:outline-[var(--color-ring)]'
        )}
      >
        <Moon size={16} strokeWidth={1.5} aria-hidden="true" className="dark:hidden" />
        <Sun size={16} strokeWidth={1.5} aria-hidden="true" className="hidden dark:block" />
        <span className="sr-only dark:hidden">Switch to the dark theme</span>
        <span className="sr-only hidden dark:inline">Switch to the light theme</span>
      </button>
    </header>
  );
}
