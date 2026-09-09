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

   **They set no colour.** Being unlayered, they beat every utility on the same
   element — and arbitrary values live in `@layer utilities` too, so a `color`
   in one of these rules could not be overridden by _any_ class, not even
   `text-[var(--color-heading)]`. Type belongs to the register; colour belongs
   to the caller. A test enforces it.

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
- **The registers beat Tailwind, for the type they set.** `.brand-display` and
  friends are unlayered, so they win over `leading-*`, `tracking-*`, and
  `text-<size>` on the eyebrow. Change one with plain CSS on the element, not
  with a utility that will lose. Colour is exempt — they set none.

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

Four values deviate from the prototype, every one of them for a measured
contrast reason and every one recorded at the site:

- **Dark `--color-popover` is `#3D4245`, one step darker than the prototype's
  `#3F4446`.** At the prototype's value, secondary text measured 4.40:1 — the
  only one of the four grounds that missed D5's bar. Popovers are where
  secondary text lives most: `<FieldHelp>` renders its whole body as muted text
  on that ground, and CLAUDE.md mandates one on every non-trivial form field.
- **`--color-destructive` is `#A95146` and holds across both modes.** It does
  not lighten in dark, because §6.2 says the functional colours hold — the
  prototype's `--color-status-red` lightens only because it is a badge tint used
  behind a `-bg`/`-ink` pair, and that lighter value taken as a button fill put
  oyster text on it at 2.99:1. And it is not §6.2's `#B75D52` either, which
  measured 3.93:1 under oyster; see the ruling below.
- **`--color-input` is `rgba(17, 24, 26, 0.50)` light and
  `rgba(227, 218, 209, 0.52)` dark**, where the prototype gives `.input` the
  same hairline as everything else. See the ruling below.
- **`--color-ring` is the secondary ink** — `#17718A` light, `#7CC0D6` dark —
  not the ceremonial orange. See the ruling below.

## The three contrast rulings (t-18)

t-1 shipped two measured gaps rather than patching them quietly, because closing
either looked like a palette decision rather than a build one. The owner made
it. Auditing the second turned up a third — the focus ring — which nobody had
asked about and which mattered more than the boundary that led to it. The
reasoning is here because none of it is recoverable from the values themselves.

**A filled destructive button now uses a darker terracotta than §6.2 names.**
`#B75D52` under oyster measures 3.93:1 — below the design's own filled-button
baseline (primary 4.54, teal 4.91) and below AA. `--color-destructive` is
therefore `#A95146`: the identical hue and saturation (6.5°, 41.2%) five points
darker in lightness, giving 4.68:1. **This is the move the orange already
makes** — `--color-accent-ink` keeps §6.2's named `#C96F43` while
`--color-primary` is the darker `#A85732` that can carry a fill. Nothing is lost
from the palette: the named terracotta is still `--color-status-red` and its
`-ink`, which is where §6.2's danger hue is read as a colour rather than sat on.

**The control boundary is not the hairline, and only the boundary moved.** WCAG
1.4.11 asks 3:1 of anything needed to _identify_ a control, and nothing of a
line that merely separates. So `--color-border`, `--color-divider` and
`--color-card-border` keep §6.4's alphas untouched — cards, dividers and
sections are exactly as they were — and only `--color-input` rose. In this
component set that token is the edge of `<Input>`, `<Textarea>`,
`<SelectTrigger>`, `<Checkbox>` and the outline `<Button>`; it measured ~1.33:1
light and ~1.45:1 dark. The base changed too, for an **alpha ceiling** rather
than an impossibility: the kit's silver `#6F7376` does clear 3:1, but only from
0.85 up (3.02 at its tightest; 3.85 opaque). At 0.85 an alpha has stopped being
a hairline and is a muddier way of writing a solid colour, so light is based on
the heading ink, which reaches the same band at 0.50. The two values clear 3:1
on all four grounds in both themes, with 3.24 the tightest.

`--color-input` **is also a fill**, and that changes a live control. shadcn's
`<Switch>` paints its off-track with `bg-input`, and `<Switch>` is on this
surface today in the cookie-consent modal. Before, the off-track was `#D3D2D0`:
1.33:1 against the ground, so invisible as a control, but 3.41:1 against the
orange on-track. After, it is `#828483`: 3.24:1 against the ground, and 1.37:1
against the on-track. **The trade is taken deliberately.** 1.4.11 governs the
first number and it now passes; the second is 1.4.1's territory, which asks only
that colour not be the _sole_ carrier of state — and the thumb slides, so it
never was. What is left is grey-off against orange-on, the ordinary switch
idiom, in place of a near-white track nobody could see. No value could have had
both: 3:1 on an oyster ground caps lightness at 0.258 and 3:1 on the primary
fill demands 0.561, and those ranges do not meet.

**The focus ring left the ceremonial orange.** `--color-ring` was `#C96F43`,
which measures 2.90 on the light card ground and 2.83 on the dark popover — a
_focus_ indicator below 1.4.11, which is worse than a resting border below it,
because it is the only thing telling a keyboard user where they are. It is now
the secondary ink, `#17718A` light and `#7CC0D6` dark, clearing 4.49 and 5.02 at
their tightest. Both are §6.2-named brand colours, §6.2 gives teal and aqua the
active states, and the prototype's own `.input:focus` sets
`border-color: var(--color-secondary)`. The orange keeps the primary action and
the lotus, which is all §6.2 asked of it.

### The resting fill is not the whole story

**4.68:1 is the fill at rest.** `button.tsx` writes its hover as
`hover:bg-destructive/90` — an alpha over whatever is behind it — so on a light
ground the hover fill composites to `#B06157` and the label drops to **3.92:1**,
which is the gap this token was moved to close. `<Badge variant="destructive">`'s
`/80` is 3.26:1.

**Darkening further does not fix it, and is not worth what it would cost.** The
90% composite reaches 4.5:1 only at a lightness of 0.42 — `#97493F` — which puts
the _resting_ fill at 5.53:1 and lands ten points below §6.2's terracotta: a
palette shift visible on every surface, bought for a state that lasts as long as
a pointer hovers, and the badge's `/80` would still fail at 3.70. The real
mechanism is a hover **token**, which the accent already has
(`--color-primary-hover`) and which shadcn's alpha-hover bypasses.
`bg-primary/90` has the identical shape at 3.83:1 and is untouched here, so one
fix serves both. **It lands with our own Button in t-2, beside the ring offset
below.**

**One thing this does not fix, and no colour could.** `components/ui/button.tsx`
draws `ring-1` with no `ring-offset`, so a focused button's ring sits flush
against its own fill. Its outer edge still meets the page ground at 4.91:1,
which is what you perceive on the orange and terracotta fills — but `secondary`
_is_ this teal, so a focused secondary button just grows a pixel in its own
colour. The same arithmetic as the switch closes off every alternative:
lightness at most 0.258 to clear the ground, at least 0.561 to clear a fill.
This is a **missing mechanism — an offset — not a wrong value**, so it belongs
to the component rather than to the palette. It is latent today, since nothing
on this surface renders `<Button variant="secondary">`, and **t-2 builds our own
Button under `components/app/`, which is where the offset should land.**

Every number above is **measured from the stylesheet** by
`tests/unit/app/brand-theme.test.ts`, which composites the `rgba()` boundary
tokens over each ground rather than reading their channels raw — read raw, an
invisible hairline measures as though it were opaque and every assertion passes
while nothing is on screen. The guards pair each token against a **page
ground**, which is what 1.4.11 governs; the two adjacencies above — off-track
against on-track, ring against fill — are deliberately not asserted, because
neither is reachable by choosing a colour and a permanently failing assertion
for an accepted trade is noise.

## The destructive token has two roles, and only one rule separates them

`--color-destructive` is a shadcn token doing two opposite jobs. `bg-destructive`
is a **fill** that must be dark enough to hold oyster text; `text-destructive` is
**ink** that must be light enough to read on charcoal. Twenty consumer-surface
components use the second — every form's error banner renders
`bg-destructive/10 text-destructive`, and so do the avatar upload's error line
and the delete-account confirmation.

Darkening the fill to `#A95146` for the button therefore made the ink worse in
dark mode: **2.86:1 → 2.44:1** on that wash, and 2.21 → 1.89 inside a card. Both
numbers already failed AA before this repo existed, but the change moved them the
wrong way, which is not something to ship from a task about contrast.

No value serves both roles, for the same reason a ring cannot clear both a ground
and a fill. The palette already carries the mode-aware answer:
`--color-status-red-ink` is `#94433A` light and `#E0A197` dark, precisely because
a status colour is read rather than sat on. So `app/brand-theme.css` carries **one
override of an existing utility** — its only one —

```css
[data-surface='consumer'] .text-destructive {
  color: var(--color-status-red-ink);
}
```

which measures 5.92 / 5.42 / 5.57 / 6.18 light and 6.52 / 4.93 / 5.65 / 4.71 dark
against the four bare grounds. All eight clear AA; six of the eight failed it
before.

Against the `bg-destructive/10` **wash** the banners actually paint on — lighter
than a dark ground, and therefore tighter — it measures 5.20 / 4.78 / 4.92 light
and 6.01 / 4.65 / 5.25 dark over background, card and muted. A wash over the
_dark popover_ would be 4.44, the tightest number in the palette; nothing renders
an error banner inside a popover, so the test measures the three grounds a banner
can reach and says why rather than lowering its threshold to cover a case that
does not exist.

It is a rule rather than a token because `text-destructive` is _generated from_
`--color-destructive`, so separating the roles any other way means editing twenty
platform components. Being unlayered it wins, which also means no class can
recolour an element carrying it — acceptable here and only here, because the
class **is** a colour, and anything wanting a different one does not reach for
`text-destructive`. That is the exact opposite of the `.brand-*` registers, which
set no colour for the same reason. `/admin` keeps shadcn's behaviour.

Secondary text is `#5A5F62` light and `#A8AEB1` dark (decision D5, already
carried by the prototype). The kit's original `#6F7376` fails 4.5:1 in all four
pairings and survives only as the base of the border and divider alphas, where
contrast carries no meaning. `tests/unit/app/brand-theme.test.ts` measures all
four pairings rather than trusting the note.

## Theme resolution

`<SurfaceSync>` rewrites `data-surface` in a layout effect rather than upstream's
`useEffect`, so the surface swaps before paint — otherwise a client-side nav
between the app and `/admin` shows one frame of the wrong palette
([row 3](./divergences.md)).

The system preference is the **default**; only the toggle persists a choice.
Nothing is written to `localStorage` until someone uses the toggle, and until
then the app follows OS theme changes live. That is decision D4, and getting
there meant changing two Sunrise files — [row 2](./divergences.md) explains what
and why.
