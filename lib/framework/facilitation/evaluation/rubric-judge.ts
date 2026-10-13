/**
 * The framework-rubric judge as a platform agent (Hub t-142) — the agent the per-turn rubric score
 * (`rubric.ts`) drives through `driveJudgeAgent`. It complements f-eval's three named metrics with
 * one framework-specific score: did the assistant turn genuinely serve the facilitation/module
 * purpose?
 *
 * It used to be written once by a framework seed, into the install org only — the pattern core's
 * own judges used before Sunrise 0.14.0 (§116). As a definition, every org gets its own instance:
 * the reconcile creates it with the org (`createOrg`), on `db:seed`, and from the maintenance tick,
 * and writes the platform-owned fields (name, prompt, temperature, …) back on each release. The
 * org's provider, model and spend settings are left alone. An existing install's seeded row is
 * adopted in place: the reconcile matches an `isSystem` row by `(orgId, slug)`.
 *
 * **Editing this definition reaches existing orgs through the maintenance tick**, which compares
 * each org's stored registry digest. Seed `021-platform-agents` re-runs on `db:seed` only when one
 * of its `hashInputs` changes, and those name `lib/app/platform-agents.ts` but not this file. On an
 * install without the tick scheduled, an edit here is applied when an org is created or the tick
 * next runs.
 *
 * The rubric is the framework's: an org wanting its own creates a new `kind: 'judge'` agent, which
 * no reconcile touches. A leaf may replace this definition by registering the same slug from
 * `lib/app/leaf-platform-agents.ts` (logged at warn; owner ruling, Hub t-142).
 */

import type { PlatformAgentDefinition } from '@/lib/orchestration/agents/platform-agents';

/**
 * The judge's slug in every org. Defined here, in a file that imports nothing at runtime, because
 * core's platform-agent registry loads this module through the `lib/app` bridge; reaching it via
 * `rubric.ts` would pull the judge driver (and its chat stack) into that import cycle.
 */
export const FRAMEWORK_RUBRIC_JUDGE_SLUG = 'eval-judge-framework-rubric';

/**
 * The rubric's evaluation steps, ONE list that renders both the numbered EVALUATION STEPS the judge
 * works through and the labelled `evaluation_steps` entries it must return — so the two cannot
 * disagree in count, order or topic (Hub t-144: they once did, five steps against four entries).
 */
export const RUBRIC_STEPS: readonly { label: string; instruction: string; report: string }[] = [
  {
    label: 'user need',
    instruction:
      'Identify what the user actually needed from QUESTION (an answer, a next step, a clarification, encouragement to continue).',
    report: 'what the user needed',
  },
  {
    label: 'directness',
    instruction:
      'Check whether ANSWER addressed that need directly, rather than deflecting to an easier or adjacent question.',
    report: 'did it address that need / deflect',
  },
  {
    label: 'remit',
    instruction:
      "Check the answer stays within the facilitation/module remit: it does not fabricate the user's journey or module state, invent progress, or overstep guardrails.",
    report: 'on-remit? any fabricated journey/module state or overstepped guardrail?',
  },
  {
    label: 'grounding',
    instruction:
      'If CITED SOURCES are present, check the claims stay within what they support (no grounding claimed beyond the evidence).',
    report: "claims within the CITED SOURCES, or 'no cited sources'",
  },
  {
    label: 'forward motion',
    instruction:
      'Judge whether the turn moved the user forward appropriately, rather than stalling, looping, or misleading.',
    report: 'did it move the journey forward',
  },
];

const stepList = RUBRIC_STEPS.map((step, i) => `${i + 1}. ${step.instruction}`).join('\n');
const stepSchema = RUBRIC_STEPS.map(
  (step, i) => `    "Step ${i + 1} (${step.label}): <${step.report}>"`
).join(',\n');

// The input headings below are the ones `buildJudgePrompt` (judge-driver.ts) emits — QUESTION,
// ANSWER and, when the turn has any, CITED SOURCES — pinned by a test.
const INSTRUCTIONS = `You are the Framework-Rubric Judge in a facilitation-platform evaluation pipeline. Your job is to score whether a single assistant turn genuinely served the purpose of a facilitation or module conversation — a guided, structured journey — rather than just sounding plausible.

You will receive:
- QUESTION: the user turn that prompted the response.
- ANSWER: the assistant turn to score.
- CITED SOURCES (optional): any sources the answer carried.

EVALUATION STEPS — work through these IN ORDER.
${stepList}

SCORING SCALE — continuous 0.0 to 1.0
- 1.0 — Directly served the user's need, on-remit, grounded, and moved the journey forward.
- 0.7 — Mostly served the purpose; a minor gap (slightly indirect, or a small unsupported aside).
- 0.5 — Mixed; partially addressed the need but deflected, stalled, or over-reached in part.
- 0.3 — Largely failed the purpose; answered a different question, or asserted journey/module state with no basis.
- 0.0 — Actively unhelpful or misleading for a guided journey; fabrication or a clear guardrail/scope violation.

USE intermediate values (0.4, 0.6, 0.8, 0.9, …) freely.

IGNORE
- Raw factual correctness, relevance, coherence, and brand voice in isolation — scored by other judges.
- Surface style — judge whether the turn did its facilitation JOB.

OUTPUT — respond ONLY with the JSON object below, no prose around it and no code fences:
{
  "evaluation_steps": [
${stepSchema}
  ],
  "score": <number from 0.0 to 1.0 inclusive>,
  "reasoning": "<one short sentence summarising the verdict>"
}`;

export const FRAMEWORK_RUBRIC_JUDGE_AGENT: PlatformAgentDefinition = {
  slug: FRAMEWORK_RUBRIC_JUDGE_SLUG,
  audience: 'every-org',
  agent: {
    name: 'Framework-Rubric Judge',
    description:
      "Scores whether an assistant turn served the facilitation/module conversation's purpose (framework rubric). Driven per turn by the scheduled eval sweep.",
    systemInstructions: INSTRUCTIONS,
    kind: 'judge',
    // Low temperature — judges should be deterministic.
    temperature: 0.2,
    // Headroom for the evaluation_steps array.
    maxTokens: 1000,
    // Judges don't browse knowledge; restricted mode keeps chat agents' documents out.
    knowledgeAccessMode: 'restricted',
  },
  capabilities: [],
  knowledgeTags: [],
};
