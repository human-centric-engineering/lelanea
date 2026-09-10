import {
  Columns2,
  Gauge,
  Map,
  MessageCircle,
  Send,
  SlidersHorizontal,
  Waves,
  type LucideIcon,
} from 'lucide-react';

/**
 * The seven destinations of the left nav, in the prototype's order.
 *
 * Ported from the prototype's `NAV` array (`design/lelanea.html`), including the
 * hints, which are not decoration: in slim mode the label is hidden and the
 * tooltip is `label — hint`, so the hint is the only thing distinguishing two
 * icons at 64px.
 *
 * The prototype drives each item with a JavaScript `go()` that mutates in-page
 * state. Here they are real routes, so the shape carries `href` instead — every
 * one of them resolves to a page in t-11, and until then to the shell's own
 * placeholder. `The conversation` is `/app` itself: it is the way back to the
 * clean view rather than a destination beside the others.
 */
export interface ShellNavItem {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/** A rule between two groups, or the flexible gap that pins the last two down. */
export type ShellNavEntry = ShellNavItem | { kind: 'separator' } | { kind: 'spacer' };

export function isNavItem(entry: ShellNavEntry): entry is ShellNavItem {
  return !('kind' in entry);
}

export const SHELL_NAV: readonly ShellNavEntry[] = [
  {
    href: '/app',
    label: 'The conversation',
    hint: 'Just her, and nothing else',
    icon: MessageCircle,
  },
  {
    href: '/app/workspace',
    label: 'Workspace',
    hint: 'Back to the module you are in',
    icon: Columns2,
  },
  { kind: 'separator' },
  { href: '/app/journey', label: 'Your journey', hint: 'Where you have been', icon: Map },
  {
    href: '/app/situations',
    label: 'Life situations',
    hint: 'What you are living through',
    icon: Waves,
  },
  {
    href: '/app/share',
    label: 'Share with Lelañea',
    hint: 'Tell us what is working, and what is not',
    icon: Send,
  },
  { kind: 'spacer' },
  {
    href: '/app/usage',
    label: 'Usage and billing',
    hint: 'What you have spent, and the card on file',
    icon: Gauge,
  },
  {
    href: '/app/settings',
    label: 'Settings',
    hint: 'How she speaks to you',
    icon: SlidersHorizontal,
  },
] as const;
