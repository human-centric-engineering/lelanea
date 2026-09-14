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

The read surface — the map API, the drawer, the module pages — is §05 t-14 and
is documented here when it lands.

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
   fresh database Daybreak's `_framework/000-framework-boot.ts` has already
   done this; on an existing one that unit is skipped (its hash covers only
   `lib/framework/**`), and the module rows the map points at would be missing.
2. Creates the map published as v1 when absent; publishes a new version pinned
   to the one it compared against when the definition changed
   (`expectedBaseVersion`, re-checked inside the write transaction); writes
   **nothing** when a deep-equal of the parsed definitions says nothing changed.
   Deep-equal, not text: jsonb drops key order.
3. Hashes the structure file, `map-definition.ts` and `definitions.ts`
   (`hashInputs`), so a change to the shape or the slug rule re-runs it.

**The trigger to reclassify the row as operator-owned is the first edit
Lelañea makes in the map editor.** From then on the seed must create-if-absent
and never publish over an existing version, and the structure file stops
being the source of the graph's shape. Until then, an edit in the editor is
overwritten on the next seed run — by design, and the seed's header says so.

Two log lines a seed run prints are Daybreak's, not defects: `duplicate slug —
last registration wins` (the framework registered twice in one process, which
the seed guide accepts) and `Auto-embed after publish failed (advisory)` when
no embedding provider is configured.

## Checking it by hand

- `npm run smoke:app-journey-map` — runs the seed unit twice against the dev
  database: seventeen module rows, 22 nodes / 16 edges published, every module
  node resolving to a row, no second version on the second run, a dangling
  edge refused. Read its exit code.
- `/admin/framework/modules` — seventeen rows, all `draft`.
- `/admin/framework/maps` — `lelanea-journey · Published`, no draft; the
  atlas renders it.
