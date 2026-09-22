# Authored Content — `content/`, `lib/app/content`, `/api/v1/app/content`

Lelañea Fulton's words, and the data drafted from them, validated against Zod
schemas and served through the versioned API. **Never paraphrased in the build.**

**Two folders, and the difference is whose words they are.**

- **`content/`** holds her six transcribed files and nothing else: the
  foundational documents, the module structure, the discovery questions, the
  Values module, the value exploration framework and the value explorations.
  They are unchanged since their first commit (`2953c053`), and the build never
  edits them. Their `reviewNotes` are for her to rule on.
- **`seed-data/drafted/`** holds the six files drafted _for_ her
  and not by her: the voice fingerprint core, the voice overlays, the golden
  set, the crisis resources, the slot taxonomy and the resources library. Each
  carries a `provenance` block saying so and naming who has yet to sign it off.
  That block is **served**, not withheld, so a drafted file can never pass as
  her words. See [`voice.md`](./voice.md).

Both folders are seed and reference input (§22, owner ruling 2026-09-21). They
are not what the running app is meant to read. **Her foundational documents have
moved (t-86):** every surface reads them from `app_foundational_document`, and
the file only seeds that table. See [Her foundational documents: the
database](#her-foundational-documents-the-database). The journey, the questions
and the voice files follow in t-87 and t-88. Until then their loaders below still
import the files.

**Locations:** `content/*.json` (her words) ·
`seed-data/drafted/*.json` (drafted seed data) ·
`lib/app/content/` (schemas + loader) · `app/api/v1/app/content/` (the HTTP
surface) · `components/app/content/` (the renderer)

## Anti-patterns

**Do not import `content/*.json`.** An ESLint rule
(`contentJsonImportBoundary` in `lib/app/eslint.config.mjs`) fails any static
import, dynamic `import()`, or re-export of `@/content/*.json` or
`@/seed-data/drafted/*.json` from outside `lib/app/content/`. A re-export is the worst of the three — it hands the
unvalidated JSON to every consumer of the re-exporting module, not just one
file. A direct
import gets unvalidated data, skips the referential and placeholder checks, and
forks the pipeline this seam exists to prevent. Go through the loader.

**Do not retype the copy into a component.** If a page needs the mission
statement, it calls `requireDocument('the_mission')` from
`@/lib/app/content/sections` (or `getFoundationalDocument` from
`@/lib/app/content/document-store`), and a native client fetches
`/api/v1/app/content/documents/the_mission`. The moment a string is pasted into
JSX it stops tracking the source.

**Do not select a passage by position, heading text or pattern.** Name its
section key (see [Selecting part of a document](#selecting-part-of-a-document)).
Paragraph indexes shift silently when an admin inserts a block. Heading text
changes when a heading is reworded. A regex over her prose is composition logic
a native client would have to copy. All three were in the tree before t-86.

**Do not merge the welcome statement's paragraphs into flowing prose.**
`the_initiation` carries `renderStyle: 'cadence'` and a `renderNote` saying so.
Its single-sentence paragraphs are an authored beat, not an accident of
transcription.

**Do not loosen a schema to make a file parse.** Every object is a
`strictObject`, so an unknown key is a hard failure — that is the mechanism, not
an obstacle. If authored content genuinely gained a field, add it to the schema
deliberately.

## Her foundational documents: the database

Since t-86 the seven documents live in three `app_` tables, and the file is only
what seeds them.

| Table                                | Holds                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `app_document_collection`            | one row: the collection's id, title, version and locale                                  |
| `app_foundational_document`          | each document as served: metadata, `blocks` (JSONB), `version`, `locale`, `revision`     |
| `app_foundational_document_revision` | a full snapshot per revision, `origin: seed \| admin`, `editorId` (`ON DELETE SET NULL`) |

**One service writes and reads them:** `lib/app/content/document-store.ts`. Pages,
the gate, both emails, the waitlist's locale fallback and the API all call it.
The knowledge-base mirror (t-90) and the admin editor (t-91) attach to it, not to
the tables.

| Function (`document-store.ts`)    | Returns                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `listFoundationalDocuments()`     | the index in reading order, no blocks                                                     |
| `getFoundationalDocument(id)`     | one document with its keyed blocks, or `null` for an unknown id (the caller owns the 404) |
| `getFoundationalCollectionMeta()` | collection id, title, version, locale                                                     |
| `seedFoundationalDocuments(seed)` | writes collection, documents and each v1 revision — **once**                              |

All async. Reads go straight to the database on every request, with no cache, so
an admin edit reaches every client on its next request. An unseeded database
throws `ContentNotSeededError` rather than answering an empty list, and there is
**no fallback to the file**. The pages that read them export
`dynamic = 'force-dynamic'`, so a build never freezes the words or needs a
database.

**They are not re-exported from `@/lib/app/content`**, only their types are.
That module is imported by code that must stay free of the database, such as the
voice fingerprint, whose test walks its import closure.

**Validated on the way out.** `document-view.ts` projects a row into the served
shape and parses `blocks` against `storedDocumentBlocksSchema` on every read. A
row that fails throws. The same schema guards every write.

**Two versions per document.** `version` is the label a person acknowledges,
and the gate requires it (see [`gateway.md`](./gateway.md)). `revision` counts
writes. The seed gives every document the collection's `1.1`, so the move
re-gated nobody.

**The seed writes once** (`prisma/seeds/app-lelanea/015-foundational-documents.ts`,
`fp4`): if a collection row exists it writes nothing, so a re-seed never undoes an
admin edit. It declares no `hashInputs`. A change to the file therefore does not
reach a seeded database. Data an existing environment needs ships as an `app_`
migration ([`database-changes.md`](./database-changes.md)); an edit goes through
the admin (t-91).

`lib/app/content/foundational-seed.ts` is the one module that still imports
`lelanea_foundational_documents.json`. It builds the seed, holds the section-key
map, and provides the file-level placeholder checks. Nothing a request reaches
should import it (t-89 makes that a rule).

## The loader

`lib/app/content/index.ts`, for the collections still read from files until
t-87 and t-88. Parses each file on first use and memoises for the life of the
process; static JSON imports rather than `fs`, because `lib/app/**` may not touch
Node built-ins.

| Function                      | Returns                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `getJourneyStructure()`       | five tiers, seventeen modules, their phases                       |
| `getDiscoveryQuestions()`     | the thirty onboarding questions + pacing                          |
| `getVoiceFingerprint()`       | the always-on voice core, and its provenance                      |
| `getVoiceOverlays()`          | the register overlays, their labelling copy                       |
| `findPlaceholders(text)`      | merge fields in a string, deduplicated                            |
| `listDeclaredPlaceholders()`  | placeholders the file declares (`foundational-seed.ts`)           |
| `listOccurringPlaceholders()` | placeholders present in the file's prose (`foundational-seed.ts`) |

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

| Route                                         | Auth       | Notes                                                            |
| --------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `GET /api/v1/app/content/documents`           | public     | index, no prose                                                  |
| `GET /api/v1/app/content/documents/[id]`      | public     | blocks; 404 on unknown id                                        |
| `GET /api/v1/app/content/journey-structure`   | public     | tiers, modules, phases                                           |
| `GET /api/v1/app/content/discovery-questions` | `withAuth` | the questions a member gets                                      |
| `GET /api/v1/app/content/resources`           | `withAuth` | the library: films, reading, her words per key                   |
| `GET /api/v1/app/content/resources/[key]`     | `withAuth` | what the drawer shows for one open thing; `?pin=` puts one first |

All six carry a weak `ETag` and answer `304` to a matching `If-None-Match`, and
all six keep the platform's `private, no-cache` default.

Each `withAuth` route declares `ownership: { decidedBy: 'nothing' }` (Sunrise
0.12.0's authorization seam — `.context/auth/authorization.md`): it serves
published content and has no per-user rows to narrow. The declaration is
load-bearing, not decoration — without it the guard answers every non-admin
member 500 (`OwnershipDecisionMissingError`).

The ETag is recomputed per request and deliberately not memoised, even though
the payloads are constant for the life of the process. `computeETag` lives in
`lib/api/etag.ts`, which imports `node:crypto`; caching it inside
`lib/app/content` would pull a Node built-in into the tier that must stay
framework- and runtime-agnostic, and caching it in each route means six copies
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

The second consumer of her words is the resources drawer
(`components/app/shell/resources-drawer.tsx`, §14 t-75), which renders a
`words` passage — a quote and its paragraphs, not a block list — from
`/resources/:key`. It is held to the same rule: every paragraph is its own
element, every string reaches the DOM as a React child, and nothing is
re-flowed. A reading that names a `documentId` links to the page the site
renders that document on (`DOCUMENT_PAGES` in the drawer, pinned to the real
collection by its test); the welcome has no page and renders as a row that goes
nowhere.

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

`lib/app/content/sections.ts`. A **designed surface** shows one part of a
document inside the site's own chrome. `/data` lifts the disclaimer's "what it
is", "what it is not", crisis guidance and coaching-versus-therapy sections into
columns, cards and a red box. The home page's hero, quote band and cards, and
both emails, quote passages too.

**Passages are named by section key (t-86).** Every stored block carries a
`section` key or `null`. The owner named the keys (journal: "Section keys for her
documents (t-86)"), and the seed puts them on the blocks from the map in
`foundational-seed.ts`, pinning each range by its first and last words:

| Document                   | Key              | Shown on                             |
| -------------------------- | ---------------- | ------------------------------------ |
| `the_initiation`           | `welcome`        | the welcome email                    |
|                            | `invitation`     | home card 1, the waitlist email      |
|                            | `guide`          | home card 2                          |
| `the_heart_behind_lelanea` | `invitation`     | home `h1`                            |
|                            | `purpose`        | home lede, home meta description     |
|                            | `remembrance`    | home quote band                      |
| `disclaimer`               | `purpose`        | `/data`, "it is designed to support" |
|                            | `purpose_limits` | `/data`, beneath both columns        |
|                            | `is_not`         | `/data`, "it is not"                 |
|                            | `is_not_context` | `/data`, the note under that column  |
|                            | `coaching`       | `/data`, coaching and therapy        |
|                            | `crisis`         | `/data`, the crisis box              |
|                            | `commitment`     | home card 3                          |

A key's blocks must be contiguous; `storedDocumentBlocksSchema` rejects a key
that resumes after another block. Keys are in the API response (`sections` on
the document, `section` on each block). Which sections a surface shows is that
client's decision.

| Function                         | Returns                                                |
| -------------------------------- | ------------------------------------------------------ |
| `requireDocument(id)`            | a document, throwing rather than returning `null`      |
| `selectSection(doc, key, opts?)` | the key's blocks; a heading only with `includeHeading` |
| `selectSectionText(doc, key)`    | the key's paragraphs and list items as strings         |
| `selectSectionHeading(doc, key)` | the key's heading, for a surface that sets it aside    |

**Everything here throws rather than degrading, and that is the design.** An
empty result is a page that renders its "it is not" column as a blank box under
a green tick and says nothing at all — silently, on the most legally sensitive
surface in the site. A 500 on a content-integrity failure is loud and correct.

`tests/unit/lib/app/content/sections.test.ts` pins the opening and closing words
of every key a surface uses, and proves a block inserted above a key moves
nothing. `foundational-seed.test.ts` proves a range whose pins no longer match
fails the seed rather than keying the wrong passage.

**A heading reaches the screen by being read, never typed.** Pass
`includeHeading` or call `selectSectionHeading` and let the words come from the
row.

## No authored sentence is typed into the public site

The owner's t-6 ruling: **the authored documents win outright.** The prototype
supplies layout, section labels, eyebrows and rules; every sentence a visitor
reads is rendered from the database at request time (the rows are seeded from the
JSON). Where the two disagree — and they
do, often — the document is right.

`tests/unit/app/public/authored-provenance.test.ts` enforces it across
`app/(public)/**`, `components/app/site/**` and, since t-86,
`components/app/emails/**`. Every run of six consecutive
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

## Resources — her films and reading, and her words on whatever is open

`seed-data/drafted/lelanea_resources.json` · `lib/app/content/resources.ts` ·
`app/api/v1/app/content/resources/` (f-resources t-74; product description
§6.1, §9). The drawer's content: what the Curator agent surfaces and what is
browsable directly.

**Keyed like the structure file.** `films[]` and `readings[]` each carry what
the piece is for (`subtitle`) and where it belongs (`relatesTo`: a module id
such as `module_01_values`, or `journey`, `situations`, or `null` for a piece
that belongs to everything — never `default`, which the schema refuses on a
piece: it is the `words` fallback, and a piece tagged with it would show for
nothing). `words` is per key — a `quote` and a few short
`paragraphs` — with `default` required, because it is what every key without
words of its own reads. A film links out (`href`); a reading is a foundational
document (`documentId`) or a link (`href`), never both, as a union. No
thumbnails: nothing exists to show.

**"In her own words" means verbatim, and a test proves it.** Every `words`
entry cites its `source` — a foundational document id, or a step of the Values
module (`values_module.json`, release-2 content that is validated but not
otherwise served) — and `tests/unit/lib/app/content/resources.test.ts` asserts
the quote and every paragraph occur character for character in that source. A
tidied comma fails CI. Nothing in this file is drafted in her register: the
voice fingerprint's drafted-with-provenance precedent describes her voice,
whereas this is shown _as_ her words, so the two are held to different rules.
Passages are chosen so that none carries a merge field — the drawer substitutes
nothing.

**It ships as a draft.** `collection.provenance` (`status`,
`awaitingSignOffFrom`, `note`) is served, not withheld. Today: two passages the
builder picked from her material (values, from the "Centered Living" lesson; the
default, from the welcome statement) and **empty film and reading lists** — no
film of hers exists yet and only she can say which pieces belong beside which
module. Her list lands as a content-only change (t-76). The working `notes` are
withheld, as every file's are.

| Function                                 | Returns                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `getResourcesLibrary()`                  | collection meta + provenance, every film, every reading, every `words` entry                                    |
| `selectResourcesFor(key, { pin? })`      | her words on it, up to two films and three readings, the module's `title` and `tier`; `null` for an unknown key |
| `selectResources(file, modules, key, …)` | the same as a pure function of a parsed file — what the tests use                                               |
| `buildResourcesFileSchema(known)`        | the strict schema, parameterised on the module and document ids its referential checks need                     |

**The selection is the prototype's `pickFor`.** What belongs to the open thing
first, then what belongs to everything, capped at two films and three readings
("the drawer is for one thing at a time"); a key with no words of its own reads
`default`'s and says so (`wordsAreOwn: false`). `pin` puts one film or reading first in its list,
which is how a suggestion made in conversation opens the drawer on it (t-77).

**Slugs in, ids inside.** The shell asks by module slug (`values`), the file
keys by id (`module_01_values`); `moduleSlugFromId()` is the one rule between
them ([`journey.md`](./journey.md)). `/resources/:key` answers a 404 for a key
that is neither a module on the published structure nor one of the three fixed
keys — a typo and a module with nothing of its own must not look the same, so
the latter is a 200 with the default words.

Referential checks beyond the four above: every `relatesTo` and every `words`
key is a module id or a fixed key; every `documentId`, and every source that is
a document, resolves; ids are unique within each list.

## Storage

Her foundational documents are in the database since t-86 (above). The trigger
decision A2 named for that move — "the first time content must change without a
deploy" — is the owner's 22 September 2026 ask that every seeded collection be
manageable from the admin. The rule for every collection is the journal decision
"Storage: relational is authoritative for every seeded collection; the vector
store indexes only her prose". The journey, the questions and the resources
follow in t-87, the voice files in t-88. The function names were kept as the
seam, so callers changed only by becoming async.
