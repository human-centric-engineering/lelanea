---
name: journey
description: The seventeen modules as the framework sees them, the published map that carries the recommended spine, and the seed that keeps the map a projection of the structure file.
---

# The journey

Fifteen of the sixteen numbered modules have a title and nothing else, and the
product description says the skeleton must be visible and navigable without
pretending to be finished. This is where Daybreak's primitives first carry
Lelañea: every module is a real place in the framework's module registry with
an empty interior, and the recommended order is a published facilitation map
whose edges are advisory — jumping anywhere is first-class, and nothing locks.

Both are **derived from `content/lelanea_module_structure.json`** through
`getJourneyStructure()`, so the registry, the map and the content API cannot
disagree about how many modules there are, what they are called, or which tier
holds them. Adding a module is an edit to the structure file; everything below
follows.

## The pieces

| Piece                                         | What it is                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `lib/app/modules/definitions.ts`              | Seventeen `ModuleDefinition`s, and `moduleSlugFromId()` — the one slug rule |
| `lib/app/leaf-bootstrap.ts`                   | Registers them from `initLeafApp()`; the framework's boot sync writes rows  |
| `lib/app/journey/modules.ts`                  | The leaf's read wrapper over the registry and the `framework_module` rows   |
| `lib/app/journey/map-definition.ts`           | The map: five regions, seventeen module nodes, sixteen `related_to` edges   |
| `prisma/seeds/app-lelanea/001-journey-map.ts` | Publishes the map through the version service; idempotent                   |
| `scripts/smoke/app-journey-map.ts`            | `npm run smoke:app-journey-map` — seed, reseed, validation, on the real DB  |

| `lib/app/journey/map.ts` | The published graph joined with the content: what the shell reads |
| `lib/app/journey/paths.ts` | `/app/modules/<slug>`, and the `localStorage` key for the last one visited |
| `app/api/v1/app/journey/map/route.ts` | `GET` — `withAuth`, ETag; 404 while unpublished; 500 when inconsistent |
| `components/app/shell/map-drawer.tsx` | The map drawer's body: five tiers, seventeen rows, `aria-current` |
| `components/app/views/module-view.tsx` | A module's page: eyebrow, title, parts, placeholder, the tier's intent |
| `components/app/views/module-actions.tsx` | "In Lelañea's own words" (opens resources) · "Talk about this part" (off) |
| `components/app/views/remember-module.tsx` | Writes the last module visited, for the Workspace nav item |
| `app/(lelanea)/app/modules/[slug]/page.tsx` | The route; 404 for any slug not on the published map |

## Slugs: `values`, `curiosity-of-self`, never `module_01_values`

The structure file's ids are `module_NN_words_like_this`. The framework's slug
rule is lowercase-alphanumeric-with-hyphens (`slugSchema`), enforced on every
`[slug]` admin route, so the projection strips the numbered prefix and swaps
`_` for `-`. The number is dropped on purpose: a slug is an identity, not a
position — the order is the map's business — and a slug that carried it would
break every URL the day a module is renumbered.

`moduleSlugFromId()` is the **only** place that rule lives. The map's module
node keys, the journey API's routes and anything else that must meet the
registry by slug call it rather than re-deriving it.

## Status: every row is born `draft`, and that is fine this phase

`syncRegisteredModules()` writes no status; the schema default is `draft`, and
status is operator-owned from then on (the seed never touches it). Nothing this
phase reads consults `isModuleLive` — the admin list returns every row, the map
validator checks node shape only, and liveness is consumed solely by the
facilitation engine's per-user availability. **Do not add a status write to the
seed to "activate" modules**: it would clobber an operator's choice on every
boot, and nothing needs it until per-user journeys are switched on.

## The map (decision A6)

`buildJourneyMapDefinition()` returns a `MapDefinition` already parsed through
the framework's own Zod, so defaults (`completionMode: 'once'`) are present —
which is what makes the seed's deep-equal against a stored version meaningful.

- **Regions** are `tier:<tier id>`. Node keys share one namespace and
  `onboarding` is both a tier and a module slug, so regions are prefixed and
  modules keep their bare slug (journey state keys on the node key).
- **Module nodes** — `key === moduleSlug`, `region` set, `meta: { number }`.
- **Edges** — `related_to` from each module to the next in numbered order.
  The engine reads `related_to` for nothing, so this locks nothing. There are
  no `prerequisite` or `unlocks` edges and no conditions; every node is an
  entry node.
- **The graph carries structure only.** Titles, intents and display numbers
  stay in the content API. A copy in `meta` would be a second source for the
  drawer to read, and the one it read would be the one that drifted.

## The seed, and who owns the row

`001-journey-map.ts` is a **pure code projection** (fp4). It:

1. Calls `syncFrameworkForSeed({ registerLeaf: initLeafApp })` first. On a
   fresh database Daybreak's `prisma/seeds/_framework/000-framework-boot.ts` has already
   done this; on an existing one that unit is skipped (its hash covers only
   `lib/framework/**`), and the module rows the map points at would be missing.
2. Creates the map published as v1 when absent; publishes a new version pinned
   to the one it compared against when the definition changed
   (`expectedBaseVersion`, re-checked inside the write transaction); writes
   **nothing** when a deep-equal of the parsed definitions says nothing changed.
   Deep-equal, not text: jsonb drops key order.
3. Hashes the structure file, the content loader and schema, `map-definition.ts`
   and `definitions.ts` (`hashInputs`), so a change to the shape, the
   projection or the slug rule re-runs it.

**The trigger to reclassify the row as operator-owned is the first edit
Lelañea makes in the map editor.** From then on the seed must create-if-absent
and never publish over an existing version, and the structure file stops
being the source of the graph's shape. Until then, an edit in the editor is
overwritten on the next seed run — by design, and the seed's header says so.

Two log lines a seed run prints are Daybreak's, not defects: `duplicate slug —
last registration wins` (the framework registered twice in one process, which
the seed guide accepts) and `Auto-embed after publish failed (advisory)` when
no embedding provider is configured.

## The read surface (t-14)

**One read, two faces.** `getJourneyMap()` in `lib/app/journey/map.ts` is the
only path from the framework's published-map reader to the shell. The route is
its HTTP face — what the drawer fetches — and a server page calls it directly,
the way the content pages call the content loader. The graph is the source of
_structure_ — which tiers, which modules, in what order, in which tier: a
module's `tier` is the region node it sits in and `number` is its position in
the graph, so an editor that moves a module has moved it. The content API
supplies every word, including the authored `displayNumber`, which is a label
and not the position. So a module in `content/` that is not yet on
the published map is absent from the drawer AND 404s as a page — the two
surfaces cannot disagree about what is a place.

**A missing registration is a 500, not a shorter list.** A map node whose slug
the running code does not register means the seed ran against newer content
than the code, or the reverse. `getJourneyMap()` throws `APIError` with code
`JOURNEY_MAP_INCONSISTENT` and the slugs in `details.problems`; the route
returns that envelope and logs it — as does a module node in no projected
region, which the drawer would otherwise list under no tier. Do not "fix"
either by filtering — a sixteen-module map that renders is exactly the failure
nobody notices.

**Every module reads `open`.** No `done`, no `current`: those are per-user
journey state, which this phase deliberately does not have. The one state the
drawer shows is _where you are_ — `aria-current="page"` on the open module's
row — because that is a fact about the route. The `state` field is on the wire
shape now so the drawer and the page do not grow a second contract when
journeys arrive.

**The tier tone is a swatch, not the label's colour.** The task said "label
coloured by tier tone"; `shell.md` measured exactly that pattern at 3.17:1 and
2.03:1 in light mode and removed it from the eyebrow. Same rule here — the
label keeps `--color-muted-foreground`, and meaning never rested on the colour.
A module page takes the workspace tone rather than its tier's: `Panes`
publishes tone by pathname only, and mapping a slug to a tier there would mean
bundling the structure file into a client component for one hue.

**"Workspace" goes to the last module visited.** `RememberModule` on a module
page writes the slug to `localStorage` (`LAST_MODULE_STORAGE_KEY`); the nav
reads it and resolves the item's `href`, falling back to `/app/workspace` until
a module has been visited. Per browser, because there is no per-user journey
to hold "the module you are in" yet — when there is, this is the line that
moves. The item reads current on any `/app/modules/*` route.

**The parts are not tabs.** The prototype's `.wtabs` switch per-user state;
here nothing is behind any part, so a `tablist` would be a control that
controls nothing. They render as a static named list — Values' three authored
phase tiers, the unnamed pair everywhere else, because naming them would be
inventing the module.

## Checking it by hand

- `npm run smoke:app-journey-map` — runs the seed unit twice against the dev
  database: seventeen module rows, 22 nodes / 16 edges published, every module
  node resolving to a row, no second version on the second run, a dangling
  edge refused. Read its exit code.
- `/admin/framework/modules` — seventeen rows, all `draft`.
- `/admin/framework/maps` — `lelanea-journey · Published`, no draft; the
  atlas renders it.
- Signed in, the rail's **Map** — five tiers, seventeen rows, all `open`; open
  one and the drawer closes onto its page; open the map again and that row is
  current. `/app/modules/values` shows Orientation · Discernment · Integration;
  any other module shows Part 1 · Part 2. Both themes.
