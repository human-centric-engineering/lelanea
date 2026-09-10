'use client';

import { Moon, Sun } from 'lucide-react';

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

  return (
    <header
      className={cn(
        'bg-background flex h-[58px] flex-none items-center gap-3',
        'border-b border-[var(--color-divider)] pr-[18px] pl-[22px]'
      )}
    >
      <span className="flex-1" />
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
