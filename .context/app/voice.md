---
name: app-voice
description: Designating her material — what each document is for, and the rule that keeps voice-only material off the tool path.
---

# Training material: what a document is for

The knowledge base holds two different kinds of thing wearing the same file
extension. Some of it is what Lelañea **knows** — a method note, a framework, a
reference she would happily have read back to someone verbatim. Some of it only
shows how she **sounds** — a Substack post, a talk transcript, a voice note.

Retrieval cannot tell them apart. Without a recorded designation, the first
exemplar lookup pastes her Substack paragraphs into a reply as though they were
an answer, attributed to nobody and asserted as fact.

This page is the designation: the vocabulary, where it is stored, the rule that
acts on it, and the surface an operator uses.

## The three answers

| Family        | Values                          | Stored as                           |
| ------------- | ------------------------------- | ----------------------------------- |
| `purpose`     | `knowledge` · `voice` · `both`  | a managed `KnowledgeTag`            |
| `sensitivity` | `public` · `private` · `client` | a managed `KnowledgeTag`            |
| `licensing`   | free text                       | `AppKnowledgeDesignation.licensing` |

Tag slugs are `purpose-knowledge`, `purpose-voice`, `purpose-both`,
`sensitivity-public`, `sensitivity-private`, `sensitivity-client` — hyphens, not
colons, because the platform's `knowledgeTagSlugSchema` is `^[a-z0-9-]+$`.

**Licensing is not a tag**, and that is a finding rather than a preference.
`KnowledgeTag` carries `slug` / `name` / `description` and no per-document value,
so a free-text note per document cannot be one without minting a tag per note.
`AiKnowledgeDocument.metadata` is not a home for it either:
`lib/orchestration/knowledge/document-manager.ts` **replaces** that column
wholesale on ingest, retry and re-chunk, so a note an admin typed would vanish
the first time a document was re-processed, silently.

## The rule

A document may reach `search_knowledge_base` — the tool path, the one that can
**quote** it — only when both hold:

- its purpose is `knowledge` or `both`; **and**
- its sensitivity is not `client`.

Everything else reaches the prompt, if at all, through the context contributor,
read directly and labelled by origin so the model can tell her register from her
answers. An **undesignated** document reaches nothing: deny by default.

### Her uploads only — `scope: 'app'`

Both the rule and the admin list filter to `scope: 'app'`. `scope: 'system'` is
the platform's own pre-loaded seed corpus (the bundled Agentic Design Patterns
reference), and `resolveAgentDocumentAccess` returns `includeSystemScope: true`
unconditionally — so a system document is searchable by **every** agent
regardless of grants, and no contributor can take that away.

Designating one would therefore be theatre. The first version of the page listed
Agentic Design Patterns with an **Agent may quote: No** badge, which was simply
untrue: an operator who marked it `voice` would reasonably have believed it had
stopped being quotable. Excluding it is the honest answer (`B31`), not a
tidiness filter.

### Why it is a document-level rule and not a tag grant

The obvious implementation is to grant her agent the `purpose-knowledge` tag
through Sunrise's agent form. It does not work, and the way it fails is quiet.
`resolveAgentDocumentAccess` expands each granted tag to its documents and
**unions** the results, so tag grants can only say OR. There is no tag expression
for _knowledge AND NOT client_: a document tagged `purpose-knowledge` and
`sensitivity-client` is admitted by the first tag whatever the second says.

So **her agents carry no purpose or sensitivity tag grants**, and the set is
composed live by an access contributor. That is also what the platform
recommends — `resolveAgentDocumentAccess`'s own docblock warns that materialising
derived grants onto the per-agent pivot is clobber-or-leak, because the pivot has
no provenance column.

### Whose agents

An agent participates when its slug starts with `lelanea-`
(`CORPUS_AGENT_SLUG_PREFIX`). A contributor can only **widen** a restricted
agent, so firing for every restricted agent on the install would hand her corpus
to the platform's own seeded agents — the pattern advisor, the quiz master, the
evaluation judges — because they happen to be restricted.

A prefix rather than an allowlist constant because the agents do not exist yet:
an allowlist would ship empty and leave the mechanism dark until somebody
remembered to add a string.

### The precondition: the agent must be `restricted`, or none of this runs

`resolveAgentDocumentAccess` short-circuits — `if (agent.knowledgeAccessMode !==
'restricted') return { mode: 'full' }` — and that `return` is **above**
`collectAccessContributions()`. `search_knowledge_base` likewise only applies a
document filter when `access.mode === 'restricted'`. The platform default is
`full`, in the Prisma column and in `agentCreateSchema` both.

So an agent left on the default never consults this rule at all: it searches the
whole corpus, and voice-only or `sensitivity-client` material is quoted exactly
as if none of this had shipped — while `/admin/app/knowledge` still shows **Agent
may quote: No** for it, because `isQuotable()` is a pure function of tags and
knows nothing about any agent's mode.

Nothing here can enforce that, because a contributor can only widen and never
narrows: the rule is inert rather than wrong. It is a **hard requirement on
t-26**, the task that creates the first `lelanea-` agent, that it is created
`restricted` explicitly and that a test asserts so through the real resolver. The
**Agent may quote** column's own help text names the precondition, so the surface
does not assert more than it can deliver.

### `client` is vocabulary without a mechanism behind it, deliberately

Client transcripts are **deferred**, not excluded (owner ruling, applied at
planning). `sensitivity-client` exists from day one so a document can be marked
honestly at the moment it is uploaded; nothing is seeded from that source and no
grant rule admits it. Recording the deferral in the vocabulary is what stops it
being rediscovered later as an undesignated pile of transcripts nobody dares
touch.

## The files

| File                                                    | What it is                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `lib/app/voice/designation.ts`                          | The vocabulary, the slugs, and the rule as a pure function           |
| `lib/app/voice/corpus-access.ts`                        | The rule against the database, and which agents it widens            |
| `lib/app/voice/designation-admin.ts`                    | The admin list and the partitioned write                             |
| `lib/app/voice/endpoint.ts`                             | The paths, so components do not hardcode them                        |
| `lib/app/knowledge-access-contributors.ts`              | The seam registration — one contributor, `lelanea:designated-corpus` |
| `lib/validations/app-knowledge-designation.ts`          | The wire contract                                                    |
| `prisma/seeds/app-lelanea/002-knowledge-designation.ts` | Where the six tags come from                                         |
| `components/app/admin/designation-table.tsx`            | The table                                                            |

Routes: `GET /api/v1/admin/app/knowledge/designations` and
`GET`/`PATCH .../designations/:documentId`. Page: `/admin/app/knowledge`
("Training material" in the Lelañea admin section).

## The surface

`/admin/app/knowledge` — **Training material** in the Lelañea admin section —
lists every document uploaded into this install with its purpose, sensitivity,
licensing note, and an **Agent may quote** column showing the consequence of the
answer on the same screen.

The first control is the **Undesignated documents** filter. That is the point of
the page rather than a convenience: an undesignated document reaches nothing, but
on screen it looks exactly like one that reaches everything, and that confusion
is what this feature exists to remove.

## Two properties worth knowing before you change anything

**The write is partitioned.** Setting a purpose replaces one tag among however
many an admin has put on the document through
`/admin/orchestration/knowledge`. The removal pass touches only the six slugs
this feature owns — never `deleteMany({ documentId })`, which is the obvious
shape and throws away every unrelated tag with nothing to report it.

**The list and the rule must agree on scope.** Both filter to `scope: 'app'`.
If one drifts, the page starts making claims about documents the rule does not
govern — which is the defect the surface exists to prevent, on the surface that
exists to prevent it. `tests/unit/lib/app/voice/designation-admin.test.ts` pins
the list's filter and `corpus-access.test.ts` pins the rule's.

**The write evicts the resolver's cache.** `resolveAgentDocumentAccess` memoises
for 60 seconds. Without `invalidateAllAgentAccess()`, a document just marked
`voice` stays quotable for up to a minute — which is the minute that matters.

## The seed

`prisma/seeds/app-lelanea/002-knowledge-designation.ts` creates a missing tag and
**never rewrites an existing one**. The slug is code — the rule addresses these
tags by slug — but the name and description are operator-owned, because
`/admin/orchestration/knowledge/tags` lets an admin edit both and a reconciling
seed would undo that on its next run.

The consequence, stated rather than discovered: improving a description in
`designation.ts` does not reach a database that already has the tag. Change the
copy in the admin, or mint a new slug if the vocabulary itself changed meaning.

A re-run on a complete database issues no write at all, so `updatedAt` never
moves.

## The migration

`prisma/migrations/20260916120000_app_knowledge_designation` — apply with
`npm run db:migrate:deploy`, not `migrate dev`. The FK to
`ai_knowledge_document` is hand-written (a fork table must not add a reverse
relation field to a Sunrise-owned model), so the schema and the database diverge
on purpose and the development command reads that divergence as drift.
`lib/app/leaf-db-drift.ts` pins the constraint and its `ON DELETE CASCADE`;
`npm run db:drift-check` fails if either moves.

## Tests

| File                                                                | Proves                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `tests/unit/lib/app/voice/corpus-access.test.ts`                    | The rule end to end through Sunrise's resolver — the load-bearing one |
| `tests/unit/lib/app/voice/designation.test.ts`                      | The vocabulary, the slugs, the safe reading of a conflict             |
| `tests/unit/lib/app/voice/designation-admin.test.ts`                | The partitioned write, the cache eviction, the seeding remedy         |
| `tests/unit/lib/app/knowledge-access-contributors.test.ts`          | Exactly one contributor, and which one                                |
| `tests/unit/prisma/seeds/app-lelanea/knowledge-designation.test.ts` | The seed writes nothing on a re-run                                   |

The first of those is the one to re-read before changing the rule. It asserts a
voice document is **absent** from the resolved set — an absence that would pass
for free on an empty set — so every absence claim in it sits after a presence
claim. Reverting the rule fails it: add `'voice'` to `TOOL_PATH_PURPOSES` and two
cases go red; empty `UNGRANTABLE_SENSITIVITIES` and two others do.

## Not this task

The context contributor that reads voice-designated material and labels it by
origin is t-27, and the always-on core of how she sounds is t-26. This task ships
the vocabulary, the rule and the surface — the mechanism — and seeds no agent.
