import { BookOpen, Map } from 'lucide-react';

import { cn } from '@/lib/utils';

const RAIL_ITEMS = [
  { id: 'map', label: 'Map', tip: 'Your map — the sixteen modules', icon: Map },
  { id: 'resources', label: 'Resources', tip: 'Resources — films and reading', icon: BookOpen },
] as const;

/**
 * The right rail: 70px, and the fourth column of the four-column shell.
 *
 * ## Why the buttons ship disabled
 *
 * Each opens a drawer that `t-10` builds. Between this merge and that one the
 * rail is a column with two controls and nothing behind them, and `B31` gives
 * three honest ways to hold that: omit it, ship a deliberate stub that says what
 * it is, or build the mechanism. Omitting the rail is out — it is a column, and
 * the shell is four columns or it is not the shell. Building the drawers here is
 * `t-10`'s work, sized as its own task because the drawer choreography is the
 * review surface that matters.
 *
 * So: a deliberate stub. The buttons render at full size so the column measures
 * correctly against the prototype, and `disabled` with a title that says the
 * drawers are still to come — rather than live buttons that swallow a click,
 * which is the dishonest fourth option `B31` names.
 *
 * A server component: nothing here is interactive yet, and `t-10` promotes it to
 * a client island when the drawer state arrives.
 */
export function ShellRail() {
  return (
    <nav
      aria-label="Panels"
      className={cn(
        'bg-card relative z-50 flex w-[70px] flex-none flex-col items-center gap-1.5',
        'border-l border-[var(--color-divider)] py-3.5'
      )}
    >
      {RAIL_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            disabled
            title={`${item.tip} — arrives with the drawers`}
            className={cn(
              'text-muted-foreground flex w-[62px] flex-col items-center justify-center gap-1.5',
              'rounded-xl px-0 pt-2.5 pb-2 text-[8.5px] leading-none tracking-[0.05em]',
              'whitespace-nowrap uppercase disabled:opacity-50'
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
