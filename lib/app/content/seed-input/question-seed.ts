/**
 * The discovery questions as seed material (f-content-seeds t-87).
 *
 * `content/onboarding_discovery_questions.json` is no longer read at request
 * time. `/api/v1/app/content/discovery-questions` reads `app_question_set` and
 * `app_discovery_question` through `@/lib/app/content/question-store`. This
 * module is where the file is still imported; its callers are the seed
 * (`prisma/seeds/app-lelanea/017-discovery-questions.ts`) and tests. Nothing a request
 * reaches may import it, or this folder at all (t-89).
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
import type { QuestionSeed } from '@/lib/app/content/question-view';
import { questionSeedFromFile } from '@/lib/app/content/content-files';

// Re-exported so the seed unit and its tests keep importing the shape from
// beside the builder; it is DECLARED in the view (t-89), because the store
// reads these rows back and no runtime module may import this folder.
export type { QuestionSeed };

/** The questions file, validated. Seeds and tests only. */
export function readDiscoveryQuestionsFile(): DiscoveryQuestionsFile {
  return discoveryQuestionsFileSchema.parse(rawDiscoveryQuestions);
}

/** The rows the seed writes, built from the file. See `questionSeedFromFile`. */
export function buildQuestionSeed(
  file: DiscoveryQuestionsFile = readDiscoveryQuestionsFile()
): QuestionSeed {
  return questionSeedFromFile(file);
}
