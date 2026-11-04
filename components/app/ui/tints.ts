/**
 * The tints the temporary picker offers, and the script that applies the
 * chosen ones before first paint.
 *
 * TEMPORARY. The picker exists so Lelañea can choose her light (owner ruling,
 * 3 Nov 2026); f-prism t-181 makes her choice the default and deletes this file
 * with the rest of the picker. See `tint-picker.tsx` for the full list.
 *
 * A plain module, not `'use client'`: the server gate needs the script string
 * itself, and the client controls need the catalogue, so both read it here and
 * the two cannot disagree about which names are valid.
 *
 * ## The shape of a choice
 *
 * One tint per theme, kept apart: `data-tint` on `<html>` carries the light
 * choice and `data-tint-dark` the dark one, each read by its own block in
 * `tints.css`. The default of each theme is `app/brand-theme.css` itself, so
 * choosing it REMOVES the attribute rather than naming it — the page with no
 * attribute is exactly the page that ships without the picker.
 */

export type TintTheme = 'light' | 'dark';

export interface Tint {
  /** The attribute value, and the key of its block and swatch in `tints.css`. */
  id: string;
  label: string;
}

/** The theme's default: no attribute, the palette as `brand-theme.css` ships it. */
export const DEFAULT_TINT = 'default';

export const TINTS: Readonly<Record<TintTheme, readonly Tint[]>> = {
  light: [
    { id: DEFAULT_TINT, label: 'Champagne' },
    { id: 'pearl', label: 'Pearl' },
    { id: 'blush', label: 'Blush' },
    { id: 'opal', label: 'Opal' },
    { id: 'linen', label: 'Linen' },
    { id: 'lilac', label: 'Lilac' },
    { id: 'seaglass', label: 'Sea glass' },
    { id: 'honey', label: 'Honey' },
  ],
  dark: [
    { id: DEFAULT_TINT, label: 'Amber smoke' },
    { id: 'plum', label: 'Plum dusk' },
    { id: 'slate', label: 'Slate' },
    { id: 'ember', label: 'Ember' },
    { id: 'moss', label: 'Moss' },
    { id: 'ink', label: 'Ink' },
  ],
};

/** Where each theme's choice lives on `<html>`. */
export const TINT_ATTRIBUTE: Readonly<Record<TintTheme, string>> = {
  light: 'data-tint',
  dark: 'data-tint-dark',
};

/** Per viewer, per theme. Never written for the default: see `applyTint`. */
export const TINT_STORAGE_KEY: Readonly<Record<TintTheme, string>> = {
  light: 'lelanea.tint.light',
  dark: 'lelanea.tint.dark',
};

/** The tints of a theme other than its default — the ones with a block. */
export function namedTints(theme: TintTheme): string[] {
  return TINTS[theme].map((tint) => tint.id).filter((id) => id !== DEFAULT_TINT);
}

/**
 * The tint the page is showing: the attribute on `<html>`, or the default when
 * there is none. Read from the page rather than from storage, because a
 * blocked store still lets a choice change the page (`applyTint`), and the
 * picker has to show what is on screen; the pre-paint script has already put
 * any stored choice there.
 */
export function readAppliedTint(theme: TintTheme): string {
  const applied = document.documentElement.getAttribute(TINT_ATTRIBUTE[theme]);
  return applied !== null && namedTints(theme).includes(applied) ? applied : DEFAULT_TINT;
}

/**
 * Puts a choice on the page and remembers it. The attribute is set first and
 * the write is best-effort, so a blocked store still changes the page — the
 * choice just does not survive a reload.
 */
export function applyTint(theme: TintTheme, id: string): void {
  const root = document.documentElement;
  const named = namedTints(theme).includes(id);
  if (named) root.setAttribute(TINT_ATTRIBUTE[theme], id);
  else root.removeAttribute(TINT_ATTRIBUTE[theme]);
  try {
    if (named) window.localStorage.setItem(TINT_STORAGE_KEY[theme], id);
    else window.localStorage.removeItem(TINT_STORAGE_KEY[theme]);
  } catch {
    // Storage blocked: the page changed, the choice is not remembered.
  }
}

/**
 * Runs before first paint so a reload never flashes the default tint. Reads
 * storage and never writes it, and sets an attribute only for a name it knows.
 * Built from the catalogue above so the two cannot drift; `tint-picker.test`
 * runs it.
 */
export const TINT_SCRIPT = `
(function() {
  try {
    var root = document.documentElement;
    var themes = ${JSON.stringify(
      (['light', 'dark'] as const).map((theme) => ({
        key: TINT_STORAGE_KEY[theme],
        attribute: TINT_ATTRIBUTE[theme],
        names: namedTints(theme),
      }))
    )};
    for (var i = 0; i < themes.length; i++) {
      var stored = localStorage.getItem(themes[i].key);
      if (themes[i].names.indexOf(stored) !== -1) root.setAttribute(themes[i].attribute, stored);
    }
  } catch (e) {}
})();
`;
