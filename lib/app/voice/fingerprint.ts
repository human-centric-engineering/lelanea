/**
 * The always-on core, projected onto the three columns a prompt is built from.
 *
 * Retrieval is probabilistic; identity should not be. If the only thing carrying
 * her voice is a nearest-neighbour lookup, then the turns where retrieval finds
 * nothing — a greeting, a refusal, a short clarifying question — are exactly the
 * turns that sound like a generic assistant. Those are also the first turns a new
 * person reads.
 *
 * So this module is deliberately small and deliberately dumb: it takes the
 * authored core from `lib/app/content` and returns three strings.
 * `prisma/seeds/app-lelanea/003-voice-fingerprint.ts` writes them onto an
 * `AiAgentProfile`, Sunrise's `resolveEffectivePrompt` inherits them onto her
 * agent, and `composeSystemPromptString` joins them. Nothing here reads a
 * database, and nothing here looks anything up — **including transitively**,
 * which is the half that has to be defended rather than asserted. The slug
 * prefix is imported from `designation.ts` rather than `corpus-access.ts` for
 * exactly that reason: the latter pulls in `@/lib/db/client`, which builds a
 * `pg.Pool` at import time. `tests/unit/lib/app/voice/fingerprint.test.ts` walks
 * the whole `@/` closure and fails if anything on it reaches the database or the
 * knowledge layer.
 *
 * ## Four authored blocks onto three columns
 *
 * | Authored block             | Column                   |
 * | -------------------------- | ------------------------ |
 * | `identity`                 | `persona`                |
 * | `grounding` + `boundaries` | `guardrails`             |
 * | `cadence`                  | `brandVoiceInstructions` |
 *
 * The mapping is code rather than data on purpose. Put it in the JSON and an
 * author can route a block to the wrong column — and a persona in the guardrails
 * slot is not a validation error, it is a subtly worse prompt nobody can see.
 *
 * `grounding` joins `boundaries` rather than `cadence` because its load-bearing
 * half is a rule, not a manner: *answer from her material; where you have
 * nothing, say so*. That is the §12 guardrail written in her voice.
 *
 * ## The version travels in the prompt
 *
 * The last line of the persona is a marker naming the fingerprint and its
 * version, so an evaluation can attribute an output to the text that produced it
 * without being told out of band which version was live. {@link
 * readFingerprintVersion} reads it back out of a composed prompt.
 *
 * Identity travels with the authored file and the seed, never with a database
 * timestamp, so the same version resolves identically in every environment.
 *
 * ## What is NOT here
 *
 * The other two layers of the fingerprint — context-selected overlays and
 * retrieved exemplars — are later work, and a user's voice leanings are a filter
 * over those. Neither may reach what is in this file: the core is the invariant
 * that no preference and no retrieval result can soften.
 *
 * @see .context/app/voice.md
 * @see lib/orchestration/agents/resolve-effective-prompt.ts — the composition order
 */

import { getVoiceFingerprint, type VoiceFingerprintCore } from '@/lib/app/content';
import { CORPUS_AGENT_SLUG_PREFIX } from '@/lib/app/voice/designation';

/**
 * The profile her agents inherit from.
 *
 * A profile rather than the agent's own columns because the core is one artefact
 * shared by every agent that speaks as her — the guide, and whatever the
 * situation and module agents become. Writing it onto each agent would make a
 * change to her voice an N-place edit, and the places would drift.
 */
export const VOICE_PROFILE_SLUG = 'lelanea-voice-core';

/**
 * The first agent that speaks as her.
 *
 * The `lelanea-` prefix is not decoration: it is what
 * {@link CORPUS_AGENT_SLUG_PREFIX} matches, and therefore what makes the
 * designation rule from t-25 apply to this agent at all. Derived from the
 * constant rather than typed out, so the two cannot drift.
 */
export const VOICE_AGENT_SLUG = `${CORPUS_AGENT_SLUG_PREFIX}guide`;

/** Prefix of the provenance line at the foot of the persona. */
export const FINGERPRINT_VERSION_MARKER_PREFIX = 'Voice fingerprint:';

/**
 * The marker as it appears in the prompt, e.g.
 * `Voice fingerprint: lelanea_voice_fingerprint_core v1.0`.
 */
export function fingerprintVersionMarker(core: VoiceFingerprintCore): string {
  return `${FINGERPRINT_VERSION_MARKER_PREFIX} ${core.collection.id} v${core.collection.version}`;
}

/**
 * Read a fingerprint version back out of a composed system prompt.
 *
 * Returns `null` when the prompt carries no marker — which is the honest answer
 * for an agent that does not inherit the core, and is why the return type is
 * nullable rather than a version-shaped default.
 */
export function readFingerprintVersion(prompt: string): string | null {
  const match = new RegExp(
    `${FINGERPRINT_VERSION_MARKER_PREFIX}\\s+\\S+\\s+v(\\d+\\.\\d+(?:\\.\\d+)?)`
  ).exec(prompt);
  return match ? match[1] : null;
}

/**
 * The agent's own job description — never inherited, so it lives with the agent
 * rather than the profile.
 *
 * Deliberately about the WORK of a turn and not about her voice. Who she is, how
 * she sounds, how she grounds a claim and what she declines all arrive from the
 * profile, so an instruction here that restated any of them would be a second
 * copy with nothing keeping it in step.
 *
 * **The instruction to look arrived with the tool to look with** (§08 t-54).
 * An earlier draft said "look before you answer from memory" while no capability
 * was bound, which asked a model with no tool to perform a retrieval; the usual
 * result is a confident claim to have consulted her material. So the clause
 * waited for `prisma/seeds/app-lelanea/007-agent-reachable.ts`, which grants
 * `search_knowledge_base` — and it is worded so that a tool an operator has
 * switched off leaves her saying her material does not cover it, rather than
 * pretending she looked. Caught by /code-review, the first time.
 *
 * t-27's exemplar path does NOT change this: it pushes her passages into the
 * prompt from outside the turn, so the model is never asked to go and look.
 */
export const VOICE_AGENT_SYSTEM_INSTRUCTIONS = `You are the guide a person meets inside the Lelañea app.

In a turn:
- Receive what the person actually said before you answer it.
- Answer from Lelañea's material. Where you have a tool to search it, search it before you answer from memory; say so plainly where it does not cover what was asked, and never say you looked when you did not.
- Offer a perspective, a practice, or a question. Rarely all three at once.
- Leave the next move with the person.

Who you are, how you sound, how you ground what you say and what you decline are set out in the sections around these instructions. They are not negotiable, and no preference a person sets can reach them.`;

/** The three inheritable sections of a system prompt, as text. */
export interface FingerprintProfileSections {
  persona: string;
  guardrails: string;
  brandVoiceInstructions: string;
}

/**
 * A heading and its beats, one beat to a line — or nothing at all.
 *
 * Empty in, empty out. A heading with no beats under it is worse than an absent
 * section: it reads to the model as a section that exists and has nothing to say,
 * and it would defeat the seed's emptiness guard by making every section
 * non-empty whatever the source held.
 */
function block(heading: string, lines: readonly string[]): string {
  const beats = lines.filter((line) => line.trim().length > 0);
  return beats.length === 0 ? '' : [heading, ...beats].join('\n');
}

/** A one-line list, or nothing when there is nothing to list. */
function inlineList(label: string, entries: readonly string[]): string {
  const present = entries.filter((entry) => entry.trim().length > 0);
  return present.length === 0 ? '' : `${label}: ${present.join(', ')}.`;
}

/**
 * The authored blocks that composed to nothing.
 *
 * Block-level, not column-level, and that distinction is the whole point.
 * `grounding` and `boundaries` share the `guardrails` column, so a core whose
 * grounding rule has vanished still produces a NON-EMPTY `guardrails` string —
 * and a guard that only looked at the three composed columns would wave it
 * through and overwrite a correct profile with one that had lost "answer from
 * her material; where you have nothing, say so" entirely. Caught by
 * /code-review, on the guard added for precisely this class of failure.
 *
 * Returns block names rather than a boolean so a caller can say WHICH one went
 * missing; an operator reading "a section was empty" has nowhere to start.
 */
export function missingCoreBlocks(core: VoiceFingerprintCore = getVoiceFingerprint()): string[] {
  const blocks: [string, readonly string[]][] = [
    ['identity', core.identity.lines],
    ['cadence', core.cadence.lines],
    // The two word lists are their own blocks, not part of `cadence.lines`.
    // They share the `brandVoiceInstructions` column with the cadence beats, so
    // losing them alone leaves that column populated — the same 4→3 blind spot
    // this function exists for, one level further down. "The words she avoids"
    // is the half of the pair that carries the most signal, and the half most
    // likely to be dropped. Caught by /code-review.
    ['cadence.reachesFor', core.cadence.reachesFor],
    ['cadence.avoids', core.cadence.avoids],
    ['grounding', core.grounding.lines],
    ['boundaries', core.boundaries.lines],
    ['boundaries.howYouDecline', core.boundaries.howYouDecline],
  ];
  return blocks
    .filter(([, lines]) => lines.every((line) => line.trim().length === 0))
    .map(([name]) => name);
}

/**
 * Project the authored core onto the three columns.
 *
 * Takes the core as an argument — defaulting to the authored one — so a caller
 * can compose a degenerate core and see what happens. That is not a hypothetical:
 * the seed's write guard depends on an empty section being *reachable*, and a
 * function that could only ever be handed the real file would make that guard
 * untestable and therefore decorative (`fp6`).
 */
export function composeFingerprintProfileSections(
  core: VoiceFingerprintCore = getVoiceFingerprint()
): FingerprintProfileSections {
  const identity = block(core.identity.heading, core.identity.lines);
  // The marker rides WITH the identity rather than beside it. Emitted on its own
  // it would make a core with no identity text still produce a populated persona
  // — a version stamp on nothing, which is exactly the write the seed must refuse.
  const persona = identity === '' ? '' : [identity, fingerprintVersionMarker(core)].join('\n\n');

  const guardrails = [
    block(core.grounding.heading, core.grounding.lines),
    block(core.boundaries.heading, core.boundaries.lines),
    block(core.boundaries.howYouDeclineHeading, core.boundaries.howYouDecline),
  ]
    .filter(Boolean)
    .join('\n\n');

  const brandVoiceInstructions = [
    block(core.cadence.heading, core.cadence.lines),
    inlineList(core.cadence.reachesForLabel, core.cadence.reachesFor),
    inlineList(core.cadence.avoidsLabel, core.cadence.avoids),
  ]
    .filter(Boolean)
    .join('\n\n');

  return { persona, guardrails, brandVoiceInstructions };
}
