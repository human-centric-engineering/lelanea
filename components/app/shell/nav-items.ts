import {
  Columns2,
  Map,
  MessageCircle,
  NotebookPen,
  Send,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import { NOTES_PAGE } from '@/lib/app/slots/notes-client';

/**
 * The six destinations of the left nav — the prototype's five, in its order,
 * plus her notes.
 *
 * The prototype has seven: "Usage and billing" and "Settings" sat at the foot,
 * pinned down by a flexible spacer. Both moved into the account menu
 * (`account-menu.tsx`) — one place for everything about the person, not two.
 * Owner ruling, 15 September 2026.
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
 *
 * ## The sixth is not in the prototype, and is not a person-thing either
 *
 * `Lelañea's notes` (f-slots t-73). The 15 September ruling sent everything
 * about the PERSON — account, settings, usage — into the account menu, and this
 * looked like one of those. It is not: §3.3 makes the workspace the place where
 * "the profile assembling" becomes visible, and says the pairing should provoke
 * curiosity about what has been recorded and why. That needs somewhere a reader
 * passes, and somewhere they can sit WHILE they talk — a note appearing inside
 * the turn that wrote it is the whole demonstration, and nobody witnesses it
 * from inside a popover. Owner ruling, 21 September 2026.
 */
export interface ShellNavItem {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/** A rule between two groups. */
export type ShellNavEntry = ShellNavItem | { kind: 'separator' };

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
    href: NOTES_PAGE,
    label: 'Lelañea’s notes',
    hint: 'What is written down about you, and why',
    icon: NotebookPen,
  },
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
] as const;
