---
name: shell
description: The four-column app shell at /app — its panes, its one state provider, how a view is added, and the four rules that are easy to break without anything failing.
---

# The shell

`/app` is the product. Everything a signed-in person does happens inside a
full-height frame of four columns, and §05 onward fills its panes rather than
replacing it.

This is what §04 built. Read it before adding a view, changing a breakpoint, or
putting anything new above `/app` in the route tree — the last of those is the
one that breaks something silently.

## The frame

```
┌──────────┬───────────────────────────────────────────────────┬──────┐
│          │ topbar                                            │      │
│   nav    ├──────────────────────────┬────────────────────────┤ rail │
│  234/64  │   conversation  330–660  │   workspace            │  70  │
│          │                          │                        │      │
└──────────┴──────────────────────────┴────────────────────────┴──────┘
```

| Piece        | File                                                  | What it is                                                             |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Layout       | `app/(lelanea)/app/layout.tsx`                        | Session + acknowledgement gate, maintenance wrapper, `h-dvh` frame     |
| Nav          | `components/app/shell/shell-nav.tsx`                  | Five destinations + the account menu; 234px, or 64px slim              |
| Account menu | `components/app/shell/account-menu.tsx`               | The footer's popover: account, settings, usage, admin, theme, sign out |
| Topbar       | `components/app/shell/shell-topbar.tsx`               | 58px; `recently`, and ≤900 the burger and the pane switch              |
| Panes        | `components/app/shell/panes.tsx`                      | Holds both middle columns, the swipe gesture, and the view's tone      |
| Conversation | `components/app/shell/conversation-pane.tsx`          | Resizable 330–660, folds at 296 to a 56px strip                        |
| Workspace    | `components/app/shell/workspace.tsx`                  | Where the route's view renders                                         |
| Rail         | `components/app/shell/shell-rail.tsx`                 | Map and Resources, as buttons that open the drawers                    |
| Drawers      | `components/app/shell/drawer.tsx`                     | Rendered **inside `Panes`**: under the topbar, clear of the rail       |
| Chrome       | `components/app/shell/chrome.ts`                      | One radius for every icon highlight, so four of them cannot drift      |
| Focus traps  | `components/app/shell/focusable.ts` + the two drawers | One shared `FOCUSABLE` selector, so both traps hold the same list      |
| Entry bloom  | `components/app/shell/entry-bloom.tsx`                | The lotus, once per session (`sessionStorage`, `lelanea.bloom.seen`)   |
| Tooltip      | `components/app/ui/tipped.tsx`                        | The bubble on any icon-only control; never fires on touch              |

Its own route group, because `app/(protected)/layout.tsx` is a header over a
single `container mx-auto` main — a centred document column, which is the
opposite shape. `/profile` and `/settings` stay behind that frame on purpose and
the account view links out to them.

**Seams §04 filled**, both pinned in `tests/unit/lib/app/defaults.test.ts`:
`lib/app/protected-routes.ts` (`['/app']`, or the edge never bounces signed-out
visitors) and `lib/app/auth-landing.ts` (`'/app'` + the label `Lelañea`, which
login, OAuth, signup, invite, verify and the header brand link all follow).

## Three widths

`use-shell-layout.tsx` classifies on `window.innerWidth`, and almost nothing
about the shell is checkable from a screenshot of one width.

| Class    | Range    | What changes                                                                                                                            |
| -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `small`  | ≤ 900    | Nav becomes a drawer; the panes are a carousel with a pane switch in the topbar; the right rail becomes two full-width keys in a footer |
| `medium` | 901–1240 | The conversation is an absolutely-positioned panel over the workspace                                                                   |
| `large`  | > 1240   | Both panes are in flow, side by side                                                                                                    |

A fourth threshold, **1100**, is not a width class: crossing _inward_ past it
auto-slims the nav, and crossing back out releases the override. It is keyed on
the crossing, not on every resize event.

`tests/unit/components/app/shell/render-shell.tsx` is how a shell component is
rendered in a test, and its `width` argument **defaults to `large`** (1400).
That default exists because `happy-dom` reports 1024 — inside the medium band,
and below the 1100px auto-slim threshold — so inheriting the environment would
make every unstated test a tablet test against a collapsed nav.

Name the width whenever the case is _about_ a width. `renderInShell(ui)` is a
1400px test, not a neutral one.

Its `rerender` re-wraps into the **same** provider instance, which is the only
way to test a client-side navigation: the route changes while the provider
lives on. That is the exact shape of the `wsOpen` trap above — state left over
from the route you came from — and re-rendering into a fresh provider resets it
and proves nothing.

## The state is one provider

`components/app/shell/use-shell-layout.tsx`. One, not several, because
`fitToWidth()` reaches across all of it in a single pass: one resize can slim the
nav, clamp the chat width and switch the visible pane together.

**Anything that depends on the viewport width, or on which pane is showing,
belongs there.** Anything that does not, does not — the tone is the worked
counter-example below.

### `wsOpen` is derived from the route

```ts
const wsOpen = pathname !== '/app';
```

So the workspace closes by **navigating**, and the URL and the frame can never
disagree — including on a back press. A button calling a setter would be a second
source of truth for something the URL already knows.

**The trap, and it has already cost a round:** `wsOpen` is a _boolean_, so an
effect keyed on it does not re-run when the router moves between two module
routes. Key on `pathname`.

### The Escape chain

One ordered walk rather than independent handlers, which would race. Each rung is
"the most recently opened thing that is covering something":

1. the ≤900 nav drawer
2. a map/resources drawer
3. at medium, park the conversation panel
4. un-fold a folded conversation, anywhere but medium

The account menu sits above rung 1 without being in the walk: Radix dismisses it
on Escape in the capture phase, and the menu stops the event there so the drawer
under it stays open. See [the account menu](#the-account-menu).

## The left menu opens and closes five ways, and two of them persist

| Gesture                          | Direction | Where                | Writes `lelanea.nav.slim` |
| -------------------------------- | --------- | -------------------- | ------------------------- |
| the collapse control, at the top | both      | above 900px          | yes                       |
| a press on the menu's dead space | both      | above 900px          | yes                       |
| a press out in the panes         | closes    | above 900px          | no                        |
| Ask Lelañea opening / parking    | both      | `medium` + workspace | no                        |
| crossing 1100px inward           | closes    | —                    | no                        |

The split is about **what the press was aimed at**. The first two are a reader
working the menu; the rest are the layout getting out of the way for a moment,
and persisting any of those silently rewrites a choice somebody made on purpose
(divergence Row 2's rule, which now has three callers rather than one).

A press on any control — a link, a button, the separator — does none of it, or
using the app folds the menu as a side effect. Same guard list `workspace.tsx`
uses for its re-park gesture. **And nothing at all while a drawer is open**: the
scrim is a bare `<div>` and a panel's own dead space is not a control either, so
without that guard dismissing the map by clicking its scrim also collapsed the
menu behind it. A press inside an `aria-modal` dialog must not reach the shell it
is covering.

**Ask Lelañea and the menu are mutually exclusive where they compete**, and that
rule lives in `use-shell-layout.tsx` rather than in the two components — two
components each reaching for the other's setter is one rule written twice, and
the second copy is the one that rots.

"Where they compete" is the rule, not a caveat on it. At `medium` with the
workspace open the conversation is a fixed 420px panel riding over the work while
the menu is a 234px column in the flow, so the two eat the same screen from the
same end. At `large` both panes are in the flow and the reader sizes the
conversation with the handle; at `small` the menu is a drawer and the panes are a
carousel. Applied everywhere, this folded the conversation to a 56px strip when
somebody expanded the menu on a 1600px screen.

It also **releases** the override when the conversation is parked again, rather
than only setting it. Otherwise the sole thing that ever cleared it was `fit`'s
outward 1100px crossing — which at a fixed window width never happens, so opening
the conversation once left a reader with a collapsed menu for the session.

### The width transition is unconditional, and the startup correction is what moves

`shell-nav.tsx` used to arm its width transition only after a reader had used
the collapse control. That hid a real problem and created two others: the first
collapse had nothing to transition from (the flag and the width landed in one
commit), and the auto-slim never animated at all.

The real problem is that `useLocalStorage` adopts its stored value in a plain
effect, **after paint** — so a reader who had chosen the slim menu watched it
render at 234px and correct on every page load. The provider now adopts that
preference in a **layout effect**, declared before `fit` so the auto-slim still
wins under 1100px. Nothing to animate away from, so the transition can simply
always be on.

## The tone

Each destination carries a hue saying which part of the arc it belongs to.
`components/app/views/view-tone.ts` is the table; every value is an existing
palette token.

**It is published on `Panes`, not on `Workspace`.** A custom property inherits
downward only, and the conversation pane is a _sibling_ of the workspace — so
publishing it there left the conversation's slid-over panel edge permanently teal
while the band on the other side of the screen was green. `Panes` is the common
ancestor of both. Two docblocks asserted the fix before it was true.

A route with no entry publishes nothing and the band stays transparent. That is
`/app` itself: the clean conversation belongs to no part of the arc, and a
visible default there was a defect in t-10.

**The tone paints the band, not the view's eyebrow**, which the prototype tints.
Measured **in light mode** against `--color-background`, `--color-accent-ink`
reaches 3.17:1 and the raw `--color-status-yellow` 2.03:1 — both under AA for
12px text.

The qualifier matters: dark mode lightens the status hues, so
`--color-status-yellow` gets to 7.25:1 there and passes comfortably. A reader
who re-measures in whichever theme they happen to be in, and finds the number
fine, has an argument for restoring the prototype's eyebrow tint — which is the
outcome this paragraph exists to prevent. The rule is set by the worse theme,
and tinting four of the six would leave one that reads as an oversight and gets
"fixed" back.

### Coloured type is a different table from coloured surface

The paragraph above was read once as "nothing in the shell is ever tinted", and
that was too strong — it cost the map drawer the design's five named arcs, which
became a muted list with dots beside it. **Both halves of the rule matter: the
raw hue never carries type, and the palette ships a token that does.**

Every status hue has an `-ink` sibling that flips per theme precisely so it can
be set in type. `TIER_INKS` in `map-drawer.tsx` names the five arcs in those,
with the measured numbers at its declaration. There is deliberately **no**
second table of raw hues beside it: one stood there while the bullet existed,
and the moment the bullet went it had no caller and a docblock saying the
opposite of this. If something ever needs an arc's hue on a surface, where
contrast does not arise, it comes back then with the caller that wants it.

The one to notice is the orange arc: `--color-accent-ink` is the ceremonial
burnt orange and **holds across both modes**, which is exactly why it cannot
carry a label — 3.17:1 light and 3.92:1 dark, failing in _both_.
`--color-primary` is the obvious substitute and fails dark at 2.72:1. The arc
takes `--color-status-red-ink`, the same terracotta family, which the stylesheet
describes as where §6.2's hue is read as a colour rather than sat on.

The view's eyebrow in the workspace head is still untinted, and for the original
reason.

## Where the reader is, and the one thing the shell cannot work out

The conversation column's way back reads `← the main conversation · on 01 ·
Values`. The shell can name a **nav destination** on the first render —
`SHELL_NAV` is static and client-side — and cannot name a **module** at all: the
authored number and title are on the server, and a module page renders _inside_
the workspace, which is a sibling of the conversation. Context flows downward
only.

So the page publishes it: `RememberModule` sets `modulePlace` on the provider,
alongside the slug it already remembers for the Workspace nav item.

**The provider withholds the label while the published slug and the route
disagree.** A page publishes from an effect, so between asking for a module and
that effect running, the shell still holds the previous one — and showing it
tells the reader, confidently, that they are somewhere they have just left. The
stale frame renders nothing instead.

This is the same mechanism "Adding a view" below rules out for the workspace's
own header, and that ruling stands: what goes missing for a frame here is a
muted suffix beside a link that is already correct, not the page's heading.

## Adding a view

1. **A route** under `app/(lelanea)/app/<name>/page.tsx`. Thin: `metadata`, and a
   `<View>`.
2. **`metadata.title`** matching the nav item's own words, as a plain string — a
   `{ absolute }` or `{ template }` object defeats the layout's `%s`.
3. **`<View eyebrow title lede? note?>`** from `components/app/views/view.tsx`.
   It owns the `<main>` and the `<h1>`; the shell has neither, so a reader had no
   landmark to skip to and no heading naming the page until it existed.
4. **A `VIEW_TONES` row**, or the band stays transparent and it looks unstyled.
5. **`<PlaceholderCard>`** for anything not built, rather than new markup — see
   D6 below.
6. **A row in `tests/unit/app/shell-view-pages.test.tsx`'s `MODULES` — but only
   if the view is a nav destination.** That test asserts `MODULES`' keys equal
   `SHELL_NAV` plus `/app/account` exactly, so a nav item without a page fails
   there rather than in someone's browser — and a view that is NOT in the nav
   fails it just as hard for having a row. §05's modules under
   `/app/modules/<slug>` are the first of that kind, so they belong in a test
   of their own rather than in this list — `tests/unit/app/module-page.test.tsx`.

The view's eyebrow and title render **inside** the scroll body, not in the
workspace's fixed header. The prototype's `wsHead()` writes above the scroll
container; reproducing that here would mean the title travelling up from a server
page to a client component two levels above — a context set from an effect (a
frame of empty header on every navigation) or a `@head` parallel-route slot (a
second file per destination). Neither is worth a sticky title. The tone cannot be
done that way and so is not.

## A view that reads about the reader must guard itself

`app/(lelanea)/app/layout.tsx` checks the session — and, since §06, the
acknowledgement gate (see [`gateway.md`](./gateway.md)) — and **a layout is
not re-rendered when the router moves between sibling pages inside it.** So
those checks gate _entry to the shell_, not each view.

That was harmless while every page under it was a static placeholder, which is
what t-9 shipped. `app/(lelanea)/app/account/page.tsx` is the first that is not: it renders a name,
an address and a join date, so it calls `getServerSession()` itself and
`clearInvalidSession('/app/account')` when there is none.

**§05 and §06 will add more of these.** Any view rendering something about the
reader — progress, a journey, an acknowledgement — fetches the session where it
reads, rather than inheriting a check that may have been made under a session
since revoked. `proxy.ts` prefix-matches `/app` and bounces signed-out visitors
at the edge, so this is defence in depth rather than the only lock; it is also
the layer that notices a session going away _while_ someone is inside the shell.

Raised by t-9's security review, below its reporting threshold then and carried
forward on the task record (`B28`) because t-11 is where it became live.

## The account menu

Everything about the **person** rather than the work lives in one popover at the
foot of the nav: name and email · **Your account** (`/app/account`) · **Settings**
· **Usage and billing** · **Admin** (only when `role === 'ADMIN'`) · **Dark mode**
· **Sign out**. Owner ruling, 15 September 2026: Settings and Usage came out of
`SHELL_NAV` and the theme toggle came out of the topbar, so this is the one place
and not a second route to the same pages. The prototype's budget meter, when it
arrives in phase 2, will open Usage too — the meter is the glanceable control and
the row is the tidy-away; both stay.

Composed from Sunrise's `DropdownMenu` + `Avatar` + `authClient.signOut`, not
`UserButton`, which takes no props, hardcodes `align="end"` with no `side`, and
shows Admin unconditionally (`sunrise#706`, open). Identity is a **prop** from
`app/(lelanea)/app/layout.tsx` — `name`, `email`, `image` and `role` — never a
client-side `useSession()`, which renders empty on first paint.

The trigger is avatar + name, as the Hub's footer is; the email is in the menu's
header only. The avatar shows the account's picture once it has loaded and
initials in every other state — no picture, still loading, failed — so a broken
image degrades to initials, never to the browser's broken-image glyph. Nothing
had to be configured for that: `AvatarImage` is a plain `<img>` (not
`next/image`, so `remotePatterns` is irrelevant) and the platform's CSP already
sends `img-src 'self' data: https: blob:`, which covers same-origin `/uploads/`,
S3, Vercel Blob and OAuth-provider hosts alike. The row sits `pb-4` from the
bottom, level with the composer — the prototype's 52px was for space this shell
does not use.

Radix decides picture-or-initials from `window.Image`, which happy-dom never
fires; `stubImageLoading()` in `render-shell.tsx` answers from the URL so the
tests can assert the picture rendered rather than hedge on it. The links are a
table (`ACCOUNT_MENU_LINKS`) so `shell-view-pages.test.tsx` can prove each has a
route, as it does for `SHELL_NAV`.

Worked out first in HCE Hub — its `AccountMenu` component and the
`account-menu.md` doc beside it, both in that repo (hce-hub §34, PRs #222 and
#224). What transferred and what did not:

| Same as the Hub                                                                                                    | Different here                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Hard `window.location` sign-out — for Next's client Router Cache, not the stale "nanostore" reason in `UserButton` | Lands on `/`, not `/login`: the site header shows "Log in" to a visitor, and it is where `UserButton` also goes |
| `aria-hidden` on the whole `Avatar`, so the fallback's initials do not join the button's name                      | Three trigger layouts — the 234px row, the 64px rail (avatar only, `title` = name), the ≤900 drawer             |
| Failure path: `preventDefault` on Sign out, `role="alert"` + `aria-describedby`, flag cleared on open              | `onEscapeKeyDown` stops propagation, or the layout's Escape chain closes the drawer under the menu              |
| Dark mode as a `DropdownMenuCheckboxItem`, no leading icon, `preventDefault` so the repaint is visible             | Content is `z-[70]`: the drawer panel is `z-[60]` and Sunrise's `z-50` portal opened _behind_ it                |
| Tests render the real `ThemeProvider`                                                                              | Rows close the drawer behind them (`onNavigate` → `closeNav`), as a nav item does                               |

Dark mode here persists a choice exactly as the topbar toggle did; "follow the
device" (D4) stays in Settings, the page that can show all three states.

**Tests that mount `ShellNav` for another reason** now mount this too, so they
stub `@/hooks/use-theme` and `@/lib/analytics` — both throw outside their
providers. `shell-layout.test.tsx` wraps the real `ThemeProvider` and holds the
one case that proves `role` crosses from the session to the menu.

## A drawer is complementary, not modal — and the geometry is why

The design's `.rdrawer` is `position: absolute` inside `.panes`, so a panel lands
**below the topbar and clear of the right rail**. That is not decoration: in the
design's own capture the topbar is still readable and the rail button that opened
the panel is still lit. `Drawers` is therefore rendered by `panes.tsx`, not by the
shell frame, and both the panel and its scrim are `absolute` within it.

**Which means the panel is not modal, and it no longer says it is.** It carried
`aria-modal="true"` and a focus trap, and both were honest while the scrim covered
the whole shell. They are not now: the rail beside the panel is visible, undimmed
and live — pressing `Map` again is how you close it — and the topbar's theme
toggle is one Tab away and works. A dialog claiming the rest of the page is
unavailable, beside a column that plainly is, tells a screen-reader reader
something the layout contradicts; trapping Tab would make the claim true by force,
which a sighted reader experiences as the rail refusing the keyboard.

What is kept is everything that was doing real work: `role="dialog"` with its own
label, focus moving in on open and back to the opener on close, `inert` on the
closed panel, and Escape as the second rung of the chain.

**Each drawer carries its own colour**, not the view's — a 3px top rule on the
head and the eyebrow in the same hue. The design sets it per panel (`#dr-map` is
always the secondary ink), because a panel riding over the work is not part of
the work. It is one token today because both drawers are teal; when resources
starts following the open module, the rule and the eyebrow will need **different**
tokens, since a rule is a surface and an eyebrow is 12px type. See the `tone`
column in `drawer.tsx`.

## `recently` is real now, and its empty state is the point

The topbar's strip was on the D6 list because nothing opened a module until §05
and it would have been permanently empty. §05 landed: `RememberModule` records
each visit into `lelanea.workspace.recents` beside the single slug the Workspace
nav item reads, and the strip shows those.

**An empty strip and an absent one say different things.** The first tells a new
reader the app is keeping their place; the second is indistinguishable from a
feature that does not exist. So it renders the label and one quiet line — nothing
opened yet — rather than nothing at all.

The list is kept apart from `LAST_MODULE_STORAGE_KEY` on purpose. That key
answers "where does the Workspace nav item go", which is a single value with its
own meaning; a list that happened to have one entry would answer both questions
by accident, and the day the strip drops an entry the nav item would follow it.

## One radius, because four of them drifted

`components/app/shell/chrome.ts`. Every icon-only control, every nav item and
every rail button draws the same thing — a highlight behind a glyph — and each
had grown its own corner: `rounded-xl` in the nav, `rounded-[10px]` on the icon
buttons, `rounded-[14px]` in the footer, `rounded-[11px]` on a map row. Each
looked deliberate alone; together they read as a shell that could not decide.

The value is **5px**, set by the owner against the real thing after three passes
(12 → 10 → 8) each still read as too soft. It is pinned by value rather than as
"tighter than the design's 12px", because the failure worth catching is somebody
nudging it back toward a default that looks fine in isolation.

`tests/unit/components/app/shell/chrome.test.tsx` scans the directory for a
literal radius and is declared always-run in `lib/app/leaf-ci.ts`, because the
failure it catches is a **new** control arriving with a number of its own — which
no module graph reaches.

Two things stay round and are exempt: the account avatar and the composer's
filled send disc. A disc is the thing itself; a highlight is chrome drawn behind
something else, and only the second is what the constant names.

## A panel that is off screen must also be out of reach

Both drawers — the ≤900 nav and the map/resources pair — hide with `visibility`
rather than `display`, because `display: none` gives the browser no starting
style to transition from and the panel pops instead of sliding.

`visibility` changes **discretely at the end** of a transition, so for the 300ms
of a close the panel is still `visible` and everything in it is still tabbable
while sliding off screen. Both therefore also carry `inert`, which applies at
once. `drawer.tsx`'s comment asserted that `shell-nav.tsx` already did this; it
did not, until t-22 went looking for the pattern in order to write this section.

The ≤900px nav drawer still carries a focus trap, and still shares the
`FOCUSABLE` selector (`components/app/shell/focusable.ts`) with nothing now that
the map/resources panels have dropped theirs — it is a genuine modal, a fixed
panel over a scrim that covers the shell. The selector stays in its own file
because a selector that misses an element type fails in the direction that
matters: Tab escapes the panel.

## Modules render inside a swipe target

Below 900px `panes.tsx` owns a horizontal pointer gesture that switches panes,
and it ignores only `input`, `textarea` and `[contenteditable="true"]` — plus
mouse pointers, which it never captures.

So a §05 module with a horizontal gesture of its own — a slider, a carousel, a
date strip — will have its drag eaten by the pane switch on a phone, and nothing
will look broken enough to investigate. Exclude the element in `panes.tsx`
rather than fighting it with `stopPropagation` in the module, so the list of
things that are not a pane-swipe stays in one place.

## Five things that break silently

Each of these shipped at least once in §04 with every test green.

### 1. No Suspense boundary above `/app`

Next returns `200` for a **streamed** response and `404` only for one that has not
begun streaming — once the headers are out, the status cannot change. Streaming
starts when a Suspense fallback renders.

So the shell's 404 (`app/(lelanea)/app/not-found.tsx`, reached by the
`[...slug]` route that does nothing but throw) is correct only while nothing
between the root and the page suspends. It holds today because the root layout's
one `<Suspense>` wraps siblings of `{children}`, and `ppr`/`cacheComponents` are
off — the layout's own `await getServerSession()` is fine _because of_ that.

**The change that breaks it is one Next's documentation recommends**: wrapping a
layout's runtime data access in its own `<Suspense>` for instant navigation. Our
shell layout awaits a session, so it is the obvious candidate — and doing it
turns every mistyped URL under `/app` into a soft 404.

`tests/unit/app/shell-not-found.test.tsx` checks four levels for a `loading` file
in four extensions, and every layout above for a `<Suspense>` containing
`{children}`. **Do not weaken those to land a loading state.**

### 2. `tailwind-merge` deletes a conditional class

`cn()` is `twMerge(clsx(...))`, and a later class in the same group **replaces**
an earlier one. t-10 shipped three collisions where the class that lost was ours;
the source read correctly and only the resolved list knew.

Branches must be **mutually exclusive**, not merely ordered. Where a component
overrides a kit class, pin the resolved list — both what survived and what was
dropped, because "`border-dashed` is present" is equally true of a card that also
kept a solid border. See
`tests/unit/components/app/views/placeholder-view.test.tsx`.

A static scan for this is **not** worth repeating: it flagged 13, all false.

### 3. `color-mix()` in an arbitrary Tailwind class

Tailwind guards any arbitrary value containing `color-mix()` behind
`@supports (color: color-mix(in lab, red, red))` and synthesises the unguarded
rule by **stripping the mix and keeping its first colour**. The workspace head's
8% tone wash was therefore a fully saturated slab on any browser without
`color-mix`, with `text-muted-foreground` on it at roughly 2:1.

Put it in an **inline style** (no fallback synthesis: the declaration simply
drops) or in a token. Compile with the Tailwind CLI and **read the generated
fallback**, not just check the class generates.

### 4. `Panes` must render `children` on `/app` too

`Workspace` returns `null` on `/app`, so rendering the route's `children` only
inside it drops whatever the router put there on the one route every signed-in
visitor lands on — including `error.tsx`. `panes.tsx` renders them outside the
workspace in that case, in an `absolute inset-0 … empty:hidden` layer.

This is in the list because it has already shipped wrong twice, in two different
shapes: once as children rendered only inside the workspace, and once as the
pane column growing an `overflow` that stopped the frame being fixed-height. Both
looked correct until the error boundary needed to draw something.

### 5. A colour literal is invisible to the contrast tests

`tests/unit/components/app/ui/tokens-only.test.ts` scans `components/app/`
**recursively**, so a hex or `rgb()` anywhere under it fails. Every colour comes
from a token, so that `tests/unit/app/brand-theme.test.ts` can measure it —
a colour that file cannot see is a colour nobody is checking.

## What is deliberately absent (D6)

Do **not** "finish" these; they are stubs on purpose, and inventing data for them
is the specific failure D6 names.

- **Journey, life situations, share, usage** — the placeholder card, one honest
  line, and a test asserting no placeholder view renders a digit.
- **Workspace** — the landing for "no module open yet". From §05 t-14 the nav
  item resolves to the last module visited (`lelanea.workspace.lastModule` in
  `localStorage`, written by `RememberModule` on a module page) and falls back
  to this landing until one has been. See [`journey.md`](./journey.md).
- **The eleven voice leanings** — rendered as disabled sliders with the reason
  beside them. Nothing reads a leaning until a model is answering, which is
  phase 2.
- **The resources drawer's films.** `resources-drawer.tsx` builds the designed
  placeholder card and the `to watch` section, and leaves the list behind it
  empty — the films are **f-resources'**, in phase 3. A thumbnail and a duration
  pill are what an invention would look like here, so the section says it is
  empty rather than carrying two plausible films.
- **A module's real state in the map.** Every row reads `not started ○`, because
  no per-user journey exists. `open` — which the API returns — is a fact about
  the system rather than about the reader, and putting it in the column made all
  seventeen rows say the same non-word about themselves. `STATE_ROW` in
  `map-drawer.tsx` is the seam that widens.
- **The budget meter** — omitted from the topbar rather than faked.
- **The composer** — present, inert.

The account view shows the three facts the session holds and no statistics. The
prototype's version carries "Eleven sessions so far" and three counters with
nothing behind any of them; a count is the easiest invention to ship because it
reads as data rather than as copy.

## Known gaps

- **The 404's tab reads only "Lelañea."** Next resolves no `metadata` export from
  a `not-found` file, and `global-not-found.js` bypasses the layout the boundary
  exists to keep.
- **The nav can contradict the 404.** `/app/journey/typo` still marks "Your
  journey" current, because prefix matching is correct for real child routes —
  and `/app/modules/typo` marks "Workspace" current for the same reason. The nav
  cannot know the route 404'd.
- **`sunrise#769`** — rendering the nested 404 surfaces a React 19 dev-only
  warning about the platform's no-flash theme script. Confirmed dev-only against
  a production build; filed, not patched.

## See also

- [`brand-theme.md`](./brand-theme.md) — the tokens every colour here comes from
- [`divergences.md`](./divergences.md) — rows 1 and 2 touch `app/layout.tsx`, which
  the shell renders inside
- [`local-dev.md`](./local-dev.md) — including how to run a production preview on
  the test domain, which is how the `sunrise#769` diagnosis was settled
