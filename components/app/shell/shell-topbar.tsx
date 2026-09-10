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
export function ShellTopbar() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';

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
        onClick={() => setTheme(next)}
        aria-label={`Switch to the ${next} theme`}
        title={`Switch to the ${next} theme`}
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
        {theme === 'dark' ? (
          <Sun size={16} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Moon size={16} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
    </header>
  );
}
