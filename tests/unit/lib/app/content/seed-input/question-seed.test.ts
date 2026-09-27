/**
 * The discovery questions as the seed builds them, and as they are served once
 * stored (f-content-seeds t-87).
 *
 * The projection cases the file loader had before t-87, applied to what
 * replaced it: the rows `buildQuestionSeed()` writes, read back through the real
 * `toQuestionSet()`. And the data migration embeds exactly what the builder
 * writes.
 *
 * @see lib/app/content/seed-input/question-seed.ts
 * @see lib/app/content/question-view.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildQuestionSeed,
  readDiscoveryQuestionsFile,
} from '@/lib/app/content/seed-input/question-seed';
import { toQuestionSet } from '@/lib/app/content/question-view';
import { seededQuestionRows } from '@/tests/helpers/app/content-stores';

function served() {
  const rows = seededQuestionRows();
  return toQuestionSet(rows.set, rows.questions);
}

const MIGRATION = path.join(
  process.cwd(),
  'prisma/migrations/20260928100100_app_journey_questions_resources_data/migration.sql'
);

describe('the discovery questions, as seeded and served', () => {
  it('numbers the questions from one, in order', () => {
    const { questions } = served();

    expect(questions).toHaveLength(30);
    expect(questions.map((question) => question.number)).toEqual(
      questions.map((_, index) => index + 1)
    );
  });

  it('keeps the preamble and the pacing guidance with the questions', () => {
    const { preamble, pacing } = served();

    expect(preamble.text).toBeTruthy();
    expect(pacing.rushDiscouraged).toBe(true);
  });

  it('withholds the editorial review notes and the source-file provenance', () => {
    const set = served();

    expect(set).not.toHaveProperty('reviewNotes');
    expect(set.collection).not.toHaveProperty('sourceFile');
    expect(set.collection).not.toHaveProperty('notes');
  });

  it('projects each question, so a future authored annotation is withheld', () => {
    const allowed = [
      'id',
      'number',
      'text',
      'inputType',
      'hint',
      'conditionalFollowUp',
      'weight',
      'revision',
    ];

    for (const question of served().questions) {
      expect(Object.keys(question).every((key) => allowed.includes(key))).toBe(true);
    }
  });

  it('omits hint and follow-up where there is none, as the file-backed shape did', () => {
    const questions = served().questions;

    expect(questions.filter((q) => 'hint' in q).length).toBeGreaterThan(0);
    expect(questions.filter((q) => 'conditionalFollowUp' in q)).toHaveLength(2);
    expect(questions.find((q) => q.id === 'q01')).not.toHaveProperty('hint');
  });

  it('serves the words exactly as the file has them, each question fully weighted', () => {
    const file = readDiscoveryQuestionsFile();
    const questions = served().questions;

    for (const authored of file.questions) {
      const {
        revision: _revision,
        weight,
        ...question
      } = questions.find((q) => q.id === authored.id)!;
      expect(question).toEqual(authored);
      // Her file carries no weight, so every seeded question is in the Core Set
      // until an admin says otherwise (f-onboarding t-101).
      expect(authored).not.toHaveProperty('weight');
      expect(weight).toBe(100);
    }
  });

  it('throws on a gap in the numbering, which would read as a missing question', () => {
    const rows = seededQuestionRows();

    expect(() =>
      toQuestionSet(
        rows.set,
        rows.questions.filter((question) => question.number !== 12)
      )
    ).toThrow(/numbered 13 but sits at position 12/);
  });

  it('throws on a stored follow-up that is not a yes and a no', () => {
    const rows = seededQuestionRows();
    const broken = rows.questions.map((question) =>
      question.id === 'q01' ? { ...question, conditionalFollowUp: { ifYes: 'only one' } } : question
    );

    expect(() => toQuestionSet(rows.set, broken)).toThrow(/"q01" failed validation/);
  });
});

/**
 * Columns added after that migration was applied, by
 * `20261002100000_app_discovery_question_weight` (f-onboarding t-101), with
 * the database default each was given.
 *
 * The t-87 migration cannot be edited: it has run on every database. It still
 * writes what the seed writes, because each column added since has a default
 * equal to the value the seed puts there. The first case below proves that, so
 * a later column whose seed value differs from its default fails here rather
 * than leaving migrated and seeded databases quietly different.
 */
const ADDED_SINCE = {
  question: { weight: 100 },
} as const;

describe('the data migration', () => {
  it('writes exactly what the seed builds today, less the columns added since at their defaults', () => {
    const match = /\$t87questions\$([\s\S]*?)\$t87questions\$/.exec(
      readFileSync(MIGRATION, 'utf8')
    );
    const seed = buildQuestionSeed();

    // The seed writes each later column at its database default...
    for (const question of seed.questions) expect(question).toMatchObject(ADDED_SINCE.question);

    // ...so the migration, which leaves them to that default, writes the same rows.
    const set = seed.set;
    const questions = seed.questions.map(({ weight: _weight, ...question }) => question);
    expect(match, 'the migration no longer embeds the questions seed JSON').not.toBeNull();
    expect(JSON.parse(match![1])).toEqual({ set, questions });
  });

  it('records the changed fields the service recorded when it ran', async () => {
    const { QUESTION_SET_SNAPSHOT_FIELDS, QUESTION_SNAPSHOT_FIELDS } =
      await import('@/lib/app/content/question-store');
    const sql = readFileSync(MIGRATION, 'utf8');
    const since: readonly string[] = Object.keys(ADDED_SINCE.question);

    // The set has gained no column since; the question has gained its weight.
    expect(sql).toContain(`ARRAY[${QUESTION_SET_SNAPSHOT_FIELDS.map((f) => `'${f}'`).join(', ')}]`);
    const then = QUESTION_SNAPSHOT_FIELDS.filter((field) => !since.includes(field));
    expect(then.length).toBeLessThan(QUESTION_SNAPSHOT_FIELDS.length);
    expect(sql).toContain(`ARRAY[${then.map((f) => `'${f}'`).join(', ')}]`);
  });
});
