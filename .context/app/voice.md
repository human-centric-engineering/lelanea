---
name: app-voice
description: The three layers of the voice — the always-on core, the register overlays, her own retrieved sentences — the designation rule that keeps voice-only material off the tool path, and the golden set she is heard through before anything changes.
---

# Voice: the three layers, and what may be quoted

Three layers and one rule, doing different jobs.

| Layer                     | Where it rides                     | Present when                    |
| ------------------------- | ---------------------------------- | ------------------------------- |
| The **core**              | the agent's profile columns        | every turn, unconditionally     |
| The **register overlays** | a `LOCKED CONTEXT` block           | the turn names a situation      |
| Her **own passages**      | the same block, labelled by origin | her voice material is retrieved |

The **designation rule** cuts across all three: it decides which of her documents
a retrieval tool may quote back at someone, and which may only ever be shown as
an example of how she sounds. Read the core first; it is the thing a person
actually meets.

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

**Every heading and label is authored too** — `boundaries.howYouDeclineHeading`,
`cadence.reachesForLabel` and `cadence.avoidsLabel` included. Each is copy the
model reads, so a string literal in `fingerprint.ts` would be her words arriving
through a second authoring path — the exact thing the content seam and its
ESLint rule exist to prevent. It also means a core authored in another `locale`
translates whole, rather than emitting two English labels into an otherwise
translated section.

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
  once, with **three** columns reconciled afterwards, for two different reasons.
  `profileId` and `knowledgeAccessMode` because both are load-bearing invariants
  rather than preferences; `systemInstructions` because
  `SYSTEM_AGENT_PROTECTED_FIELDS` covers it — so no operator can set it, and a
  write-once field would be unreachable by _anyone_ after the first create.
  Everything else — name, description, temperature — is left to whoever edits
  it. `isActive` is on that protected list too, so a system agent cannot be
  deactivated through the admin at all; activation is not among the things an
  operator owns here.

**The agent's own persona / brand voice / guardrails columns are left NULL**, so
the profile is what speaks. Sunrise's per-field resolution defaults to
`override`, so a second copy of her voice on the agent would silently win and
then drift. A case in `tests/unit/lib/app/voice/fingerprint.test.ts` records that
hazard rather than leaving it to be rediscovered.

A profile rather than the agent's own columns because the core is one artefact
shared by every agent that speaks as her. Writing it onto each agent would make a
change to her voice an N-place edit, and the places would drift.

## What the core is not

The other two layers — the context-selected overlays and the retrieved exemplars
— are below, and a user's voice leanings are a filter over those. **Neither may
reach what is in the core.** It is the invariant that no preference and no
retrieval result can soften.

The seed **binds no capabilities**, and still does not: the exemplar path does
not need one (it calls the search _service_ directly, below), and binding
`search_knowledge_base` to her agent belongs with the surface a member talks to
her through. The `restricted` mode below is set now so the rule is already live
when a tool does arrive, rather than being something somebody has to remember.

It also leaves `visibility` at the platform default (`internal`). Widening it
belongs to whichever task builds the surface a member talks to; shipping a
publicly reachable agent ahead of that surface would be a live endpoint nobody
had designed.

---

# The register for the moment, and her own sentences

The core makes her sound consistent. It cannot make her sound _specific_: the
register of a first hello and the register of someone in grief are not the same
register, and a core that tried to hold both would have to say something vague
enough to cover them — which is how a voice stops being a voice.

So a turn that names a **situation** gets a second block, spliced into the system
prompt by Sunrise's prompt-context seam. It carries two things: the register that
moment calls for, and real passages of her own writing.

## How a turn asks for it

A chat request carries one `(contextType, contextId)` tuple.
`lib/app/context-contributors.ts` registers the leaf's loader for
`contextType: 'voice'`, and `contextId` is the **situation**:

```
contextType: 'voice'
contextId:   'first-meeting' | 'discovery' | 'values' | 'difficulty'
```

**One tuple per turn, so a context type is a claim on the whole turn.** A turn
carrying Daybreak's `module` type gets the framework's module block and not this
one. Re-registering `module` here to wrap the framework's loader would work —
the registry is keyed by type and re-registering replaces — and it would be the
same mistake as filling one of Daybreak's `lib/app/*` bridges: fine until the
next sync.

**What sends the tuple today.** The admin orchestration chat, which passes a
caller-supplied `contextType` straight through, so an operator (or she) can
exercise this now. The core consumer route deliberately refuses one ("admin-only
concepts"), so the surface a member eventually talks to her through will pin it
server-side the way `app/api/v1/framework/modules/[slug]/chat/stream/route.ts`
pins `module`. **Stated rather than left to be found**: until that surface
exists, this path is live and exercised but not yet on a member's turn.

## Selection is a lookup, and stays one

`lib/app/voice/overlays.ts`. Exact match on the trimmed, lower-cased situation
key; `null` for anything else. No fuzzy matching and no "closest overlay" — the
register a person meets must not depend on a similarity score, and the same
situation must compose the same block in every environment.

An unknown situation falls back to **core-only**: the authored `coreOnly` body
and nothing else. Two things about that fallback are deliberate and both are
asserted:

- **It is never empty.** A blank block reads to a model as a section that exists
  and has nothing to say, and to whoever is debugging a prompt as a loader that
  failed.
- **It does not report a search it never ran.** With no overlay there is no
  authored query, so nothing is looked for — and the "no passage of hers was
  found" note, honest after an empty search, would be a small lie here.

## Her passages, and why they do not come through the tool

`lib/app/voice/exemplars.ts` calls the knowledge search **service** directly,
with an explicit allowlist of voice-designated documents. It does not go through
`search_knowledge_base`, and the rule below is unweakened: that tool is the path
that can **quote**, and a `voice` document is absent from it.

Two sets over one corpus, taking the opposite half of the vocabulary each:

| Set                            | Purposes            | Consumer                              |
| ------------------------------ | ------------------- | ------------------------------------- |
| `resolveQuotableDocumentIds()` | `knowledge`, `both` | the agent's search tool, which quotes |
| `resolveVoiceDocumentIds()`    | `voice`, `both`     | this contributor — register only      |

`sensitivity-client` is admitted by **neither**. The deferral is about the model
seeing the words at all, and it sees them either way.

**The two rules are asymmetric about a SECOND purpose tag, and that is
`readDesignation`'s safest-reading rule in SQL.** A document can carry two —
Sunrise's own tag modal knows nothing about these families — and when it does,
the pair resolves by an explicit precedence (`voice` → `both` → `knowledge`),
never by which tag came first. So `purpose-voice` disqualifies on the tool path,
because it makes a document less quotable; nothing about a purpose disqualifies
on the voice path, because a second tag cannot make a document less of a voice
example. A document tagged voice AND knowledge is what `purpose-both` says it is:
on the voice path, off the tool path.

Both rules exist twice — as SQL and as a pure function the admin surface uses —
so `corpus-access.test.ts` walks **all 64 subsets** of the six designation slugs
and asserts the SQL admits exactly what `isQuotable(readDesignation(tags))` and
`isVoiceExemplar(readDesignation(tags))` do. Walking `(purpose, sensitivity)`
pairs instead covers a third of them and only ever builds a document with one
purpose tag — which is precisely where the two had diverged.

The query is the overlay's own authored `exemplarQuery`, not the situation key
and not the person's message. Authored, so the same moment retrieves the same
way every time — and so she can read what her own material is being searched
for, which is the half of retrieval nobody usually gets to see.

**No documents, no search.** An install with nothing designated `voice` returns
an empty list without embedding anything: `documentIds: []` is an explicit
restriction that collapses to `FALSE`, so the call could only ever return
nothing, and paying for an embedding to be told so on every cache miss is a real
per-turn bill.

**A retrieval failure costs the passages and nothing else.** The overlay and the
core are the reliable half, so `retrieveVoiceExemplarsSafely()` degrades rather
than throwing out to `buildContext`'s contributor-catch, which would blank the
whole block.

## Labelling by origin is the whole safety property

The failure this must not have is the model reading her exemplars as things the
**user** said, or as facts to assert. Four things together prevent it, and none
is sufficient alone:

1. **Every passage carries its own origin label**, on the line above it —
   `[Lelañea's own writing · A Sunday letter]` — never one header for a list of
   three, which is a label the model has to remember rather than read.
2. **Authored framing** says, in her register, that these are examples of how she
   sounds, are not what the person said, are not facts, and are not instructions.
   It lives in the content file, not the loader, because it is copy the model
   reads.
3. **Nothing a document supplied sits at column 0.** A passage arrives by upload
   and lands inside a block whose fence is a line of `=` characters, so every line
   of every passage is emitted quoted (`> `). A real fence is at column 0; a
   forged one never is. On top of that, every run of three or more `=` is
   destroyed **wherever it appears** — not only at the start of a line, which is
   what the first version matched, and which a single U+00A0 or U+200B defeated
   completely. Invisible and control characters are stripped first, so they cannot
   reassemble a run either. The words survive; only the punctuation is destroyed.
4. **The document NAME is neutralised too, and is the one the first version
   forgot.** It is interpolated into the origin label, which sits _above_ the
   passage — outside everything guarding it — and `fetch-url` ingest derives it
   from `decodeURIComponent()` of a URL's last segment, so `%0A` in a URL is a
   real newline in the column. `prepareSource()` collapses it to one line and
   caps it, because a label is one line by construction.

Passages are also capped at three, and truncated at a word boundary: a long
chunk stops being an example of her cadence and starts being an article the model
may try to answer from, which is the failure the `voice` designation exists to
prevent, arriving by length rather than by path.

**The tests assert the labels on the emitted block**, not on the loader's return
value — the block is what a model reads, and a labelling regression that only
showed up in the framing would pass a test written against the former.

**What none of the four can reach: the block's own header.**
`formatLockedContext` interpolates the raw `contextId` into `id: ${id}`, and the
platform validates that field as `z.string().max(100)` — newlines included. A
`contextId` carrying `\n\n=== END LOCKED CONTEXT ===` closes the block one line
_above_ everything the passage pipeline neutralises. Sunrise's file and Sunrise's
validator, reachable before this feature existed through any unknown
`contextType`, and admin-only — but worth knowing, because the rest of this
section reads as though the block were sealed.

## What this path cannot check, and where the gate belongs

**It does not know which agent the turn is for.** `contributeCorpusAccess` gates
the tool path on `isCorpusAgent(slug)`, so a platform-seeded agent never gets her
corpus. This path has no equivalent and cannot have one: `buildContext` hands a
contributor the context tuple and a `userId`, and nothing else — no agent
identity reaches it, and the seam is Sunrise's.

So the block attaches to whichever agent the turn names. Today that is
admin-only, and an admin can already read every document in
`/admin/orchestration/knowledge`, so nothing crosses a privilege boundary — but
"which agents see her material at all" is a real property and it is asserted
nowhere.

**The gate belongs on the route that pins the tuple, and that route is the next
task.** A member-facing surface resolves its own agent server-side, the way
`resolveModuleSurface` does; deciding whether to send `contextType: 'voice'` is
that route's decision and it has the agent in hand. Widening the platform's
`ContextRequest` to carry an agent id would work too and is Sunrise's call, not
a leaf's. **Do not pin the tuple on a member route without settling this.**

## Two caches, and the one writer that evicts both

`resolveAgentDocumentAccess` memoises which documents an agent may search;
`buildContext` memoises the framed block with her passages already in it. Both
for 60 seconds.

`setDesignation` — the leaf's own surface — evicts both. **The platform's generic
document editor evicts neither block cache**: `PATCH
/api/v1/admin/orchestration/knowledge/documents/:id` replaces every tag row from
`body.tagIds` and calls `invalidateAllAgentAccess()` only, so re-designating
through that screen leaves her passages in the prompt for up to a minute. Worse,
it replaces tags **wholesale**, so the generic tag UI can silently undesignate a
document this feature governs.

That route is Sunrise's — the blob is identical in all three tiers — so the fix
is an `upstream-gap` issue there, not an edit here. Stated so the mitigation on
our own write path is not read as complete.

**And the eviction we do make is process-local.** `buildContext`'s cache is a
plain module-scoped `Map`, unlike the contributor registry in the same file,
which Sunrise deliberately backs with `globalThis` because Turbopack loads
`instrumentation.ts` in a separate module graph. On more than one instance, a
designation made through instance A leaves instance B serving its cached block —
that document's passage still in it — for the rest of the TTL. Also Sunrise's,
and also an `upstream-gap`.

## It is the same for every user, on purpose

`buildContext` hands a contributor the request's `userId` and partitions its
60-second cache by it, so a per-user block is available. This one does not use
it. A user's voice leanings are a later filter over these two layers, and until
that is designed, one person's preference silently reshaping how she sounds is a
change nobody asked for and nobody can see.

The cost is a cache partitioned more finely than the answer needs: one embedding
per cache miss per user, and per **spelling** of a situation rather than per
situation — normalisation happens inside the contributor, which is below the
cache, so `first-meeting` and `First-Meeting` select the same overlay through two
entries. The tolerance is worth more than the duplicate: a hand-typed key that
silently fell back to core-only would be a wrong answer that looks like a right
one, and a route pinning the key server-side sends one spelling anyway.

**Two sixty-second caches, and the designation write evicts both.**
`resolveAgentDocumentAccess` memoises which documents an agent may search;
`buildContext` memoises the framed block, her retrieved passages already in it.
`setDesignation` calls `invalidateAllAgentAccess()` **and** `clearContextCache()`
— without the second, a document re-marked `sensitivity-client` goes on reaching
the system prompt of every conversation whose block was built in the preceding
minute.

## The overlays are her words too, and are a DRAFT

`content/lelanea_voice_overlays.json` — the **eighth** authored file, and the
second one that was drafted from the corpus rather than transcribed. Same
discipline as the core: every heading, label, beat and note the model reads is
authored there, the origin label included, and `fingerprint.provenance` says the
file is awaiting her sign-off. A case in
`tests/unit/lib/app/content/voice-overlays.test.ts` pins the name in it, and is
**meant to be edited** once, on the day she signs them off.

Four situations, chosen because the app has them today: arriving, the thirty
discovery questions, the values work, and something painful surfacing. Adding a
fifth is an edit to that file and nothing else — there is no TypeScript list of
situations to fall out of step with it. A duplicate situation is a **parse
error**, because selection is a lookup and the second would be silently
unreachable.

An overlay **shades** the core; it never softens it and never restates it.
Anything true of every turn belongs in the core file.

## The files

| File                                   | What it is                                              |
| -------------------------------------- | ------------------------------------------------------- |
| `content/lelanea_voice_overlays.json`  | The authored overlays, the labelling copy, the fallback |
| `lib/app/voice/overlays.ts`            | Selection — an exact-match lookup, and nothing more     |
| `lib/app/voice/exemplars.ts`           | Retrieval, the passage pipeline, the label guard        |
| `lib/app/voice/context-contributor.ts` | Composition, and the origin labels                      |
| `lib/app/context-contributors.ts`      | The seam registration — one contributor, type `voice`   |

| Test                                                   | Proves                                               |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `tests/unit/lib/app/voice/context-contributor.test.ts` | The whole chain, on the emitted block — load-bearing |
| `tests/unit/lib/app/voice/exemplars.test.ts`           | The allowlist, the fences, the label, the degrade    |
| `tests/unit/lib/app/voice/corpus-access.test.ts`       | Both rules against all 64 tag sets — load-bearing    |
| `tests/unit/lib/app/voice/overlays.test.ts`            | Selection is a lookup, and stays deterministic       |
| `tests/unit/lib/app/context-contributors.test.ts`      | Exactly one contributor, and which type              |
| `tests/unit/lib/app/content/voice-overlays.test.ts`    | The authored file parses, and still awaits sign-off  |

Reverting the feature fails them: drop the origin label and three cases go red;
remove `'voice'` from `VOICE_PATH_PURPOSES` and nineteen do across three files;
anchor the fence neutraliser to the start of a line again and two do; stop
sanitising the document name and one does; drop the `> ` quoting and two do;
empty the seam and eighteen do. Every one of those was run rather than reasoned
about — a "reverting fails this" claim nobody executed is decoration.

---

# Nothing changes without her hearing it first

A voice fingerprint is tuned by editing prose, and prose edits have no compiler.
Change a clause in the core to fix one awkward reply and three other replies
quietly get worse — nothing fails, nothing is logged, and there is no way to
notice except by reading everything again.

So there is a fixed set of questions, asked twice: once through her assembled
prompt, once through a model told nothing about her. Both answers stay attached
to the version of her core that produced them.

## What is Sunrise's, and what is ours

Sunrise already ships the harness — `AiDataset`, `AiEvaluationRun`,
`AiEvaluationCaseResult`, a lease-claiming worker that drains a run on the
maintenance tick, and judge agents to score one. **None of it is reimplemented.**
A comparison is two ordinary platform runs.

What the platform has no notion of is an **arm**. A run records which agent
answered and nothing about which version of her voice that agent was wearing, and
`AiEvaluationRun` has no free column to put it in. `AppVoiceComparison` /
`AppVoiceComparisonArm` record the missing half.

**It is stored rather than derived**, and that is the decision to understand
before changing anything here. Reading the version off the profile at render time
is right until the core changes — after which every historical run silently
re-attributes itself to the new version, and "v1.0 beside v1.1" becomes v1.1
beside itself. The composed **system prompt** is stored whole beside it, because
the version string is a claim and the prompt is the evidence.

## The two arms

| Arm           | Agent                | Wears                                     |
| ------------- | -------------------- | ----------------------------------------- |
| `fingerprint` | `lelanea-guide`      | the profile — her core, marker and all    |
| `bare`        | `voice-control-bare` | the authored `control.systemInstructions` |

**The control's slug does not start with `lelanea-`, and that is load-bearing.**
That prefix is what `isCorpusAgent()` matches, so a control named
`lelanea-control` would be handed her designated corpus the moment anything bound
`search_knowledge_base` — and the arm meant to show what a bare model does with
her questions would start answering out of her documents, with the comparison
still calling it the bare arm. Nothing about that would fail.

**Running only the assembled arm** would tell you an output exists, not that the
fingerprint did anything. That is why the control is not optional.

## The guard is the point

Every way this feature fails is silent. A profile detached from her agent, a
control pointed at her profile, both arms resolving to the same agent, a model
pinned on one side through the admin form — none throws, none logs, and every one
produces two walls of plausible prose that look exactly like a comparison in
which her fingerprint changed nothing.

So `assertArmsComparable()` composes **both** prompts before anything is queued
and refuses unless all four hold:

| Check                                                 | The misconfiguration it catches                |
| ----------------------------------------------------- | ---------------------------------------------- |
| the fingerprint arm's prompt carries a version marker | the profile came detached from her agent       |
| the bare arm's prompt carries none                    | somebody pointed the control at her profile    |
| the two prompts differ                                | both arms are the same agent, or the same text |
| provider, model and temperature match                 | the comparison is silently a model comparison  |

Each refusal names the arm and the remedy (`HB10`). The whole queue is one
transaction, so a refusal leaves no runs behind — a half-queued comparison would
drain anyway and spend real money on answers nothing could read back.

The version is read out of the **composed prompt**, never off the content file.
Reading the file answers "which version is authored"; reading the prompt answers
"which version is this agent about to be told", and only the second is something
an output can honestly be attributed to.

## The golden set is a ninth content file, and a versioned dataset

`content/lelanea_voice_golden_set.json`. It is the odd one out of the nine: the
prompts are what a PERSON says to her, not her words. It is authored in the
content seam anyway, because the set decides which moments she is ever heard in —
and a probe set an engineer can silently retune is the same failure this feature
exists to prevent, one level out.

Five prompts, covering four moments, and the coverage is **structural**: the
schema's `superRefine` fails a file missing any of `greeting`, `decline`,
`grounded-claim` or `retrieval-empty`. The last is the load-bearing one — nothing
is retrievable behind it, so whatever register survives came from the core alone.

**There is no `expectedOutput` anywhere**, deliberately. Whether an answer reads
as her is her judgement on a deployed build; a reference answer would invite a
grader to score a string comparison and report a number for it. Every
reference-required grader is therefore structurally unusable against this
dataset, which is correct rather than a gap.

**The dataset id carries the version** — `lelanea-voice-golden-set-v1.0` — because
a case cannot be deleted once a run has scored it: `AiEvaluationCaseResult
.datasetCase` declares no `onDelete`, so Prisma's default `Restrict` applies. So
`004-voice-golden-set.ts` reconciles a version nothing has run yet, and
**refuses** one something has, naming the remedy: bump `goldenSet.version`, which
mints a new dataset beside the old one. Reconciling instead would re-caption every
historical answer with a question it was never asked.

## The judge is pinned to HER voice on both arms

One metric: `eval-judge-brand-voice`, a platform-seeded judge. Sunrise's own
run-create route pins `subjectBrandVoice` from _the subject agent's_ brand voice,
which for the control is null — the judge would fall back to a generic rubric and
score the bare arm against nothing in particular. Both arms are pinned to the
FINGERPRINT arm's brand voice instead, because the question asked of both is the
same one: _does this sound like her?_ A number that cannot be compared with the
other arm's is worse than no number.

A comparison refuses to queue if that judge is missing or inactive, rather than
coming back unscored — two walls of text look exactly like a scored comparison.

## The surface

`/admin/app/voice` — **Voice** in the Lelañea admin section. The set is called
_the voice test set_ on screen: "golden set" is the term in this document, in the
content file and in the schema, and it stays there, but it is jargon on an
operator page. One button queues a comparison, a dialog shows the authored
questions and the control's whole system prompt before anything has been run; a picker puts a second one's columns in the same table,
which is how two versions are read side by side. Each comparison brings its own
bare arm, so a drop that both versions share is the model having a different day
rather than her voice changing.

**The page is two sections, and the split is the point.** A **Run** panel is
everything above the fold: what a run would ask, what it would cost, and the
button. Under it, **Results** carries the two pickers and everything about
reading runs. The pickers used to sit in the same row of controls as the button,
which put "which run am I reading" beside "spend money on a new one" — two
different jobs, one of which is reversible. An admin arriving to run the test now
meets only the invitation.

**A run in flight is shown in motion.** Once an arm is draining, the Run panel
stops being an invitation and becomes the run: a bar per arm advancing as cases
land, the drained-of-expected count, and a pulse. The motion is what separates a
page still attached to the run from one that has quietly stopped polling — a
static count reads identically in both. Every animation is a stock Tailwind
utility (`animate-ping`, `animate-pulse`, `animate-spin`) because custom
keyframes would have to be added to `app/globals.css`, which is Sunrise's; all of
them drop out under `prefers-reduced-motion`, and every fact they decorate is
written out in text as well.

Three things it shows that a scoreboard would not: **the prompt each column was
given** (stored at queue time, so it is what produced the answers even if her core
has since changed), **what each question was probing**, and **that a run is not
finished** — answers arrive a case at a time as the worker drains, so a missing
answer says whether it is "not yet" or "it failed" rather than leaving somebody
looking at a half-empty table.

### `completed` does not mean there is a result here

Two counting traps, both of which render a failed arm as a working one. They are
the same mistake at two levels, so fix them together or not at all.

**`casesDone` is cases ATTEMPTED.** A case that failed still writes a result row,
so the questions actually answered are `casesDone - casesFailed`. Reading
`casesTotal` as "answered" because the run says `completed` is what produced
`answered all 5, 5 failed` — a self-contradiction whose first half is simply
false, on the one surface whose job is to say whether her voice has been checked.
`armStatusLine()` now gives the all-failed case a sentence of its own rather than
a count, because a reader scanning a column of numbers does not stop to subtract.

**A failed case's `subjectOutput` is an empty STRING, not null.** So
`output === null` passes it through as a real answer and the cell renders an
empty paragraph — a column that says nothing at all, which reads as "still
coming" forever. The check is on trimmed length.

Both exist because upstream records a run in which **every** case failed as
`status: 'completed'` with `errorMessage` null and `summary.scoredCount: 0` —
filed as `sunrise#801`. Until that lands, `completed` is not evidence of a
result and this surface has to do the arithmetic itself.

### Before the press, and after it

**The button says what it spends.** `GET /api/v1/admin/app/voice/preflight` reads
back the model that would answer, the number of questions, and a planning-grade
USD range for the whole comparison — both arms answering every case, and the
judge scoring every answer. It is the platform's own
`estimateEvaluationRunCost` called once per arm — scoped to the calling admin,
since that is the ownership column its empirical calibration reads past runs
through — and added, rather than one arm doubled: the two are only guaranteed equal while the arms stay comparable, which
is the thing `assertArmsComparable` refuses to assume. A model with no published
rate prices at $0, so `pricingKnown: false` travels with the number and the
surface says "cost unknown" instead of a figure that reads as free. Every part of
it can come back null — an unseeded set, a missing judge — and the route still
answers 200, because this is a line above a button and the page is the
comparisons.

**A run can be stopped.** `POST /api/v1/admin/app/voice/comparisons/:id/cancel`
flips both arms' runs to `cancelled`. The platform does the actual stopping:
`run-worker.ts` re-reads status between cases and exits, and `markTerminal` is
guarded by `status='running'`, so a tick already mid-case finishes that one and
can never revert the row. It is the COMPARISON that stops, not a run — cancelling
one arm leaves a full column beside a truncated one, which is the shape of a
result rather than of an abandoned run, and it does not stop the spend either. An
arm that finished in the same tick comes back in `alreadyFinished` rather than
failing the call: the button lives on a polling surface, so that race is
ordinary.

### The page polls one endpoint, and that is a cap, not a preference

Every route under `/api/v1/admin/` is on the platform's `admin` tier — 30
requests a minute, keyed on the admin's user id (`lib/security/rate-limit-policy.ts`).
The board originally polled the list AND the detail every four seconds, which is
exactly 30/min: a run long enough to be worth watching spent its whole life at
the cap, and the operator watched it through a "Too many requests" banner. It now
reads the detail alone every five seconds — 12/min — and falls back to the list's
statuses only when the detail is absent, which is what keeps a dropped request
from ending the polling for good. A 429 pauses it for a minute rather than
retrying into an empty bucket.

**Answers are joined by case KEY, not by position.** Two versions of the set are
allowed to reorder, drop and add prompts — that is what a version is — so a
positional join would line the greeting up against the decline and render it as a
regression. A question one version asked and the other did not renders as a gap,
because a case silently missing from a comparison reads as a case that passed.

**A key can be kept while its prompt is reworded**, and then no single wording is
entitled to head the row. A case whose wording differs across the comparisons on
screen is flagged (`promptVaries`), the heading says so, and each column carries
the question it was actually asked. `mixedGoldenSets` already says the two sets
differ _somewhere_; that is not the same claim.

**An arm can outlive its run.** `AiEvaluationRun.user` cascades, so erasing the
admin who queued a comparison deletes their runs — and the arm rows survive it
(`ON DELETE SET NULL`), keeping the stored prompt, the version and the record
that the check happened. The arm then reports `run-deleted` rather than an empty
progress bar that reads exactly like `queued`, and every cell in its column says
the answers are gone rather than that they have not arrived. The column stays in
the grid: dropping it would slide every other answer one heading to the left.

## What the comparison cannot check

**It hears the CORE, not the overlays or the exemplars.** Sunrise's subject-case
runner (`lib/orchestration/evaluations/run-cases/agent-case.ts`) calls
`drainStreamChat` with no `contextType` / `contextId`, so no prompt-context
contributor fires on an evaluation turn — including ours. Layers two and three of
the fingerprint are not covered, and no configuration here can cover them. It is
a Sunrise gap; the blob is identical in all three tiers, so Daybreak could not
action it either. Listed with the others below.

**Whether an answer reads as her is hers to say.** This ships the set, both arms
and the surface that makes the judgement cheap to make. Her verdict is the
feature's done-when, checked before ship (`fp3b`), not something any pull request
could satisfy.

**The dataset is owned by the install, not by a person** (`userId: null`), so it
does not appear in the platform's own dataset list at
`/admin/orchestration/evaluations/datasets`, which filters on the session user.
The runs DO appear in the platform's run list, because they carry the queuing
admin's id.

## The files

| File                                               | What it is                                                   |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `content/lelanea_voice_golden_set.json`            | The authored prompts, the control's prompt, the dataset copy |
| `lib/app/voice/golden-set.ts`                      | The ids, the arm vocabulary, the projection onto cases       |
| `lib/app/voice/comparison.ts`                      | The arms, the guard, the queue                               |
| `lib/app/voice/comparison-admin.ts`                | The list and the join-by-key read                            |
| `prisma/seeds/app-lelanea/004-voice-golden-set.ts` | The dataset, its cases, and the control agent                |
| `components/app/admin/voice-comparison.tsx`        | The board                                                    |
| `prisma/schema/app.prisma`                         | `AppVoiceComparison` + `AppVoiceComparisonArm`               |

Routes: `GET`/`POST /api/v1/admin/app/voice/comparisons` and
`GET .../comparisons/:id?against=<id>`. Page: `/admin/app/voice`.

## The migration

`prisma/migrations/20260916140000_app_voice_comparison` — apply with
`npm run db:migrate:deploy`, not `migrate dev`. The FK from the arm to
`ai_evaluation_run` is hand-written (a fork table must not add a reverse relation
field to a Sunrise-owned model), so the schema and the database diverge on
purpose and the development command reads that divergence as drift.
`lib/app/leaf-db-drift.ts` pins the constraint and its `ON DELETE SET NULL`. The
comparison → arm FK is NOT probed: both tables are ours, Prisma can see the
relation, and it will never emit a DROP for it.

**`SET NULL` and not `CASCADE`, which is the opposite of the obvious choice.** An
arm attributing a run that no longer exists sounds like the thing to avoid, and
cascading is how you avoid it — but the run's own FK to `User` cascades, so
`CASCADE` here meant that erasing one administrator destroyed the prompt, the
version and the evidence of every comparison they had ever queued, leaving an
`AppVoiceComparison` parent the surface still rendered with no arms at all. The
per-case answers go either way (`ai_evaluation_case_result` hangs off the run and
is Sunrise's to cascade); what must not go is the half these tables were added
for, none of which is about that administrator. A null means one specific thing —
the run that produced these answers is gone — and the surface says so.

## Tests

| File                                                           | Proves                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| `tests/unit/lib/app/voice/comparison.test.ts`                  | The arms are two arms, on the composed prompts — load-bearing |
| `tests/unit/lib/app/voice/comparison-admin.test.ts`            | The join is on the question, and a gap renders as a gap       |
| `tests/unit/prisma/seeds/app-lelanea/voice-golden-set.test.ts` | The seed's writes, its idempotence, and the freeze            |
| `tests/unit/lib/app/content/voice-golden-set.test.ts`          | The set covers every moment, and still awaits sign-off        |

Reverting the implementation fails them, and this was run rather than reasoned
about: delete the identical-prompt check and one case goes red; delete the two
version-marker checks and three do; delete the provider/model/temperature check
and three do; re-prefix the control `lelanea-` and one does; drop the seed's
freeze check, its control reconciliation, or its throw-on-empty and one each
does; join the read layer on position instead of key and one does.

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
(`CORPUS_AGENT_SLUG_PREFIX`, defined in `designation.ts` and re-exported here —
it is vocabulary, and it has to live in a module that imports nothing, because
`corpus-access.ts` imports `@/lib/db/client` and that builds a `pg.Pool` at
import time). A contributor can only **widen** a restricted
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
The agent beside it is **split** — `profileId`, `knowledgeAccessMode` and
`systemInstructions` are reconciled; its name, description and temperature are
written once and then belong to whoever edits them. (`isActive` belongs to
nobody here: it is protected, so a system agent cannot be deactivated through
the admin at all.)

It re-runs when either `content/lelanea_voice_fingerprint.json` or
`lib/app/voice/fingerprint.ts` changes (`hashInputs`), so a new line in her
identity or a change to which block lands in which column reaches the database
rather than leaving it a version behind. On a database already carrying the
current version it issues **no write at all**.

It also refuses to write when an authored block came back empty — by
**throwing**, which is the part that matters. It checks the four authored
**blocks** as well as the three composed **columns**, because the mapping is 4→3
and the coarse check cannot see a block go missing: `grounding` and `boundaries`
share `guardrails`, so losing her grounding rule alone still leaves that column
populated. `prisma/runner.ts` upserts the
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

**The surface a member talks to her through.** Nothing in the app pins
`contextType: 'voice'` server-side yet, so the overlay block reaches a turn only
through the admin chat today. Whichever task builds that surface pins the tuple
and chooses the situation, the way the framework's module route does.

**`search_knowledge_base` on her agent.** The seed still binds no capabilities.
The exemplar path does not need one, and binding the tool belongs with the
surface above — a model told to look things up with no tool to look with will
report having looked.

**Her sign-off.** The review path is built — the golden set, both arms and the
board above. What is not done is the judgement it exists to make cheap: three
files now await her, the core, the overlays and the golden set itself, and each
says so in its own `provenance` block. That is a feature-level check before ship
(`fp3b`), not something a pull request can satisfy.

**A user's voice leanings** — a filter over the overlays and the exemplars — are
later still, and may not reach the core.

**Five `upstream-gap` findings for Sunrise**, every one on a file whose blob is
identical in all three tiers (so Daybreak could not action any of them). The
three-way blob check in `CLAUDE.md` is what established that, per finding:

1. `formatLockedContext` interpolates the raw `contextId` into the block header,
   and `contextId` is validated as `z.string().max(100)` — so the fence is
   forgeable one line above everything a contributor can neutralise.
2. `PATCH /api/v1/admin/orchestration/knowledge/documents/:id` replaces a
   document's tags wholesale and evicts only the access cache, so it can silently
   undesignate a document and leave its passages in the prompt for a minute.
3. `buildContext`'s cache is a module-scoped `Map` while the contributor registry
   beside it is `globalThis`-backed, so `clearContextCache()` cannot reach
   another instance — or another module graph.
4. `embedText` sets no timeout and takes no `AbortSignal`, so a provider that
   stops answering rather than erroring hangs whatever awaits it. This feature
   works around it with its own race (`RETRIEVAL_TIMEOUT_MS`); every other caller
   on the turn path — `search_knowledge_base` included — does not.
5. `lib/orchestration/evaluations/run-cases/agent-case.ts` calls
   `drainStreamChat` with no `contextType` /
   `contextId`, so **no prompt-context contributor fires on an evaluation turn**.
   Any fork whose voice, tenancy or module context rides on that seam is
   evaluating a prompt its users never receive, and nothing reports the
   difference. Found by t-28, which can therefore hear the always-on core and
   neither of the other two layers.
