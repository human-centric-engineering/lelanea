import type { CSSProperties } from 'react';

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
 * or the wash behind the conversation when it slides over. `Workspace` is the
 * lowest element that sits above both, and the only thing it knows about the
 * view is its path — so the path is the key.
 *
 * A destination with no entry gets no tone at all, and the band stays
 * transparent. That is `/app` itself: the clean conversation belongs to no part
 * of the arc.
 *
 * ## The tone paints the band, and not the eyebrow
 *
 * The prototype also tints `#ws-eyebrow` with `--tone`. That is not carried
 * over: measured against `--color-background`, `--color-accent-ink` reaches
 * 3.17:1 in light mode and the raw `--color-status-yellow` about 2.3:1, both
 * well under AA for 12px text. Tinting only some of the six would leave the
 * rule "the eyebrow takes the tone, except twice", which is the kind of rule
 * that gets restored by whoever reads the prototype next. So the eyebrow keeps
 * `--color-muted-foreground` everywhere and contrast stays measured in one
 * place — `tests/unit/app/brand-theme.test.ts`.
 */
export const VIEW_TONES: Readonly<Record<string, string>> = {
  '/app/journey': 'var(--color-status-green)',
  '/app/situations': 'var(--color-status-yellow)',
  '/app/share': 'var(--color-accent-ink)',
  '/app/usage': 'var(--color-secondary-ink)',
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
  const tone = VIEW_TONES[pathname];
  return tone ? { '--tone': tone } : undefined;
}
