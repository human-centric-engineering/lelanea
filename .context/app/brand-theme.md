---
name: brand-theme
description: How Lelañea's palette and typefaces reach the page, which tokens exist, and the three ways to consume them.
---

# Brand theme — palette and type

Lelañea's colours and typefaces reach the page through **one fork-owned
stylesheet and one font module**, with no platform layout or page rewritten to
carry them.

| File                  | Owner                                                 | Does                                                                        |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `app/brand-theme.css` | ours (a Sunrise seam, shipped empty)                  | Declares every token, scoped to `[data-surface='consumer']`                 |
| `app/fonts.ts`        | ours (new file)                                       | Loads the three families through `next/font/google`                         |
| `app/layout.tsx`      | Sunrise — [divergence rows 1 and 2](./divergences.md) | Applies the font classes to `<html>`; resolves the theme before first paint |

## How a page gets branded

`proxy.ts` classifies every request through `classifySurface()`
(`lib/app/surface.ts`) into `admin` or `consumer`, sets `x-surface`, and the
root layout puts it on `<html data-surface>`. `<SurfaceSync>` rewrites the
attribute on client-side navigation, because `<html>` is the one element that
does not re-render.

**`/admin` is the only non-consumer path**, so everything else — the public
site, the auth pages, the app itself — is branded, and the admin keeps Sunrise's
palette and fonts including future upstream changes.

Because the marker sits on `<html>`, body-portaled overlays (Radix dialogs,
dropdowns, popovers, toasts, the cookie banner) inherit the brand for free.
They mount at `document.body`, outside every route subtree, so a marker on a
route-group layout would leave them unstyled. The font variables are on `<html>`
for exactly the same reason.

## Three ways to consume a token, and when each applies

This is the part that catches people. `app/brand-theme.css` **overrides token
values; it does not create Tailwind utilities.** Tailwind generates utilities
from `@theme` at build time, and `@theme` lives in Sunrise's `globals.css`.

1. **A token that already exists upstream** — `--color-primary`,
   `--color-background`, `--color-border`, `--color-muted-foreground`, the
   radius scale. We redeclare the value, so `bg-primary`, `rounded-lg` and the
   rest come out in Lelañea's colours with no markup change. **This is why the
   existing shadcn components re-skin without being touched.**

2. **A brand-only token** — `--color-heading`, `--color-accent-ink`,
   `--color-pill`, the four `--color-status-*` families, `--shadow-bloom`,
   `--ease-brand`. There is no `text-heading` utility and there will not be one.
   Read it as `var(--color-heading)`, either in a component's own CSS or as a
   Tailwind arbitrary value: `text-[var(--color-heading)]`.

3. **A typographic register** — use the class. `.brand-display`,
   `.brand-quote`, `.brand-eyebrow` and `.brand-num` carry the family, tracking
   and line-height together, because a register is all three at once. They are
   scoped to the consumer surface, so they do nothing on `/admin`.

## Four rules that are load-bearing

- **Nothing in `brand-theme.css` may be wrapped in `@layer`.** Tailwind emits
  its tokens inside a layer; unlayered beats layered regardless of specificity,
  and that is the only reason our values win. A test asserts this.
- **The dark scope is `[data-surface='consumer'].dark`** — a compound selector,
  because `.dark` is toggled on `<html>`, the same element. The descendant form
  is for a surface pinned on a wrapper further down, and using it here renders
  light-on-light.
- **The light block also matches in dark mode.** Anything theme-invariant — the
  fonts, radii, easings, `--shadow-bloom` — is declared once in the light block.
  A token declared _only_ under `.dark` would have no light value; a test
  asserts every dark token has a light twin.
- **The registers beat Tailwind.** `.brand-display` and friends are unlayered,
  so they win over `leading-*` and `tracking-*`. Override with plain CSS on the
  element, not with a utility that will lose.

## Where the values come from

The approved prototype's token block
(`.context/app/planning/design/lelanea.html`) is the source, because §6.1 of the
product description makes the prototype the authority on how the product looks.

Four things it does not carry come from the design kit
(`.context/app/planning/design/Lelanea_Design_System/colors_and_type.css`),
which §6.4 and §6.5
specify: the radius scale (8/12/20/28/999), `--shadow-bloom`, and `--ease-quick`.
Where the two disagree — `--shadow-rest` and `--shadow-lift` have different
values in each — **the prototype wins**.

Secondary text is `#5A5F62` light and `#A8AEB1` dark (decision D5, already
carried by the prototype). The kit's original `#6F7376` fails 4.5:1 in all four
pairings and survives only as the base of the border and divider alphas, where
contrast carries no meaning. `tests/unit/app/brand-theme.test.ts` measures all
four pairings rather than trusting the note.

## Theme resolution

The system preference is the **default**; only the toggle persists a choice.
Nothing is written to `localStorage` until someone uses the toggle, and until
then the app follows OS theme changes live. That is decision D4, and getting
there meant changing two Sunrise files — [row 2](./divergences.md) explains what
and why.
