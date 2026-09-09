# Lelañea — Product & Platform Grounding Brief

*Prepared as background context for a build prompt. Not yet in the Daybreak repo. Accompanies six JSON content files (listed at the end).*

---

## 1. What Lelañea is

Lelañea is a transcendental-coaching companion app built around the work of **Lelañea Fulton** — Professional Certified Coach (PCC, ICF), Transcendental Coach, and Unity-Consciousness Guide. It is not a therapy app and must never present itself as one (this is a hard legal/ethical line — see §6).

The philosophy, in her own words (from the foundational documents):

- **Not self-improvement, but remembrance.** The work isn't becoming someone new — it's remembering who the user has always been beneath conditioning, inherited beliefs, and accumulated identities.
- **The lowercase self vs. the capital Self.** The conditioned personality (ego) vs. the deeper awareness contemplative traditions call the Higher Self / authentic nature.
- **Purpose is internal first.** It begins in the relationship the user has with themselves, not in an external destination.
- **Accessible by design.** The mission is explicit: transformative coaching has historically been gated by cost (1:1 coaching, retreats, private mentorship); the app exists to make it accessible regardless of financial means.
- **Lineage, not originality.** The app openly cites its influences — Jung (individuation, shadow, archetypes), Richard Schwartz (Internal Family Systems / parts work), Porges/Dana/Levine/van der Kolk (nervous system & somatics), Kabat-Zinn/Kornfield/Brach (contemplative practice), Maslow/Assagioli/Frankl (transpersonal psychology), and the Vedanta/Buddhist/Taoist/Hermetic/mystical traditions. Later modules (the "Spiritual Oneness" arc) shift into Lelañea's own original frameworks.
- **Coaching, explicitly not therapy.** The disclaimer and terms of use are unusually thorough on this point — see §6, because it materially affects how agents must be prompted and guardrailed.

**Voice register:** warm, direct, unhurried, philosophically literate, comfortable holding paradox (see the "polarity is not punishment" material in the values reference framework — nothing is framed as good/bad, failure/success). Single-sentence-per-line cadence is used deliberately in places (see `the_initiation` — do not collapse into flowing prose).

---

## 2. The experience model

**Navigation is chat-driven and only partly linear.** The user moves through numbered modules in sequence, but the agent can also recommend a different module, or branch into an ad-hoc conversation about a live situation, based on what it's learned about the user. Users' three likely modes of use on any given visit:

1. Continue working through the modules in order.
2. Explore a current life situation/problem through the lens of work already done (e.g. "I'm stuck on a decision — what do my core values say?").
3. Chat ad-hoc about something on their mind.

**On login, the agent recaps.** Like a coach opening a session, it should surface what changed since last time and ask what's shifted — not re-ask what it already knows.

**The agent has (at least) two registers:**
- **Guiding mode** — gentle, empathetic, holding space.
- **Teaching mode** — more direct, challenging, probing; not just validating. The values module content itself already models this — reflections repeatedly push past the comfortable answer ("Do these values restrict you?", "Would I still choose this if nobody rewarded me for it?").

**A profile builds up over time** from onboarding answers, module work, and ad-hoc chat, so conversations get more targeted the longer someone uses the app. The Values module is the clearest existing example: every reflection answer feeds an evolving "values profile" the app can later reference ("last time you said security mattered more than wealth — is that still true?").

**A knowledge base grounds the agent in Lelañea's actual voice and material** — articles, podcast transcripts, definitions, and (critically) the 265-value library with deep-dive explorations for each, so the agent doesn't improvise philosophy it hasn't been given.

---

## 3. What's actually in the six content files

| File | Contains | Completeness |
|---|---|---|
| `lelanea_foundational_documents.json` | 7 documents: welcome/initiation, heart-behind-Lelañea (philosophy), mission, about-the-creator, lineage, disclaimer, terms of use. Each is tagged with a `surface` (e.g. `first_run_welcome`, `about_philosophy`, `about_mission`, `legal_disclaimer`) — i.e. **already mapped to where in the app it belongs.** | Content complete; several legal placeholders unresolved (see §6). |
| `lelanea_module_structure.json` | The full 17-module journey: module 00 (onboarding) + modules 01–16 across 5 tiers (Onboarding, Foundations, Inner Authority, Embodied Relationship, Integration & Expansion). | **Only module 01 (Values) is built out** into phase-tiers and phases. Modules 02–16 are stubs — id, title, tier, nothing else. This is deliberate: v1 ships a skeleton, with Values as the one fully-realized module. |
| `onboarding_discovery_questions.json` | 30 long-form self-examination questions (ego/Higher Self, individuality, purpose, conditioning, memory, love, prayer, transcendence). Explicitly meant to be sat with, not rushed — resumable, produces a `discovery_baseline` artifact. | Content complete. Author's own review notes flag it as possibly too heavy as a single sitting — worth a product decision (core set + optional deeper set, or spread over time). |
| `values_module.json` | The full Values module: value-state color coding (green/confirmed, yellow/wavering, red/let-go, purple/future-self), the 265-value library, and 10 ordered steps (4 lessons across psychological/spiritual/energetic lenses → value-selection exercise → yellow/red/purple reflections → top-10/top-5 core-values distillation → closing gratitude meditation). Produces a `values_profile` artifact. | Content complete and fully authored — this is the flagship module. |
| `values_reference_framework.json` | The 22-point editorial framework the deep value write-ups are authored against (etymology, psychology, spirituality, metaphysics, embodiment, shadow expression, discernment questions, alignment test, polarity/transcendence material). Not user-facing — this is the brief that keeps every value exploration consistent. | Reference/editorial document, not content itself. |
| `value_explorations.json` | Long-form deep-dives for individual values, each following the 22-point schema above (etymology, psychological meaning, shadow expression, alignment test, etc.). | **16 of the 265-value library are done.** The rest is future content. |

**Important editorial notes carried in the JSON itself** (worth respecting, not re-deriving):
- Body text is transcribed verbatim from Lelañea's source documents — corrected for typos/punctuation only, never reworded or reordered. Treat this as authored copy, not a draft to improve.
- Coach-facilitation guidance is deliberately separated into `facilitationNote` fields so the app can show, adapt, or hide it — these are strong hints for how an agent should behave at that point in the flow (e.g. "this exercise is best done with a coach who can mirror back what's hidden from the self").
- Several phases in the Values module map to a single authored screen split two ways (e.g. phases 05/06 are one exercise with two passes; phases 09/10 split one question set) — these are presentation decisions, not content gaps.

---

## 4. How this maps onto Daybreak/Sunrise — don't reinvent these

This is the important part. Daybreak's framework layer (`lib/framework/`) was **built with a transcendental-coaching use case as its named baseline reference case** — `.context/framework/planning/framework-architecture.md` literally names "Transcendental coaching (Lelañea)" as reference case #1: *"Single-user, open-ended, qualitative; rich inference-heavy slot capture; gentle non-linear journeys."* Lelañea isn't being fitted awkwardly onto a generic framework — the framework was designed with her in mind. All of the primitives below are **already shipped** in Daybreak (as of `daybreak-v0.1.0`).

| Lelañea concept | Daybreak/Sunrise primitive | What it gives you |
|---|---|---|
| A module (e.g. "Values") | A **`ModuleDefinition`**, registered via `registerModule()` | Bounded unit: declares its own config schema, capabilities, data-slots, events, agent roles. Admin gets a generically-rendered config form for free. |
| The 17-module journey, sequencing, "explore a related situation" | A **facilitation graph** (`FacilitationGraph`) of nodes (modules/stages/milestones) and typed edges — `prerequisite`, `unlocks`, `tangent`, `related_to` — walked by a deterministic **engine**, ranked by an advisory **guidance** layer, bounded by **governance policy** | `prerequisite`/`unlocks` edges give you the mostly-sequential module order. `tangent` edges are always-open — this is literally "explore a life situation ad-hoc." `related_to` edges plus a similarity overlay give "recommend a module based on the user's situation." |
| The evolving user profile (values profile, discovery baseline, anything learned in chat) | **Data-slots** — `SlotDefinition` + `SlotValue` | This *is* what the user meant by "Daybreak's data slots." Slots are scoped (`global`, `module:<slug>`, `facilitation`), versioned and insert-only (nothing is silently overwritten), and carry a confidence score + provenance + reasoning note — so the agent's inferences about the user are auditable, not black-box. `mode: open` lets an agent mint a new slot on the fly for qualitative material that doesn't fit a fixed schema — a good fit for open-ended coaching answers. |
| The login recap ("what's changed since last time?") | A named **facilitation agent role: `synopsis`** | This role already exists as a first-class concept, bound via `FacilitationAgentBinding`, reached through a dedicated facilitation surface rather than being module-scoped. There's also `onFirstArrival` on map nodes for one-time welcome moments — the second onboarding trigger point. |
| The onboarding module itself | Facilitation agent role: **`onboarding`** (plus `orientation`, `state`, `path`/`progress`, and a distinct `facilitator` persona) | Onboarding is a named role in the same family as `synopsis` — not a bespoke thing to build from scratch. |
| Guiding mode vs. teaching mode | A per-module **`tone`** config parameter (the framework's own worked example uses `tone: 'gentle' | 'direct'`), refined by **`FacilitationPolicy`** (governance) for when to challenge vs. hold space | Not a dedicated "mode" primitive by name, but the seam already exists and was anticipated. This still needs a deliberate design decision when building Lelañea's agents — flagged as an open item, not a gap in the framework. |
| The knowledge base (articles, transcripts, definitions, the value library) | Sunrise's existing **Knowledge Base + Agents** platform domain, scoped via each module's `knowledgeAccessMode` and document/tag grants | Not new. "Definitions and terms selectively used by agents" is exactly what knowledge grants + document tagging are for — e.g. gate the 16 authored value-explorations so only the Values module's agent can pull them, tagged per value id so retrieval is precise. |
| Public marketing site + waitlist (the actual v1 scope) | **Plain Sunrise-tier work** — `(public)` route group pages + a waitlist form/API | No framework primitives apply here. Build with the `page-builder` and `form-builder` skills directly. Don't over-engineer this into the module/facilitation system — it's marketing pages, not app experience, yet. |

**Fork position:** Lelañea is the **second leaf fork of Daybreak** (after an existing first leaf, `reclaim-your-week`). That means: consume a tagged Daybreak release, build inside the reserved leaf scaffolds (`lib/app/*`) and your own `modules/<slug>/` directories, and **never touch `lib/framework/`**. If something genuinely doesn't have a seam yet (the guiding/teaching "mode" concept is the one candidate above), the answer is to flag it and use the closest existing seam (`tone` + `FacilitationPolicy`) rather than inventing new framework surface from a leaf app — that's Daybreak's CLAUDE.md golden rule, one level up.

---

## 5. V1 scope — what's actually being built first

Per the brief: **v1 is the shell, not the full experience.**

**In scope for v1:**
- Public marketing site: about Lelañea, her approach, the app's purpose — built straight from the `about_*`-surfaced foundational documents.
- Waitlist signup (app isn't open yet).
- Links out to her external presence — YouTube, Spotify, website.
- A skeleton of all 17 modules registered as `ModuleDefinition`s (so the structure exists and is navigable/visible), with **Values as the one fully wired, working module** — content, agent, slots, the whole loop.
- The onboarding module (module 00): welcome, the four about/philosophy reads, disclaimer + terms acknowledgement (both `requiresAcknowledgement: true` — must gate progress), then the 30 discovery questions.

**Not yet in scope:** the full authenticated chat-driven experience across all 16 numbered modules — that's future work, module by module, once the skeleton is live and Values proves the pattern out.

---

## 6. Open items to resolve before/while building

These come straight out of the content files' own review notes — worth deciding rather than silently working around:

- **Legal placeholders unresolved:** Terms of Use has an unfilled effective date and support email; it also references a Privacy Policy that doesn't exist yet and needs writing + linking; the governing jurisdiction clause names no jurisdiction.
- **Crisis-resource guidance is generic.** The disclaimer tells users in crisis to "contact local emergency services" but names no specific resource (e.g. 988 in the US) — worth deciding whether to localize this or add a named default.
- **Disclaimer duplicates "About the Creator."** The disclaimer has its own creator bio that differs from the standalone `about_the_creator` document — decide which is canonical or keep them explicitly in sync.
- **30 discovery questions may be too heavy pre-onboarding.** The content's own preamble asks users not to rush, which sits awkwardly against a mandatory 30-question gate before any module content. Consider a required core set + optional deeper set, or allowing it to be finished over multiple sessions (the artifact is already flagged `revisitable`).
- **The word "Integration" is overloaded** — used both as a Values-module phase-tier name and as an app-level tier name ("Integration & Expansion"). Cosmetic, but worth renaming one before it shows up in two navigation breadcrumbs at once.
- **Guiding vs. teaching mode needs an actual design decision** (see §4) — this is a genuine open design question, not just a content gap.
- **{{first_name}} merge field** in the welcome message needs a defined fallback for users with no name on file.
- **Module 01 module chart artwork** is out of sync with the JSON's authoritative sequence (rows 2 and 4 print old numerals) — a Lelañea-side asset fix, not an app concern, but worth flagging back to her.

None of these block starting the build — the skeleton, marketing site, and Values module don't depend on them — but they'll surface quickly once onboarding and legal-gating are implemented.

---

## 7. Prompt vocabulary — words to use when prompting the build

The point of this section: when writing the actual build prompt (or working session-by-session in Claude Code), use Daybreak's own names for these concepts. Naming them correctly steers Claude Code toward the existing seam instead of inventing a bespoke one.

| Say this... | ...to invoke this | Not this |
|---|---|---|
| "Register Values as a module" / "a `ModuleDefinition`" | Daybreak's module system, config schema, admin form | A bespoke page or feature flag |
| "Wire the module navigation through the facilitation map — prerequisite order between tiers, tangent edges for ad-hoc exploration, related-to edges for situational recommendations" | `FacilitationGraph`, the engine, the guidance layer | A custom router or hardcoded "next module" logic |
| "Capture this in a data slot" / "profile slot" | `SlotDefinition` + `SlotValue`, with scope (`global`, `module:values`, `facilitation`) and confidence/provenance | A bespoke `UserProfile` table or ad-hoc JSON blob on the user |
| "This is qualitative/open-ended — use an open-mode slot" | `mode: open` slot minting | Forcing every discovery-question answer into a fixed schema |
| "The login recap is the synopsis facilitation agent" | The named `synopsis` facilitation agent role | A custom "welcome back" feature |
| "Onboarding is the onboarding facilitation agent role, plus an `onFirstArrival` hook on the module-00 map node" | Existing facilitation-agent family + map-node lifecycle hook | A one-off onboarding wizard bolted on separately |
| "Ground this in the knowledge base, scoped/tagged per value" | Sunrise's Knowledge Base + agent knowledge grants, document tagging | Hardcoding Lelañea's philosophy into system prompts |
| "Set the module's tone" / "gate this with a facilitation policy" | Per-module `tone` config + `FacilitationPolicy` | A global "personality" switch |
| "This is public marketing — plain Sunrise pages" | `(public)` route group, `page-builder`, `form-builder` | Building it as a module or facilitation surface |
| "We're a leaf fork of Daybreak — this goes in `lib/app/*` or `modules/<slug>/`" | The leaf/framework boundary Daybreak's CLAUDE.md defines | Editing `lib/framework/`, even to move fast |
| "No existing seam for this — flag it, don't build framework from the leaf" | Daybreak's own claim-a-feature process on its `plan.md` board, upstream | Quietly patching `lib/framework/` from Lelañea's repo |

---

## Accompanying content files

This doc should travel with these six JSON files (source: `~/Documents/Lelanea V1/Dev/JSON Files.ai/`):

1. `lelanea_foundational_documents.json` — welcome, about, mission, lineage, disclaimer, terms
2. `lelanea_module_structure.json` — the 17-module journey structure
3. `onboarding_discovery_questions.json` — the 30 discovery questions
4. `values_module.json` — the full Values module (flagship, fully authored)
5. `values_reference_framework.json` — the editorial framework behind value explorations
6. `value_explorations.json` — 16 authored deep-dive value explorations (of 265)
