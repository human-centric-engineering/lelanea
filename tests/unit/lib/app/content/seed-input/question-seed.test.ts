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

  it('serves the words exactly as the file has them', () => {
    const file = readDiscoveryQuestionsFile();
    const questions = served().questions;

    for (const authored of file.questions) {
      const { revision: _revision, ...question } = questions.find((q) => q.id === authored.id)!;
      expect(question).toEqual(authored);
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

describe('the data migration', () => {
  it('writes exactly what the seed builds today', () => {
    const match = /\$t87questions\$([\s\S]*?)\$t87questions\$/.exec(
      readFileSync(MIGRATION, 'utf8')
    );

    expect(match, 'the migration no longer embeds the questions seed JSON').not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(buildQuestionSeed());
  });

  it('records the same changed fields the service records', async () => {
    const { QUESTION_SET_SNAPSHOT_FIELDS, QUESTION_SNAPSHOT_FIELDS } =
      await import('@/lib/app/content/question-store');
    const sql = readFileSync(MIGRATION, 'utf8');

    for (const fields of [QUESTION_SET_SNAPSHOT_FIELDS, QUESTION_SNAPSHOT_FIELDS]) {
      expect(sql).toContain(`ARRAY[${fields.map((f) => `'${f}'`).join(', ')}]`);
    }
  });
});
