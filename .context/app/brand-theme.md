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

**The prism prototype is the authority** (t-177, 3 Nov 2026):
[`.context/app/planning/design/prism/index.html`](./planning/design/prism/index.html) — the
site over its real compiled CSS, whose "PRISM over the real site" block carries
the values — and [`.context/app/planning/design/prism/app.html`](./planning/design/prism/app.html),
the shell, whose token block is the same set. Both are byte-identical to the
published artifact the owner approved.

**What the prism supersedes in `lelanea.html`:** the palette. Every colour, the
flat oyster ground (now a lit ground under glass), the shadows, and the lotus's
teals (now iris around a rose-gold heart). Teal and aqua no longer carry
navigation; iris does. The ceremonial accent is rose-bronze, not burnt orange,
and dark mode is amber smoke on an umber ground, not charcoal.

**What it leaves standing:** everything else §6.1 made `lelanea.html` the
authority on — type and its four registers, the radius scale, spacing, motion,
and the layout and content of every page. `lelanea.html` stays in the repo as
that authority. The prism's own overrides of the site's layout (the
`[class*='…']` rules in `index.html`) are a demo device for showing the light
over compiled CSS, and none of them is copied into the code: t-178 and t-179
make those changes in the modules they belong to.

Three things neither prism file carries still come from the design kit
(`.context/app/planning/design/Lelanea_Design_System/colors_and_type.css`, §6.4 and §6.5): the radius scale
(8/12/20/28/999), `--shadow-bloom` (retinted from the orange to the rose-bronze
accent ink) and `--ease-quick`.

### The token families the prism adds

| Family                                                    | Is                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--color-ground`                                          | The opaque page colour under the light. Also what an email, the social card and the apple icon use |
| `--glow-1..3`, `--fold`                                   | The three washes and the soft folds                                                                |
| `--ray-core`, `-warm`, `-cool`, `--ray-blend`, `-opacity` | A ray's bright core and its two fringes; `screen` in dark                                          |
| `--spark`, `--veil`                                       | The glints, and the calm band where words run                                                      |
| `--ground-halo`, `--glass`                                | The faint halo on text straight on the ground (light only); a card's blur                          |
| `--color-sheet`                                           | The solid ground for anything that rides over other content                                        |
| `--read-*`                                                | The nearly solid grounds where you read in the shell (t-179)                                       |
| `--app-*`                                                 | The thinner frame grounds around the shell's panes (t-179)                                         |

The ground is painted by `components/app/ui/prism-ground.tsx`, mounted once per
consumer frame — `app/(public)/layout.tsx` ([row 6](./divergences.md)) and the
gate page as `site`, the shell's layout as `app` — and never under `/admin`.
`<body>` carries `--color-ground`, so the canvas is the ground and the light
paints over it at `z-index: -1`, behind every frame without the frame needing a
z-index. The frames that mount it drop their own `bg-background`, which is glass
now.

**Not yet lit:** the `(auth)` and `(protected)` pages — sign-in, `/profile`,
`/settings` — sit behind Sunrise's layouts, whose wrappers paint
`bg-background`. They get the prism's palette over the flat ground and no light.
Lighting them means mounting the ground in two more Sunrise files; that is a
call for whoever brings those pages into the prism, not something to slip in
here.

### Four rules in the stylesheet that are not tokens

- **The page is the ground.** `[data-surface='consumer'] body` paints
  `--color-ground`, because `globals.css` paints `<body>` with
  `--color-background`, which is glass — and glass over nothing is white.
- **A dialog is a sheet.** Inside `[role='dialog']` and `[role='alertdialog']`
  the three glass tokens point at opaque ones, so a dialog's `bg-background`
  never shows the page through it. The prototype's rule that anything riding
  over the panes is a solid sheet, reached by role rather than by class.
- **A card is glass.** `.bg-card` takes `backdrop-filter: var(--glass)`. Only
  cards: a backdrop filter makes an element the containing block for its fixed
  descendants, and `bg-background` is the ground of whole frames.
- **A site page never scrolls sideways.** The site's `<main>` is
  `overflow-x: clip` (t-178). The bands and the dusk sky run the width of the
  window from inside the page's measure, drawn `100vw` wide, and where a
  scrollbar takes up room `100vw` is wider than the page. `clip`, not `hidden`,
  so no scroll container is made and the sticky elements keep working.

The halo is keyed to the site's ground (`[data-prism='site'] ~ main …`, the
ground being mounted just before each site frame's `<main>`), so the shell's
text, which sits on panes, carries none.

The bubble in `components/app/ui/tipped.tsx` is portaled to `<body>` for the
same containing-block reason: the shell's nav and rail are `bg-card`, so glass,
and a `fixed` bubble inside them would be placed against their box.

Anything that rides over other content paints `--color-sheet` directly when it
is not a `role="dialog"`: the entry bloom's cover, the nav drawer below 900px,
the usage plot's average chip and the halos round the mission ripple's marks.

### Where the prism's values are not taken

Every one measured, and recorded at its site in the stylesheet or the module:

- **The dark sparks are transparent**, not `rgba(255, 228, 196, 0.65)`. A spark
  screened onto the umber is a near-white point; where one sat behind words,
  muted text measured 1.01:1 with the spark drawn over the veil, as the
  prototype draws it, and still 3.15:1 had it been drawn beneath the veil, and no dimmer spark closes it (a
  tenth of its strength still measured 4.40). The sparks sit at 5% and 94% of
  the viewport, which below about 1400px is exactly where a line of text
  begins. In light a spark only raises dark text's contrast, so it stays.
- **The site veil is keyed to the reading column**, not to the viewport's 20–80%
  band. With the prototype's band, the first and last words of a line sit
  outside the veil on every screen between a phone and about 1400px, where links
  measured 4.21:1 in light and muted text 1.82:1 in dark. The veil is now full
  across the 1180px column and fades in the 120px outside it, so on a wide
  screen the light is still luminous at the edges, as drawn. The shell keeps the
  prototype's band at a quarter strength, because its panes carry the text.
- **The lotus does not move in dark.** The prototype restates the ripple and the
  vein for dark mode; the still marks are baked once
  ([below](#the-lotus)), which is safe only because the lotus tokens are
  mode-invariant. The cinema ink is not restated in dark either: a cinema is
  dark in both themes.
- **Tokens the prism does not carry are derived and measured**, each recorded
  at its token: `--color-input` (`rgba(31, 26, 28, 0.52)` / `rgba(234, 219, 205,
0.52)`, 3.29 and 3.24 at their tightest), `--color-ring` (the secondary ink,
  5.47 and 5.69), `--color-secondary-hover` per theme, `--color-destructive`
  (`#AA5751`, the status red three points darker, 4.76 under its label) and its
  hover, `--color-selected` (`#7E6982`, the heather three points darker, 4.72),
  the info blue (unchanged, re-measured), and the cinema's scrims and lines
  retinted from deep water to dusk.
- **The fills move between themes**, as the prism draws them, so the hover rule
  is now "each theme's hover is darker than that theme's fill" rather than "the
  hover holds across both". The destructive and selected fills still hold.

## Contrast over the light

The prism has no single ground colour. The page is lit, its grounds are glass,
and the colour behind a word depends on where on the screen it is. So every
contrast ratio in this palette is a **worst case over the lit ground**:

1. Build every colour the ground can paint at one point, from the tokens, in the
   order `prism-ground.tsx` stacks them: `--color-ground`, then at most one glow,
   the fold or not, at most one edge of a ray (core, warm or cool, at
   `--ray-opacity`, screened in dark), the veil or not, a spark or not. Each
   layer is at its **peak**. That over-states the light — the three glows never
   peak at one point, and a ray's own blur softens its core — so a ratio that
   clears here clears on the page.
2. For a glass ground, composite the token over each of those colours. An
   opaque ground (the popover) is itself.
3. Take the **lowest** ratio of the ink over all of them.

Text straight on the ground is measured **inside the veil only**, because the
ground keys the veil to the reading column; glass surfaces are measured with
the veil on and off, because a card can sit anywhere.

`tests/unit/app/brand-theme.test.ts` reproduces this from the stylesheet, so a
token edited to something that fails is caught there. Measured worst cases, body
text (`--color-foreground`), secondary text (`--color-muted-foreground`) and
links (`--color-secondary-ink`):

| Ground                   | Light body | Light muted | Light link | Dark body | Dark muted | Dark link |
| ------------------------ | ---------: | ----------: | ---------: | --------: | ---------: | --------: |
| Bare ground, in the veil |       9.91 |        5.92 |       5.60 |      7.44 |       4.67 |      5.76 |
| `--color-background`     |      10.03 |        5.99 |       5.66 |      8.37 |       5.26 |      6.48 |
| `--color-card`           |      10.75 |        6.42 |       6.07 |      7.35 |       4.62 |      5.69 |
| `--color-muted`          |       9.70 |        5.79 |       5.47 |      7.46 |       4.69 |      5.78 |
| `--color-popover`        |      11.66 |        6.96 |       6.58 |      9.46 |       5.95 |      7.33 |
| `--read-background`      |      10.84 |        6.47 |       6.12 |     10.20 |       6.40 |      7.90 |
| `--read-card`            |      11.88 |        7.09 |       6.71 |      9.20 |       5.78 |      7.12 |
| `--read-muted`           |      10.51 |        6.27 |       5.93 |     10.62 |       6.67 |      8.23 |

The tightest is dark secondary text on a card, 4.62, under a ray's core over the
warm glow with the veil off.

### The shell (t-179)

The shell is glass in three tiers, as
`.context/app/planning/design/prism/app.html` draws it, and each is a
re-scope of the three glass tokens in `app/brand-theme.css`:

- **The frame** — the nav, the topbar, the rail — takes `--app-*`, thin, so
  the light comes through it. Keyed on the siblings of the shell's
  `<PrismGround variant="app">`.
- **Where you read** — the conversation and the workspace — takes `--read-*`,
  nearly solid. Keyed on their `data-pane`.
- **Anything riding over the panes** is a solid sheet: every drawer is
  `role="dialog"`, and the small-width nav drawer and the page layer over the
  conversation paint `--color-sheet` themselves.

Inside the shell the veil is at a quarter, so these are measured with the veil
off and at that strength (read from `prism-ground.module.css`):

| Ground              | Light body | Light muted | Light link | Dark body | Dark muted | Dark link |
| ------------------- | ---------: | ----------: | ---------: | --------: | ---------: | --------: |
| `--app-background`  |       8.78 |        5.24 |       4.96 |      7.41 |       4.66 |      5.74 |
| `--app-card`        |       9.78 |        5.84 |       5.52 |      7.43 |       4.67 |      5.75 |
| `--app-muted`       |       8.38 |        5.01 |       4.73 |      7.38 |       4.64 |      5.72 |
| `--read-background` |      10.84 |        6.47 |       6.12 |     10.18 |       6.40 |      7.89 |
| `--read-card`       |      11.86 |        7.08 |       6.69 |      9.17 |       5.76 |      7.10 |
| `--read-muted`      |      10.50 |        6.27 |       5.93 |     10.64 |       6.68 |      8.24 |

**The dark frame is a measured deviation from the prototype.** At its
`0.58 / 0.66 / 0.48` a screened ray core shows through strongly enough to take
muted text to 4.13, 3.88 and 3.49:1, and links on the muted ground to 4.30. The
shipped alphas (`0.66 / 0.81 / 0.68`) are the least that clear 4.6 for all
three inks — the margin `--color-input` keeps. The light frame is the
prototype's, and clears.

**What the method does not cover:** the halo (it only helps, and is not
measured).

### The temporary tint picker (t-180)

While Lelañea chooses her light, `LELANEA_TINT_PICKER=true` shows a picker on
every consumer page offering other tints of the prism, in both themes. A tint
moves only the ground, the glows and the fold (`components/app/ui/tints.css`),
and each one is measured over this same model by
`tests/unit/components/app/ui/tints.test.ts`, so none is offered that fails
4.5:1 for text or 3:1 for a control's boundary and focus ring. Four light tints
(Pearl, Blush, Lilac, Honey) have their folds thinned for it: at the
prototype's weight, destructive text on the shell's `--app-muted` fell to
4.30–4.48. The flag is off by default and production never sets it. t-181 writes
her choice into this file as the defaults and deletes the picker; the list of
what goes is in `components/app/ui/tint-picker.tsx`.

## The three contrast rulings (t-18)

> These rulings were made on the teal palette, and the values and ratios quoted
> in this section and the next are that palette's. The mechanisms all carry
> into the prism — a control boundary that is not the hairline, a ring on the
> secondary ink, a destructive fill darker than its named hue, an ink role
> separate from the fill, hover tokens — and the prism's own values and
> measurements are [above](#contrast-over-the-light).

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
fix serves both. **t-2 landed it** — see "Every filled variant hovers to a
token" below.

**One thing this does not fix, and no colour could.** `components/ui/button.tsx`
draws `ring-1` with no `ring-offset`, so a focused button's ring sits flush
against its own fill. Its outer edge still meets the page ground at 4.91:1,
which is what you perceive on the orange and terracotta fills — but `secondary`
_is_ this teal, so a focused secondary button just grows a pixel in its own
colour. The same arithmetic as the switch closes off every alternative:
lightness at most 0.258 to clear the ground, at least 0.561 to clear a fill.
This is a **missing mechanism — an offset — not a wrong value**, so it belongs
to the component rather than to the palette. **t-2 landed it** in
`components/app/ui/button.tsx`, as an offset `outline` rather than the
`ring-offset-2` that `Badge`, `Switch` and `SelectTrigger` use — see "The focus
indicator is an outline" below.

Every number above is **measured from the stylesheet** by
`tests/unit/app/brand-theme.test.ts`, which composites the `rgba()` boundary
tokens over each ground rather than reading their channels raw — read raw, an
invisible hairline measures as though it were opaque and every assertion passes
while nothing is on screen. The guards pair each token against a **page
ground**, which is what 1.4.11 governs; the two adjacencies above — off-track
against on-track, ring against fill — are deliberately not asserted, because
neither is reachable by choosing a colour and a permanently failing assertion
for an accepted trade is noise.

## What the components needed that the palette did not have (t-2)

t-18 closed three gaps and named two it could not reach, both of them mechanism
rather than colour. Building the seven kit components under
`components/app/ui/` is what made them live, and turned up two more.

### The focus indicator is an outline, not a ring

`components/app/ui/button.tsx` and `chip.tsx` draw
`focus-visible:outline-solid outline-2 outline-offset-2
outline-[var(--color-ring)]`, and suppress the `ring-1` they inherit.

**An `outline` rather than `ring-offset-2`**, which is what `Badge`, `Switch`
and `SelectTrigger` use and would also have worked. `ring-offset` _paints_ the
gap, in `--color-background` — so a button on a card or inside a popover gets
two pixels of oyster that is not the colour underneath it. An outline leaves
whatever is actually there showing, so one class is correct on all four grounds.

**`outline-solid` is load-bearing and is the silent half.** shadcn's base
carries `focus-visible:outline-none`, which in Tailwind 4 sets
`outline-style: none` — an `outline-2` inherited beside it is two pixels of
nothing. `tailwind-merge` drops it only because `outline-solid` is in the same
group and comes later. Nothing about that is guaranteed by a type, so the
component tests assert the resolved class list rather than trusting it.

### Every filled variant hovers to a token

`--color-secondary-hover` and `--color-destructive-hover` join
`--color-primary-hover`, and all three **hold across both modes**. An alpha of a
fill composites against whatever is behind it, so it lands on a different colour
on every ground and cannot be measured at all; a token is a known colour.

| Fill        | At rest | On hover | Hover fill |
| ----------- | ------- | -------- | ---------- |
| primary     | 4.54:1  | 5.09:1   | `#9C5130`  |
| secondary   | 4.91:1  | 5.65:1   | `#15677E`  |
| destructive | 4.68:1  | 5.15:1   | `#9F4C42`  |

All three dim by the same 2.75 points of lightness, so every hover measures
**above** its resting value. The test asserts that direction as well as the 4.5
threshold — a hover that deepens can only improve a label's contrast, which is
what stops a later edit clearing the bar with a value that lifts off the fill.

**`--color-primary-hover` no longer inverts in dark mode, and that is a
correction.** t-1 restated it as §6.5's `#B5633B` under `.dark`. But `#B5633B`
is §6.2's _pressed_ step of the **ceremonial** `#C96F43`, and the fill is
`--color-primary` — a darker step of that same orange, chosen precisely because
`#C96F43` cannot carry oyster text. Applied to the fill it made hover **lighter
than rest** and took the label to **3.84:1**. This is the same confusion t-18
resolved between the destructive fill and the destructive ink, one token along:
§6.5's "lightens by about 6% in dark" governs _surfaces_ — the pill wash and
shadcn's `accent`, which both still do exactly that — and a ceremonial fill
carrying a label is not one of those. Nothing consumed the token before t-2, so
the correction regressed nothing.

### A fifth status hue, and a selection fill

**`--color-status-blue`** is §6.2's info steel slate blue. The palette named
four status trios and §6.2 names five; nothing had consumed the fifth until
`Banner`'s `info` tone. It joins as a `-bg`/`-ink` trio like its siblings rather
than borrowing the teal, which is a brand colour with a job (§6.2 gives teal and
aqua the active states) and would have made an informational banner look like
something you could act on.

Its ink is measured **on the wash, not on the ground** — the distinction t-18's
third review round caught. `#A3C2DC` measures 5.61 against the bare dark muted
ground and **4.31** once the wash is over it, so the dark ink is `#B0CBE1`
(4.76 at its tightest) and the light ink `#33567A` (5.27).

**`--color-selected`** is a fifth deviation from a §6.2-named colour, and the
fourth time this palette has made the same move. Heather amethyst `#806C7B`
carries a label at **4.25:1**. The fill is that hue three points of lightness
darker — `#786573`, 4.73:1 — and the named amethyst survives as
`--color-status-purple`. It is a token of its own rather than the status one
because the status hues **lighten in dark mode** for badge use, which is the
exact trap that put oyster on the status red at 2.99:1 before t-18.

### The lotus has its own thirteen values

`--color-lotus-*` names the three petal colours and the outer edge, the vein,
the heart's two stops and its glint, two ripple steps, the halation, and
(t-134) the lily pad and its edge — iris and rose-gold since the prism (t-177),
teal and orange before it. Their roles are named nowhere but the lotus model.

They exist so the no-colour-literal guard over `components/app/ui/` can be
**absolute**. The alternative was exempting the lotus — the one part of that
directory that would most have needed the guard — and an exemption is a hole
that widens.

**They are deliberately not wired to `--color-secondary`**, though the outer
petal is byte-identical to it today. Those are UI roles that can be re-tuned for
contrast: t-18 moved `--color-ring` onto the teal, and a later pass could move
the teal itself. The bloom must not follow it. Same colour, different reason to
exist — and they hold across both modes, because a mark is not a surface.

## The lotus

The owner's choice from t-131's prototypes (3 Oct 2026, "T5"; decision on
f-identity): a water lily drawn from a 3D model — four sepals and four whorls
of slender pointed petals, opening from a pointed bud around a crown of orange
stamens, on lily pads and sage ripples — in the mark's teals, retinted in the
prism (t-177) to iris around a rose-gold heart, on dusk. It supersedes
§6.9's flat three-tier fan.

| Piece     | File                                | Does                                                                                       |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Model     | `components/app/ui/lotus-model.ts`  | Petal surfaces, whorls, timing, light. `LOTUS_OPENED_MS` is derived.                       |
| Draw list | `components/app/ui/lotus-draw.ts`   | The flower at a moment as flat shapes in paint order, rounded so server and browser agree. |
| Colour    | `components/app/ui/lotus-colour.ts` | Colours as token expressions; read as `color-mix()` CSS, or mixed in JS in the same OKLab. |
| Painters  | `lotus-svg.tsx`, `lotus-canvas.ts`  | SVG for still states, canvas for the animation.                                            |
| Frames    | `components/app/ui/lotus-frames.ts` | GENERATED: the measured frames, so nothing measures at runtime.                            |
| Assets    | `scripts/app/lotus-assets.tsx`      | Bakes every still copy with tokens resolved to literals.                                   |

**Animated `Lotus`: a baked image at rest, a canvas while moving.** Rebuilding
~240 shaded gradient bands through React every frame measured ~28fps in t-131;
a canvas repaint is a few milliseconds. At rest — the bud, and the open bloom —
it shows `public/lotus-anim-*.svg`, baked in the animation's own frames so the
canvas lines up with them exactly, and the open image loads under the canvas
while it plays. Every path that skips the animation (reduced motion, no 2D
context, no JavaScript) still shows a correct lotus. No page plays it now:
the landing hero and the app's entry bloom are the flower drawn in light
(below).

**The 3D model's still marks remain for what cannot run a canvas.** The
half-open GLYPH (the bloom caught 850ms into its opening) is the favicon
(`app/icon.svg` and `app/favicon.ico`, divergence row 13) and the apple icon,
and `public/lotus-mark.svg` is the social card's flower and the email header.
On the page itself `LotusMark` is the flat lotus drawn in light since t-183.

**After changing the model or any `--color-lotus-*` token, run
`npm run lotus:assets`.** It rewrites `lotus-frames.ts`, the three marks and
the four animation stills in `public/`, the email PNG, the favicons and the
apple icon.
`tests/unit/scripts/app/lotus-assets.test.ts` and `lotus-draw.test.ts` fail
until you do.

### The lotus drawn in light (t-182)

On the home page's hero and closing blooms the flower is drawn as points of
light (`DotLotus`, a port of the prism prototype's "DOT LOTUS" script). It
is the prototype's flower, not the 3D model's: the flat, front-on lotus of
three petal rings that the prototype reads its petals from. Its paths and
angles are `PETALS`, and the SVG itself is `public/dot-lotus.svg`. A test
holds the two together. Each ring unfurls from upright, outer ring first, as
the prototype's does. Then it beats:
lub-dub, a ring of dots across the pond on each beat, stars let go from the
petal tips, and loose light drifting to the page's edges. The pond's rings
are the flower's own, which is why the hero water and the CSS rings are gone.

| Piece    | File                                      | Does                                                                       |
| -------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Geometry | `components/app/ui/dot-lotus-geometry.ts` | Where each dot sits, the seed head, occlusion, and the timeline. Pure.     |
| Painter  | `components/app/ui/dot-lotus-paint.ts`    | Sprites from the `--dot-*` tokens, the moving light, and the loop's clock. |
| Mount    | `components/app/ui/dot-lotus.tsx`         | Canvas over the flat `/dot-lotus.svg`; pauses off-screen and when hidden.  |
| Mark     | `components/app/ui/lotus-mark.tsx`        | The small mark: solid `/dot-lotus-mark.svg` with the light laid over it.   |
| Strap    | `components/app/ui/dot-lotus-strap.tsx`   | The strapline the hero's flower writes on its water.                       |

**It is also the app's entry bloom** (t-183), on every full page load
(t-132). The cover lifts when the flower's own clock reaches `OPENED_AT`
(`onOpened`), once the last dot has arrived and the first heartbeat is
landing. That clock stands still in a hidden tab, so a bloom opened in the
background is still there to see. The glow is the canvas's own, at the heart, so
the cover carries none. Reduced motion is shown the open flower, still, and
the cover goes at once.

**The small mark keeps solid petals** (t-183, the prototype's mini lotus). At
30px a dotted outline reads as speckle. So `LotusMark` shows the flat flower
cropped close (`MARK_VIEW`), and its canvas draws only the energy: the heart's
glow and beat, flares at the petal edges, and a few larger dots streaming out
(`MARK`). There is no pool, no pond and no drift, and it is dotted far more
sparsely (`MARK_FORM`). Pointing at the link it sits in replays the unfolding.
The agent's mark beside each reply passes `light={false}`. It repeats down a
conversation, and a column of hearts beating out of step is noise. The mark
is decorative, so the link around it carries the name.

**The strapline is written on the water** (t-184): an arc of wide-spaced
italic along the front of the hero's pond. Each letter condenses out of the
light as the flower finishes opening, flares (`--strap-flare`) and settles to
cream (`--strap-ink`). The tokens are set only where the flower is drawn as
light. A click on the flower writes it again with the unfolding. The letters
run only while the flower's clock runs (`data-playing`), so a slow
hydration, a flower off screen or a hidden tab does not write them over a
closed flower. Where no canvas paints there is no clock to wait for, and
they are shown settled. Below 760px wide the letters are smaller, so the ends of the
arc stay on a phone's screen. Reduced motion and no script show
them settled. The arc is `aria-hidden`; the hero's caption stays in its place
above the heading, visually hidden, so the words are read once. Both read
`STRAPLINE` (`lib/site/config.ts`), and the social card does too.

**`--dot-*` move with the theme; `--color-lotus-*` do not.** The dots are
painted live and never baked, and light reads as light only on dark. So the
pale page draws them as ink with a small halo, and the umber adds them
together as glow. They are read from the flower's own element. That is how the
hero's dusk sky (`data-dot-ground='sky'`, light mode only) gives its flower
the dark palette with paler petals.

**Reduced motion shows the open flower, still**: one frame, nothing scheduled.
The flat SVG stays under the canvas, transparent from the first paint wherever script runs (so the solid flower never flashes before the dots), and is never removed.
It is the picture wherever no 2D context paints, and a flower given a `label`
keeps it in the accessibility tree. Both home blooms are decorative.

## The destructive token has two roles, and only one rule separates them

> The ratios in this section are the teal palette's; the prism's are in the
> stylesheet at the rule and measured by the test. The mechanism is unchanged.

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
then the app follows OS theme changes live. That is decision D4. Getting there
first meant changing two Sunrise files; since Sunrise 0.16.0 (Daybreak 0.9.0)
the persistence fix is upstream's, and what we still carry is the hook's third
state, "follow my device" — [row 2](./divergences.md) explains what and why.
