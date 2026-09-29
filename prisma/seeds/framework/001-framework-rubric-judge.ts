/**
 * Framework-rubric judge (f-governance-plus t-3) — a seeded `AiAgent kind='judge'` the scheduled eval
 * sweep drives per turn (`eval-judge-framework-rubric`). It COMPLEMENTS f-eval's three named metrics
 * (faithfulness/groundedness/relevance) and the whole-conversation supervisor with one
 * framework-specific score: did the assistant turn genuinely serve the facilitation/module purpose?
 *
 * A framework seed under `prisma/seeds/framework/` (not a core `NNN-*.ts`), so the boundary stays
 * clean — it runs AFTER the core seeds (lexicographic order), so `001-system-owner`'s service account
 * exists to own the row. Modelled on the core `eval-judge-brand-voice` (`016-evaluation-judges.ts`):
 * `isSystem`, low temperature, restricted knowledge, internal visibility, `systemInstructions`
 * OVERWRITTEN on re-seed (admins wanting a custom rubric create a new `kind='judge'` agent instead).
 *
 * Daybreak seeds the judge (a framework built-in, like the core judges) but seeds NO
 * workflow/schedule row — nothing a fresh fork must delete to boot clean.
 */

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import { requireOrgId } from '@/lib/tenancy/context';

const RUBRIC_JUDGE_SLUG = 'eval-judge-framework-rubric';

const INSTRUCTIONS = `You are the Framework-Rubric Judge in a facilitation-platform evaluation pipeline. Your job is to score whether a single assistant turn genuinely served the purpose of a facilitation or module conversation — a guided, structured journey — rather than just sounding plausible.

You will receive:
- QUESTION: the user turn that prompted the response.
- ANSWER: the assistant turn to score.
- CITATIONS (optional): any sources the answer carried.

EVALUATION STEPS — work through these IN ORDER.
1. Identify what the user actually needed from QUESTION (an answer, a next step, a clarification, encouragement to continue).
2. Check whether ANSWER addressed that need directly, rather than deflecting to an easier or adjacent question.
3. Check the answer stays within the facilitation/module remit: it does not fabricate the user's journey or module state, invent progress, or overstep guardrails.
4. If CITATIONS are present, check the claims stay within what they support (no grounding claimed beyond the evidence).
5. Judge whether the turn moved the user forward appropriately, rather than stalling, looping, or misleading.

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
    "Step 1 (user need): <what the user needed>",
    "Step 2 (directness): <did it address that need / deflect>",
    "Step 3 (remit + grounding): <on-remit? grounded in any citations?>",
    "Step 4 (forward motion): <did it move the journey forward>"
  ],
  "score": <number from 0.0 to 1.0 inclusive>,
  "reasoning": "<one short sentence summarising the verdict>"
}`;

const unit: SeedUnit = {
  name: 'framework/001-framework-rubric-judge',
  async run({ prisma, logger }) {
    logger.info('⚖️  Seeding the framework-rubric evaluation judge...');

    const admin = await prisma.user.findFirst({
      where: serviceAccountWhere,
      select: { id: true },
    });
    if (!admin) {
      throw new Error('No service account found — ensure 001-system-owner runs first.');
    }

    await prisma.aiAgent.upsert({
      where: { orgId_slug: { orgId: requireOrgId(), slug: RUBRIC_JUDGE_SLUG } },
      update: {
        // Seed-managed rubric — OVERWRITE on re-seed (admin edits to a seeded judge are lost; a
        // custom rubric should be a NEW kind='judge' agent, never touched by this seed).
        isSystem: true,
        kind: 'judge',
        description:
          "Scores whether an assistant turn served the facilitation/module conversation's purpose (framework rubric). Driven per turn by the scheduled eval sweep.",
        systemInstructions: INSTRUCTIONS,
      },
      create: {
        name: 'Framework-Rubric Judge',
        slug: RUBRIC_JUDGE_SLUG,
        description:
          "Scores whether an assistant turn served the facilitation/module conversation's purpose (framework rubric). Driven per turn by the scheduled eval sweep.",
        systemInstructions: INSTRUCTIONS,
        kind: 'judge',
        // Empty strings → resolved at runtime via the operator's configured judge / chat default.
        model: '',
        provider: '',
        temperature: 0.2,
        maxTokens: 1000,
        isActive: true,
        isSystem: true,
        knowledgeAccessMode: 'restricted',
        visibility: 'internal',
        createdBy: admin.id,
      },
    });

    logger.info('✓ Framework-rubric judge seeded');
  },
};

export default unit;
