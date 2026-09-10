# Authored Content — `content/`, `lib/app/content`, `/api/v1/app/content`

Lelañea Fulton's own words: six JSON files, validated against Zod schemas, served
through the versioned API. **Never paraphrased in the build.**

**Locations:** `content/*.json` (the words) · `lib/app/content/` (schemas +
loader) · `app/api/v1/app/content/` (the HTTP surface) ·
`components/app/content/` (the renderer)

## Anti-patterns

**Do not import `content/*.json`.** An ESLint rule
(`contentJsonImportBoundary` in `lib/app/eslint.config.mjs`) fails any static
import, dynamic `import()`, or re-export of `@/content/*.json` from outside
`lib/app/content/`. A re-export is the worst of the three — it hands the
unvalidated JSON to every consumer of the re-exporting module, not just one
file. A direct
import gets unvalidated data, skips the referential and placeholder checks, and
forks the pipeline this seam exists to prevent. Go through the loader.

**Do not retype the copy into a component.** If a page needs the mission
statement, it fetches `/api/v1/app/content/documents/the_mission` or calls
`getFoundationalDocument('the_mission')`. The moment a string is pasted into JSX
it stops tracking the source.

**Do not merge the welcome statement's paragraphs into flowing prose.**
`the_initiation` carries `renderStyle: 'cadence'` and a `renderNote` saying so.
Its single-sentence paragraphs are an authored beat, not an accident of
transcription.

**Do not loosen a schema to make a file parse.** Every object is a
`strictObject`, so an unknown key is a hard failure — that is the mechanism, not
an obstacle. If authored content genuinely gained a field, add it to the schema
deliberately.

## The loader

`lib/app/content/index.ts`. Parses each file on first use and memoises for the
life of the process; static JSON imports rather than `fs`, because `lib/app/**`
may not touch Node built-ins.

| Function                          | Returns                                            |
| --------------------------------- | -------------------------------------------------- |
| `listFoundationalDocuments()`     | index in the collection's authored reading order   |
| `getFoundationalDocument(id)`     | one document with blocks, or `null` for unknown id |
| `getJourneyStructure()`           | five tiers, seventeen modules, their phases        |
| `getDiscoveryQuestions()`         | the thirty onboarding questions + pacing           |
| `getFoundationalCollectionMeta()` | collection id, title, version, locale              |
| `findPlaceholders(text)`          | merge fields in a string, deduplicated             |
| `listDeclaredPlaceholders()`      | placeholders the documents declare                 |
| `listOccurringPlaceholders()`     | placeholders actually present in the prose         |

`getFoundationalDocument` returns `null` rather than throwing, so the caller owns
the 404 / `notFound()` decision.

**Everything the loader returns is memoised and deeply frozen.** Each accessor
projects once and hands out that same object on every later call — the served
payloads are constant for the life of the process, so rebuilding seventeen
modules per request bought nothing. That makes the result shared, which makes
mutating it a way to rewrite the authored copy for every later request in the
process. In-place placeholder substitution is the obvious way to write that bug.

Two lines of defence, and the type is the first. Served shapes are
`DeepReadonly`, so both `structure.tiers.sort(...)` and the subtler
`block.text = block.text.replace(...)` are compile errors rather than a 500 on a
public page — the second is the one a shallow `readonly Block[]` misses, and it
is exactly the substitution case. The freeze catches whoever casts past the type
or arrives through `any`. **Copy before you transform.**

Release-2 content — the Values module, the reference framework, the sixteen value
explorations — is validated but not served, and lives in
`lib/app/content/values.ts`. It is a separate module so that
`value_explorations.json` (271KB) stays out of bundles that only want a document.

## Endpoints

| Route                                         | Auth       | Notes                       |
| --------------------------------------------- | ---------- | --------------------------- |
| `GET /api/v1/app/content/documents`           | public     | index, no prose             |
| `GET /api/v1/app/content/documents/[id]`      | public     | blocks; 404 on unknown id   |
| `GET /api/v1/app/content/journey-structure`   | public     | tiers, modules, phases      |
| `GET /api/v1/app/content/discovery-questions` | `withAuth` | the questions a member gets |

All four carry a weak `ETag` and answer `304` to a matching `If-None-Match`, and
all four keep the platform's `private, no-cache` default.

The ETag is recomputed per request and deliberately not memoised, even though
the payloads are constant for the life of the process. `computeETag` lives in
`lib/api/etag.ts`, which imports `node:crypto`; caching it inside
`lib/app/content` would pull a Node built-in into the tier that must stay
framework- and runtime-agnostic, and caching it in each route means four copies
of a mutable module-level variable. The saving is a SHA-256 over a few tens of
kilobytes — well under a millisecond, against request overhead orders of
magnitude larger. Not worth either price.

**Do not mark these `public`** — an earlier draft did, reasoning that the three
unauthenticated payloads are identical for every caller and a CDN could hold
them. Two things make that wrong. `checkConditional` hard-codes the private
default on its 304 (`lib/api/etag.ts`, Sunrise-owned, so not ours to change), and
RFC 9111 §4.3.4 has a cache update its stored headers from the 304 — so the first
revalidation flips the entry back to private and the shared cache stops serving
it. And `proxy.ts` attaches a per-visitor `Set-Cookie` to these responses, which
a shared cache would then replay to other visitors. The directive delivered
nothing and risked that; the ETag delivers the saving on its own.

Rate limits are inherited from the `/api/v1/**` section policy applied by
`proxy.ts`; no handler calls a limiter.

**Not served, deliberately:** the maintainers' working notes — `reviewNotes`
("the effective date is still unfilled"), `sourceFile` provenance, and, on the
journey structure, module `notes`, `appBehavior`, `contentNote`, `contentFile`
and module-level `contentRef` (which names files on disk). They are notes _about_
the words, not the words.

Every accessor projects field-by-field for this reason, at **every** level —
tiers, modules, phases, phase tiers. `getJourneyStructure`
originally returned `file.modules` wholesale and published all of the above to
anonymous callers; both the security review and `/code-review` caught it. Listing
served fields explicitly is what makes a new authored annotation withheld by
default rather than published by default — so **add to a projection
deliberately, never widen one to "pass through" a new field**.

The two fields that do survive the journey projection are there on purpose:
`contentRef` on a phase is a link a client turns into a `/documents/:id` request,
and `proposed` marks a phase that is a proposal rather than authored material.

`proposed` being public is not a leak, and the emptiness it hints at is not one
either. The product description settles this: release 1 "carries no module
content — not even Values", the modules "appear as a real, navigable map with
empty interiors", and "the whole journey is always visible, including the parts
not yet touched". Fifteen of the seventeen modules serve `phases: []` today, by
design; that map _is_ the release-1 deliverable. Withholding `proposed` would
render one proposal identically to built content, against a spec whose stated
aim is being "honest about what it is".

## Block types

A document's `blocks` are a discriminated union on `type`:

- `heading` — `text`, `level`; `number` on the numbered clauses of the Terms of Use
- `paragraph` — `text`
- `list` — `style: 'unordered'`, `items`

`text` and list `items` may carry `**bold**` inline markdown (the Disclaimer and
the Terms of Use use it). No other inline syntax appears in the source.

**There is no `quote` block in the foundational documents.** The renderer task
(§02 t-4) asks for "quote italic where a block is marked as such"; nothing marks
one across all seven documents, so that branch has no input to render. Quote
blocks with an `attribution` do exist — in `values_module.json`, which is
release-2 content and not served. Checked so the renderer does not go looking.

## Placeholders

Three, and the test suite pins that set exactly:

| Placeholder         | Document         | Meaning                         |
| ------------------- | ---------------- | ------------------------------- |
| `{{first_name}}`    | `the_initiation` | app substitutes; appears twice  |
| `[Month Day, Year]` | `terms_of_use`   | **unfilled** — a launch blocker |
| `[Support Email]`   | `terms_of_use`   | **unfilled** — a launch blocker |

`tests/unit/lib/app/content/placeholders.test.ts` scans the real prose and fails
if a fourth bracket appears, because a placeholder nobody substitutes ships to a
reader as literal `[Support Email]`. Introducing one is fine — update that test
_and_ whatever substitutes it.

Per decision D7, `{{first_name}}` falls back to "Welcome." with the comma
dropped when there is no name on file.

**D7 is written for the opening line, and there are two sites.** The second is a
vocative bracketed by _two_ commas, so dropping only the leading one leaves a
broken sentence:

| Authored                                      | No name on file              |
| --------------------------------------------- | ---------------------------- |
| `Welcome, {{first_name}}.`                    | `Welcome.`                   |
| `You, {{first_name}}, are far more powerful…` | `You are far more powerful…` |

So the rule `applyFirstName()` implements is: take the comma before the field,
the field, and a comma directly after it. It does not handle a field that
_opens_ a sentence (the capital would be lost with the preceding word); no such
line exists, and a third site would surface in the placeholder test above,
which is the moment to revisit the function.

## Rendering

`components/app/content/authored-document.tsx` is the **only** place an authored
block list becomes markup. One renderer is the point: the description forbids
paraphrase and forbids reflowing her single-sentence cadence into prose, and two
pages with two ideas of what a document looks like is how that erodes.

`<AuthoredDocument document={…} firstName={…} />` — a server component. It takes
a `FoundationalDocumentDetail` straight from the loader and renders the category
eyebrow, the title, the subtitle where there is one, and every block in authored
order.

**It is not a markdown renderer and must not become one.** The files declare
`textFormat: "markdown-inline"` and use exactly one inline construct, `**bold**`.
The inline pass recognises that and nothing else; every string reaches the DOM as
a React child, so there is no `dangerouslySetInnerHTML` and no HTML parser in the
path. A test asserts that of the source, with comments stripped — the docblock
names the API in order to rule it out.

**Substitution happens in the renderer, never in the loader.** The loader parses
once, memoises and deep-freezes precisely so a per-reader edit cannot leak into
every other reader, and `{{first_name}}` is a per-reader edit. A test renders
with a name and then re-reads the document to prove the authored text is intact.

**Headings.** The document title is the page's only `h1`; authored levels render
as written, clamped into `h2`–`h6`. Every heading in the seven documents is level
2 today, so the clamp has no live input — it is there so a deeper outline
degrades rather than emitting a second `h1`. A numbered clause renders its
`number` as a prefix inside the heading, with a real space, so a copied heading
reads `1. About Lelañea`.

**Cadence.** `the_initiation` carries `renderStyle: "cadence"` and a `renderNote`
saying not to merge its beats into flowing prose. Each beat is already its own
`<p>`, which is most of the promise; a cadence document additionally gets
`whitespace-pre-line`, so a line break authored _inside_ a beat survives. No
block contains one today.

**Unresolved placeholders** are highlighted outside production and plain inside
it. `[Month Day, Year]` and `[Support Email]` are launch blockers; the highlight
is how they stay visible to whoever is looking at the page, and in production a
reader is shown the copy, not our editorial state.

**Type comes from the `.brand-*` utilities** in `app/brand-theme.css`, which
carry no colour by design — and which are scoped `[data-surface='consumer']`. So
`brand-display` and `brand-eyebrow` are inert on a page that does not carry that
surface, and the test asserting them checks the class string, not the computed
type: it would pass on such a page. Layout — measure, page chrome, the
descriptive eyebrow the prototype uses per section — belongs to the page that
mounts this, and so does setting the surface.

## Selecting part of a document

`lib/app/content/sections.ts`. A **designed page** shows one part of a document
inside the site's own chrome — `/data` lifts the disclaimer's "what it is",
"what it is not", crisis guidance and coaching-versus-therapy sections into
columns, cards and a red box, and links to `/disclaimer` for the whole thing.

The alternative was retyping those into a `const` beside the layout, which is the
drift this whole pipeline exists to stop — and worst on the page a visitor
looking for therapy reads before deciding.

| Function                                | Returns                                             |
| --------------------------------------- | --------------------------------------------------- |
| `requireDocument(id)`                   | a document, throwing rather than returning `null`   |
| `selectSection(doc, heading, opts?)`    | the blocks under a heading; `includeHeading` adds it |
| `selectSectionText(doc, heading)`       | that section's paragraphs and list items as strings  |
| `paragraphAt(doc, n)`                   | one paragraph; negative counts from the end          |
| `paragraphRange(doc, from, to)`         | a half-open run of paragraphs                        |
| `listSectionHeadings(doc)`              | every heading, in authored order                     |

**Everything here throws rather than degrading, and that is the design.** An
empty result is a page that renders its "it is not" column as a blank box under
a green tick and says nothing at all — silently, on the most legally sensitive
surface in the site. A 500 on a content-integrity failure is loud and correct.

Nothing reaches production either way: `tests/unit/lib/app/content/sections.test.ts`
pins **every handle a page selects by** — the four disclaimer headings, the three
paragraph ranges the home page's cards use, the four positions its hero and quote
band read. A renamed heading or a beat inserted upstream of a range fails there,
naming it.

**Prefer a heading to a position.** `selectSection` is stable under editing;
`paragraphRange` is not, and exists for `the_initiation`, which has seventy beats
and no headings at all. Where a position is unavoidable, pin both ends of it.

**A selector string may be a literal; a rendered string may not.** `/data` holds
`'What Lelañea Is Not'` in its source as the argument to `selectSection` — that
is fine, because a drifted heading throws. Rendering that same constant as the
visible heading is not: pass `includeHeading` and let the words come from the
document. The distinction is enforced by
`tests/unit/app/public/authored-provenance.test.tsx`, which scans paragraph and
list text only, for exactly this reason.

## No authored sentence is typed into the public site

The owner's t-6 ruling: **the authored documents win outright.** The prototype
supplies layout, section labels, eyebrows and rules; every sentence a visitor
reads is rendered from the JSON at run time. Where the two disagree — and they
do, often — the document is right.

`tests/unit/app/public/authored-provenance.test.tsx` enforces it across
`app/(public)/**` and `components/app/site/**`. Every run of six consecutive
words in every authored paragraph is a sentinel, and none may appear in source
with comments stripped and punctuation normalised. Six words catches a **re-cut**
— a sentence with a clause trimmed off the front, which is the failure that
actually happens and which comparing whole strings would miss.

It is not theoretical. Adding it surfaced four separate violations that had
shipped in t-5 and that nothing else in the tree could have seen:

- the home page's `h1` and lede — blocks 0 and 1 of `the_heart_behind_lelanea`
- its quote band — that document's closing two beats
- all three "what this is" card bodies — re-cuts of `the_initiation` and the
  disclaimer, with `the_initiation`'s cadence merged into flowing prose against
  its own `renderNote`, and "magnificent intelligence" trimmed to "intelligence"
- the footer's standing disclaimer — the crisis instruction with two of its
  three actions silently dropped

**Headings are deliberately outside the scan** (see above). So is everything
outside the public site: a future authoring or admin surface handling this text
is a different rule.

## Referential integrity

Beyond shape, the schemas assert four things structure alone cannot, each of
which otherwise fails far from its cause:

- `collection.suggestedOrder` is exactly the set of document ids — no ghost, no
  omission (an omitted document is simply never listed), no duplicate
- every module is listed by exactly one tier — no module unlisted, none listed
  twice within a tier or across two — and agrees with it about which
- within a module, no two phases share a number, and a phase tier only groups
  phases the module actually has
- `content.questionCount` matches the questions actually present, and they are
  numbered from one in order

## Storage

Repository JSON this phase, by decision A2. DB-backed authoring is deferred with
an explicit trigger: **the first time content must change without a deploy.** The
loader's function signatures are the seam — moving behind a database should not
change a caller.
