/**
 * The discovery questions, read from and written to the database
 * (f-content-seeds t-87).
 *
 * **The one service for `app_question_set` and `app_discovery_question`.** The
 * seed writes through it now, and the admin editor will in t-91.
 * `/api/v1/app/content/discovery-questions` is its only reader today; no page
 * renders the questions yet, so the API is the whole surface.
 *
 * Read per request, no cache, and an unseeded database throws
 * {@link ContentNotSeededError}, both for the reasons `document-store.ts` gives.
 *
 * @see lib/app/content/question-view.ts — the projection
 * @see lib/app/content/seed-input/question-seed.ts — what the seed writes
 */

import type { TenancyClient } from '@/lib/db/tenancy-extension';
import { prisma as defaultClient } from '@/lib/db/client';
import { ContentNotSeededError } from '@/lib/app/content/document-view';
import {
  storedFollowUpSchema,
  storedPacingSchema,
  storedPreambleSchema,
  toQuestionSet,
  type DiscoveryQuestionSet,
} from '@/lib/app/content/question-view';
import type { QuestionSeed } from '@/lib/app/content/question-view';
import { idsBySlug } from '@/lib/app/content/row-ids';

/** The one set there is: the onboarding module's discovery questions. */
export const DISCOVERY_QUESTION_SET_ID = 'onboarding_discovery_questions';

// ============================================================================
// Reads
// ============================================================================

/**
 * The discovery questions, with the preamble and pacing that frame them.
 *
 * @throws ContentNotSeededError when the seed has not run.
 */
export async function getDiscoveryQuestions(): Promise<DiscoveryQuestionSet> {
  const set = await defaultClient.appQuestionSet.findFirst({
    where: { slug: DISCOVERY_QUESTION_SET_ID },
    include: { questions: { orderBy: { number: 'asc' } } },
  });
  if (!set) {
    throw new ContentNotSeededError(
      'No discovery questions in the database',
      '017-discovery-questions.ts'
    );
  }
  return toQuestionSet(set, set.questions);
}

// ============================================================================
// Writes
// ============================================================================

/** The fields a set revision snapshots. At revision 1 every one is "changed". */
export const QUESTION_SET_SNAPSHOT_FIELDS = [
  'title',
  'chartTitle',
  'phase',
  'preamble',
  'pacing',
  'version',
  'locale',
] as const;

/** The fields a question revision snapshots. */
export const QUESTION_SNAPSHOT_FIELDS = [
  'number',
  'text',
  'inputType',
  'hint',
  'conditionalFollowUp',
  'weight',
] as const;

export type SeedQuestionsResult =
  | { status: 'seeded'; questions: number }
  /** The set already exists. Nothing was written. */
  | { status: 'skipped'; questions: number };

/**
 * Write the set, its questions and each one's first revision, once.
 *
 * **Write-once (`fp4`)**, marked by the set row, which is written in the same
 * transaction as everything else. **Safe on empty**: no removal pass.
 */
export async function seedDiscoveryQuestions(
  seed: QuestionSeed,
  client: TenancyClient = defaultClient
): Promise<SeedQuestionsResult> {
  const existing = await client.appQuestionSet.findFirst({
    where: { slug: seed.set.slug },
    select: { slug: true },
  });
  if (existing) {
    return {
      status: 'skipped',
      questions: await client.appDiscoveryQuestion.count({ where: { setSlug: seed.set.slug } }),
    };
  }

  const now = new Date();
  const { slug: setSlug, moduleSlug, ...setText } = seed.set;
  // Validated again at the write, not just when the seed was built.
  const framing = {
    ...setText,
    preamble: storedPreambleSchema.parse(setText.preamble),
    pacing: storedPacingSchema.parse(setText.pacing),
  };
  const questions = seed.questions.map((question) => ({
    ...question,
    conditionalFollowUp: storedFollowUpSchema.parse(question.conditionalFollowUp) ?? undefined,
  }));
  const provenance = { origin: 'seed' as const, editorId: null, changedAt: now };

  await client.$transaction(async (tx) => {
    // The set's module is seeded first (016). Refused here as the foreign key
    // refused it when the set named its module directly.
    const setModule = await tx.appJourneyModule.findFirst({
      where: { slug: moduleSlug },
      select: { id: true },
    });
    if (!setModule)
      throw new Error(`Question set "${setSlug}" names unknown module "${moduleSlug}"`);
    const set = await tx.appQuestionSet.create({
      data: {
        slug: setSlug,
        moduleSlug,
        moduleId: setModule.id,
        ...framing,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    const questionId = idsBySlug(
      await tx.appDiscoveryQuestion.createManyAndReturn({
        data: questions.map((question) => ({
          ...question,
          setSlug,
          setId: set.id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        })),
        select: { id: true, slug: true },
      }),
      'discovery question'
    );
    await tx.appQuestionSetRevision.create({
      data: {
        setSlug,
        setId: set.id,
        revision: 1,
        ...framing,
        changedFields: [...QUESTION_SET_SNAPSHOT_FIELDS],
        ...provenance,
      },
    });
    await tx.appDiscoveryQuestionRevision.createMany({
      data: questions.map(({ slug, ...text }) => ({
        questionSlug: slug,
        questionId: questionId(slug),
        revision: 1,
        ...text,
        changedFields: [...QUESTION_SNAPSHOT_FIELDS],
        ...provenance,
      })),
    });
  });

  return { status: 'seeded', questions: seed.questions.length };
}
