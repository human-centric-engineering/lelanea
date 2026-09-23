import type { CSSProperties } from 'react';

import { MODULES_PATH_PREFIX } from '@/lib/app/journey/paths';
import { USAGE_PAGE } from '@/lib/app/usage/usage-view';

/**
 * The hue each destination carries, keyed by its route.
 *
 * Ported from the prototype's `KIND_TONE` (`.context/app/planning/design/
 * lelanea.html`), which says what the tone is FOR: "each view carries a hue
 * that says which part of the arc it belongs to". Every value is an existing
 * palette token — the prototype invented no colour for this and neither does
 * this table.
 *
 * ## Why it is a table here and a per-view call there
 *
 * The prototype sets `--tone` from inside each render function, because its
 * views are functions that mutate one surface. Here a view is a route, and the
 * tone has to be set ABOVE the view: custom properties inherit downward, so a
 * `--tone` set on the page could never reach the band across the workspace head
 * or the edge of the conversation panel when it slides over.
 *
 * `Panes` is where it goes, and the distinction cost a round: the workspace is
 * above the band but is a SIBLING of the conversation, so publishing it there
 * left the panel edge on one side of the screen permanently teal while the band
 * on the other was green. `Panes` is the common ancestor of both, and the only
 * thing it knows about the view is its path — so the path is the key.
 *
 * A destination with no entry gets no tone at all, and the band stays
 * transparent. That is `/app` itself: the clean conversation belongs to no part
 * of the arc.
 *
 * ## The tone paints the band, and not the eyebrow
 *
 * The prototype also tints `#ws-eyebrow` with `--tone`. That is not carried
 * over: measured against `--color-background`, `--color-accent-ink` reaches
 * 3.17:1 in light mode and the raw `--color-status-yellow` 2.03:1, both
 * well under AA for 12px text. Tinting only some of the six would leave the
 * rule "the eyebrow takes the tone, except twice", which is the kind of rule
 * that gets restored by whoever reads the prototype next. So the eyebrow keeps
 * `--color-muted-foreground` everywhere and contrast stays measured in one
 * place — `tests/unit/app/brand-theme.test.ts`.
 */
export const VIEW_TONES: Readonly<Record<string, string>> = {
  '/app/journey': 'var(--color-status-green)',
  // Her notes take the blue, which no other destination uses. The band is a
  // SURFACE, so the raw hue is the right half of the rule — the -ink siblings
  // are for type (see `shell.md`, "Coloured type is a different table"). It is
  // deliberately not the secondary ink that usage, account and workspace share:
  // this is the one destination that changes while you are looking at it, and a
  // fourth route in the same colour would say it is more of the same.
  '/app/notes': 'var(--color-status-blue)',
  '/app/situations': 'var(--color-status-yellow)',
  '/app/share': 'var(--color-accent-ink)',
  [USAGE_PAGE]: 'var(--color-secondary-ink)',
  '/app/settings': 'var(--color-status-purple)',
  '/app/account': 'var(--color-secondary-ink)',
  '/app/workspace': 'var(--color-secondary-ink)',
};

/**
 * The inline style that publishes a route's tone, or `undefined` for a route
 * that has none.
 *
 * Intersected with `Record<'--tone', string>` rather than cast: `CSSProperties`
 * has no index signature, so a bare custom property is an excess-property
 * error, and `as CSSProperties` would silence a typo in the property NAME along
 * with it.
 */
export function toneStyleFor(
  pathname: string
): (CSSProperties & Record<'--tone', string>) | undefined {
  const tone = VIEW_TONES[pathname] ?? VIEW_TONES[toneKeyFor(pathname)];
  return tone ? { '--tone': tone } : undefined;
}

/**
 * A module page takes the workspace's tone: a module IS the workspace, at
 * whichever URL. The prototype tones a module by its tier, but the tone is
 * published from `Panes`, which knows only the path — and mapping a slug to a
 * tier there would mean bundling the structure file into a client component
 * for one hue. The tier's colour is carried in the map drawer instead, where
 * `TIER_INKS` names each arc in it (`map-drawer.tsx`).
 */
function toneKeyFor(pathname: string): string {
  return pathname.startsWith(`${MODULES_PATH_PREFIX}/`) ? '/app/workspace' : pathname;
}
