/**
 * The discovery questions as seed material (f-content-seeds t-87).
 *
 * `content/onboarding_discovery_questions.json` is no longer read at request
 * time. `/api/v1/app/content/discovery-questions` reads `app_question_set` and
 * `app_discovery_question` through `@/lib/app/content/question-store`. This
 * module is where the file is still imported; its callers are the seed
 * (`prisma/seeds/app-lelanea/017-discovery-questions.ts`) and tests.
 *
 * What is seeded is what was served: the file's `notes`, `sourceFile`,
 * `textFormat` and `reviewNotes` are working notes about the words and are not
 * written to a row.
 */

import rawDiscoveryQuestions from '@/content/onboarding_discovery_questions.json';
import {
  discoveryQuestionsFileSchema,
  type DiscoveryQuestionsFile,
} from '@/lib/app/content/schemas';
import type { DiscoveryQuestionRow, QuestionSetRow } from '@/lib/app/content/question-view';

/** What the seed writes: the set and its questions, at revision 1. */
export interface QuestionSeed {
  set: Omit<QuestionSetRow, 'revision'>;
  questions: Omit<DiscoveryQuestionRow, 'revision'>[];
}

/** The questions file, validated. Seeds and tests only. */
export function readDiscoveryQuestionsFile(): DiscoveryQuestionsFile {
  return discoveryQuestionsFileSchema.parse(rawDiscoveryQuestions);
}

/** The rows the seed writes, built from the file. */
export function buildQuestionSeed(
  file: DiscoveryQuestionsFile = readDiscoveryQuestionsFile()
): QuestionSeed {
  return {
    set: {
      id: file.content.id,
      title: file.content.title,
      chartTitle: file.content.chartTitle,
      moduleId: file.content.module,
      phase: file.content.phase,
      preamble: { style: file.preamble.style, text: file.preamble.text },
      pacing: {
        rushDiscouraged: file.pacing.rushDiscouraged,
        allowPartialCompletion: file.pacing.allowPartialCompletion,
        note: file.pacing.note,
      },
      version: file.content.version,
      locale: file.content.locale,
    },
    questions: file.questions.map((question) => ({
      id: question.id,
      number: question.number,
      text: question.text,
      inputType: question.inputType,
      hint: question.hint ?? null,
      conditionalFollowUp: question.conditionalFollowUp
        ? { ifYes: question.conditionalFollowUp.ifYes, ifNo: question.conditionalFollowUp.ifNo }
        : null,
    })),
  };
}
