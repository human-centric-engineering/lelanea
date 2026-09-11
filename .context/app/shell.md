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

| Piece        | File                                                  | What it is                                                           |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| Layout       | `app/(lelanea)/app/layout.tsx`                        | Session gate, maintenance wrapper, `h-dvh overflow-hidden` frame     |
| Nav          | `components/app/shell/shell-nav.tsx`                  | Seven destinations + the account footer; 234px, or 64px slim         |
| Topbar       | `components/app/shell/shell-topbar.tsx`               | 58px; the theme toggle, and ≤900 the burger and the pane switch      |
| Panes        | `components/app/shell/panes.tsx`                      | Holds both middle columns, the swipe gesture, and the view's tone    |
| Conversation | `components/app/shell/conversation-pane.tsx`          | Resizable 330–660, folds at 296 to a 56px strip                      |
| Workspace    | `components/app/shell/workspace.tsx`                  | Where the route's view renders                                       |
| Rail         | `components/app/shell/shell-rail.tsx`                 | Map and Resources, as buttons that open the drawers                  |
| Drawers      | `components/app/shell/drawer.tsx`                     | Ride **over** the panes on a scrim; they never squeeze them          |
| Focus traps  | `components/app/shell/focusable.ts` + the two drawers | One shared `FOCUSABLE` selector, so both traps hold the same list    |
| Entry bloom  | `components/app/shell/entry-bloom.tsx`                | The lotus, once per session (`sessionStorage`, `lelanea.bloom.seen`) |

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

| Class    | Range    | What changes                                                                    |
| -------- | -------- | ------------------------------------------------------------------------------- |
| `small`  | ≤ 900    | Nav becomes a drawer; the panes are a carousel with a pane switch in the topbar |
| `medium` | 901–1240 | The conversation is an absolutely-positioned panel over the workspace           |
| `large`  | > 1240   | Both panes are in flow, side by side                                            |

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

**The tone paints the band, not the eyebrow**, which the prototype tints.
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
   `/app/workspace/…` are the first of that kind, so they belong in a test of
   their own rather than in this list.

The view's eyebrow and title render **inside** the scroll body, not in the
workspace's fixed header. The prototype's `wsHead()` writes above the scroll
container; reproducing that here would mean the title travelling up from a server
page to a client component two levels above — a context set from an effect (a
frame of empty header on every navigation) or a `@head` parallel-route slot (a
second file per destination). Neither is worth a sticky title. The tone cannot be
done that way and so is not.

## A view that reads about the reader must guard itself

`app/(lelanea)/app/layout.tsx` checks the session, and **a layout is not
re-rendered when the router moves between sibling pages inside it.** So that
check gates _entry to the shell_, not each view.

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

## A panel that is off screen must also be out of reach

Both drawers — the ≤900 nav and the map/resources pair — hide with `visibility`
rather than `display`, because `display: none` gives the browser no starting
style to transition from and the panel pops instead of sliding.

`visibility` changes **discretely at the end** of a transition, so for the 300ms
of a close the panel is still `visible` and everything in it is still tabbable
while sliding off screen. Both therefore also carry `inert`, which applies at
once. `drawer.tsx`'s comment asserted that `shell-nav.tsx` already did this; it
did not, until t-22 went looking for the pattern in order to write this section.

Both traps share one `FOCUSABLE` selector
(`components/app/shell/focusable.ts`) rather than each carrying its own, because
a selector that misses an element type fails in the direction that matters — Tab
escapes the panel. **§05 puts real controls in the map and resources drawers**,
which is the first time either will hold more than a placeholder.

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
- **Workspace** — stands in for a module until §05.
- **The eleven voice leanings** — rendered as disabled sliders with the reason
  beside them. Nothing reads a leaning until a model is answering, which is
  phase 2.
- **Recents and the budget meter** — omitted from the topbar rather than faked.
- **The composer** — present, inert.

The account view shows the three facts the session holds and no statistics. The
prototype's version carries "Eleven sessions so far" and three counters with
nothing behind any of them; a count is the easiest invention to ship because it
reads as data rather than as copy.

## Known gaps

- **The theme choice cannot be taken back.** D4 makes the device preference the
  default until you choose, but `useTheme` exposes no writer that clears the
  stored value — so "follow my device" is unreachable once you have picked.
  §04 t-23.
- **The 404's tab reads only "Lelañea."** Next resolves no `metadata` export from
  a `not-found` file, and `global-not-found.js` bypasses the layout the boundary
  exists to keep.
- **The nav can contradict the 404.** `/app/journey/typo` still marks "Your
  journey" current, because prefix matching is correct for real child routes and
  §05 needs it for modules under `/app/workspace`. The nav cannot know the route
  404'd.
- **`sunrise#769`** — rendering the nested 404 surfaces a React 19 dev-only
  warning about the platform's no-flash theme script. Confirmed dev-only against
  a production build; filed, not patched.

## See also

- [`brand-theme.md`](./brand-theme.md) — the tokens every colour here comes from
- [`divergences.md`](./divergences.md) — rows 1 and 2 touch `app/layout.tsx`, which
  the shell renders inside
- [`local-dev.md`](./local-dev.md) — including how to run a production preview on
  the test domain, which is how the `sunrise#769` diagnosis was settled
