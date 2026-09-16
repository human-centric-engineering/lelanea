---
name: app-voice
description: The always-on core of how she sounds, and the designation rule that keeps voice-only material off the tool path.
---

# How she sounds: the core, and what may be quoted

Two halves of one feature, doing different jobs. The **core** is a page of
authored text that rides on every prompt — the part that does not depend on
anything being found. The **designation rule** is what decides which of her
documents a retrieval tool is allowed to quote back at someone. Read the core
first; it is the thing a person actually meets.

# The always-on core

Retrieval is probabilistic. Identity should not be.

If the only thing carrying her voice is a nearest-neighbour lookup, then the
turns where retrieval finds nothing — a greeting, a refusal, a short clarifying
question — are exactly the turns that sound like a generic assistant. Those are
also the first turns a new person reads.

So the core is present on every single turn regardless of what else happens:
identity, cadence, how she grounds a claim, and what she declines.

## Where it lives, and why it is a content file

`content/lelanea_voice_fingerprint.json`, the seventh file under `content/`,
with a Zod schema in `lib/app/content/schemas.ts` and
`getVoiceFingerprint()` in `lib/app/content/index.ts`.

It is her authored words, and this repo already has one rule for those:
`.context/app/planning/README.md` says the content files govern _"anything
authored by Lelanea, which is never paraphrased in the build"_, and
`lib/app/eslint.config.mjs` fails any import of `content/*.json` from outside
`lib/app/content/**`. A loose TypeScript constant in a new directory would be a
second authoring path for her voice — which is the thing that rule exists to
prevent.

### It is the one content file that is a DRAFT

The six files beside it are transcriptions of documents she wrote, corrected for
typography and nothing else. This one was **drafted from** them, in her register.
No volume of corpus produces this text; a model can draft it, and that draft is a
good use of the material, but the draft is an input to her reading it rather than
a substitute.

The file says so about itself. `fingerprint.provenance` is a required block
carrying `status: 'drafted_from_corpus'` and `awaitingSignOffFrom`, it is
**served** rather than withheld like `reviewNotes`, and a case in
`tests/unit/lib/app/content/voice-fingerprint.test.ts` pins the name in it. That
case is **meant to be edited** — once, on the day she signs the core off.

Her sign-off is a feature-level check before ship (`fp3b`), not a criterion any
pull request can satisfy.

## Four authored blocks onto three columns

`AiAgentProfile` carries exactly the three columns this needs, and
`lib/orchestration/agents/resolve-effective-prompt.ts` composes them in a fixed
order (persona → instructions → guardrails → brand voice) with per-field
`override` / `append` against the agent. `lib/app/voice/fingerprint.ts` does the
projection:

| Authored block             | Column                   |
| -------------------------- | ------------------------ |
| `identity`                 | `persona`                |
| `grounding` + `boundaries` | `guardrails`             |
| `cadence`                  | `brandVoiceInstructions` |

The mapping is **code rather than data**. Put it in the JSON and an author can
route a block to the wrong column — and a persona in the guardrails slot is not a
validation error, it is a subtly worse prompt nobody can see.

`grounding` joins `boundaries` rather than `cadence` because its load-bearing
half is a rule, not a manner: _answer from her material; where you have nothing,
say so._

**Every beat gets its own line.** The single-line cadence runs through her
written work and is authored, not an artifact of transcription. A block whose
beats are all empty emits **nothing at all**, not a bare heading: a heading with
nothing under it reads to a model as a section that exists and has nothing to
say, and it would defeat the seed's emptiness guard by keeping every section
truthy.

## The version travels in the prompt

The last line of the persona is a marker —
`Voice fingerprint: lelanea_voice_fingerprint_core v1.0` — so an evaluation can
attribute an output to the text that produced it without being told out of band
which version was live. `readFingerprintVersion()` reads it back out.

Version identity travels with the authored file and the seed, never with a
database timestamp, so the same version resolves identically in every
environment. The schema constrains the string to `major.minor[.patch]`, because a
version that cannot be ordered cannot be compared and `"v2 draft"` is not a
version.

The marker rides **with** the identity rather than beside it. Emitted on its own
it would stamp a version onto an empty persona, and an evaluation would then
attribute an output to a version of her voice that never reached it.

## The agent, and the profile it inherits from

`prisma/seeds/app-lelanea/003-voice-fingerprint.ts` writes two rows:

- **`AiAgentProfile` `lelanea-voice-core`** — a **pure code projection**,
  reconciled on every run. No operator is meant to hand-edit her voice in the
  admin UI. (That is the opposite call from the designation tags below, whose
  names and descriptions _are_ operator-owned — a tag name is a label, this text
  is the artefact.)
- **`AiAgent` `lelanea-guide`** — the first agent that speaks as her. Created
  once; only `profileId` and `knowledgeAccessMode` are reconciled afterwards.
  Everything else — name, description, temperature, activation — is left to
  whoever edits it.

**The agent's own persona / brand voice / guardrails columns are left NULL**, so
the profile is what speaks. Sunrise's per-field resolution defaults to
`override`, so a second copy of her voice on the agent would silently win and
then drift. A case in `tests/unit/lib/app/voice/fingerprint.test.ts` records that
hazard rather than leaving it to be rediscovered.

A profile rather than the agent's own columns because the core is one artefact
shared by every agent that speaks as her. Writing it onto each agent would make a
change to her voice an N-place edit, and the places would drift.

## What the core is not

The other two layers of the fingerprint — context-selected overlays and
retrieved exemplars — are later work, and a user's voice leanings are a filter
over those. **Neither may reach what is in the core.** It is the invariant that
no preference and no retrieval result can soften.

The seed **binds no capabilities**: `search_knowledge_base` and the exemplar
contributor are t-27's. The mode below is set now so the rule is already live
when the tool arrives, rather than being something somebody has to remember.

It also leaves `visibility` at the platform default (`internal`). Widening it
belongs to whichever task builds the surface a member talks to; shipping a
publicly reachable agent ahead of that surface would be a live endpoint nobody
had designed.

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
narrows: the rule is inert rather than wrong. The **Agent may quote** column's own
help text names the precondition, so the surface does not assert more than it can
deliver.

**The precondition is met.** `003-voice-fingerprint.ts` creates
`lelanea-guide` with `knowledgeAccessMode: 'restricted'` written explicitly into
the `create`, never left to the column default, and
`tests/unit/prisma/seeds/app-lelanea/voice-fingerprint.test.ts` runs the seed
against a stateful fake world and then asks Sunrise's real
`resolveAgentDocumentAccess` what it makes of every `lelanea-`-slugged agent the
seed left behind. Reverting the mode fails that file; so does dropping the column
from the `create`.

**One residual, stated rather than discovered.**
`SYSTEM_AGENT_PROTECTED_FIELDS` is `['slug', 'systemInstructions', 'isActive']` —
it does **not** cover `knowledgeAccessMode` — so an admin PATCH can still flip
her agent to `full` after the seed has run, and the failure is as silent as it
ever was. Widening the platform's protected list is Sunrise's call, not a leaf's.

The seed is the remedy, which is why that column is reconciled on every run
rather than set once at creation — but **`npm run db:seed` alone will not do
it**. The runner skips any unit whose content hash is unchanged, and correcting a
row that drifted underneath it is exactly the case where nothing in the tree has
changed. Clear the unit's history row first:

```sql
DELETE FROM seed_history WHERE name = 'app-lelanea/003-voice-fingerprint';
```

then `npm run db:seed`. Worth knowing before trusting a re-seed to fix any
drifted row, here or anywhere else.

### `client` is vocabulary without a mechanism behind it, deliberately

Client transcripts are **deferred**, not excluded (owner ruling, applied at
planning). `sensitivity-client` exists from day one so a document can be marked
honestly at the moment it is uploaded; nothing is seeded from that source and no
grant rule admits it. Recording the deferral in the vocabulary is what stops it
being rediscovered later as an undesignated pile of transcripts nobody dares
touch.

## The files

| File                                                    | What it is                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `content/lelanea_voice_fingerprint.json`                | The authored core — her identity, cadence, grounding and hard nos       |
| `lib/app/voice/fingerprint.ts`                          | The projection onto the three profile columns, and the version marker   |
| `prisma/seeds/app-lelanea/003-voice-fingerprint.ts`     | The profile and the first `lelanea-` agent                              |
| `lib/app/voice/designation.ts`                          | The vocabulary, the slugs, the agent prefix, and the rule as a function |
| `lib/app/voice/corpus-access.ts`                        | The rule against the database, and which agents it widens               |
| `lib/app/voice/designation-admin.ts`                    | The admin list and the partitioned write                                |
| `lib/app/voice/endpoint.ts`                             | The paths, so components do not hardcode them                           |
| `lib/app/knowledge-access-contributors.ts`              | The seam registration — one contributor, `lelanea:designated-corpus`    |
| `lib/validations/app-knowledge-designation.ts`          | The wire contract                                                       |
| `prisma/seeds/app-lelanea/002-knowledge-designation.ts` | Where the six tags come from                                            |
| `components/app/admin/designation-table.tsx`            | The table                                                               |

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

## The seeds

Two units, and they classify their rows in **opposite** directions (`fp4`). Worth
holding both in mind before editing either.

`prisma/seeds/app-lelanea/003-voice-fingerprint.ts` treats the profile's three
text columns as a **pure code projection** and reconciles them on every run: they
are the artefact itself, and nobody is meant to hand-edit her voice in the admin.
The agent beside it is **split** — `profileId` and `knowledgeAccessMode` are
code-owned invariants and are reconciled; its name, description, temperature and
activation are written once and then belong to whoever edits them.

It re-runs when either `content/lelanea_voice_fingerprint.json` or
`lib/app/voice/fingerprint.ts` changes (`hashInputs`), so a new line in her
identity or a change to which block lands in which column reaches the database
rather than leaving it a version behind. On a database already carrying the
current version it issues **no write at all**.

It also refuses to write a composed section that came back empty — by
**throwing**, which is the part that matters. `prisma/runner.ts` upserts the
`SeedHistory` row the moment `run()` resolves and logs `✓ applied`, so a quiet
`return` would bank the aborted run as a success and every later `db:seed` would
skip the unit, leaving a fresh install with no profile and no agent until
somebody deleted the history row by hand. The strict schema makes an empty source
hard to reach today, but the loader's own docblock says the file moves behind a
database the first time copy has to change without a deploy, and on that day the
guard is the only thing between a bad read and a profile with no voice in it.

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
| `tests/unit/lib/app/voice/fingerprint.test.ts`                      | The core reaches the prompt with nothing retrieved — load-bearing     |
| `tests/unit/prisma/seeds/app-lelanea/voice-fingerprint.test.ts`     | The seed's writes, its idempotence, and `restricted` via the resolver |
| `tests/unit/lib/app/content/voice-fingerprint.test.ts`              | The authored file parses, and still says it is awaiting sign-off      |
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

## Not yet built

The context contributor that reads voice-designated material and labels it by
origin is t-27, along with `search_knowledge_base` on her agent and the retrieved
exemplars. The sign-off and review path — nothing about how she sounds changing
without her hearing it first — is t-28.

Context-selected overlays, and the user's voice leanings that filter them, are
later still. Neither may reach the core.
