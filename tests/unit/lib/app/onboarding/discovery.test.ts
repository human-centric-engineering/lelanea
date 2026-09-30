/**
 * The discovery questions' pure rules (f-onboarding t-104): the request
 * schema, the ledger keys, the answer encoding, and where a person resumes.
 *
 * @see lib/app/onboarding/discovery.ts
 */

import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_STARTED_KEY,
  MAX_ANSWER_LENGTH,
  answerValue,
  discoveryActionSchema,
  discoveryLedgerFrom,
  discoveryPosition,
  readAnswer,
  skippedKeyFor,
} from '@/lib/app/onboarding/discovery';

const SET = [{ id: 'q01' }, { id: 'q02' }, { id: 'q03' }, { id: 'q04' }];

describe('discoveryPosition', () => {
  it('starts at the first question when nothing is answered or skipped', () => {
    expect(discoveryPosition(SET, new Set(), new Set())).toEqual({
      next: 'q01',
      skipped: [],
      finished: false,
    });
  });

  it('resumes at the first question neither answered nor skipped', () => {
    const position = discoveryPosition(SET, new Set(['q01', 'q03']), new Set(['q02']));
    expect(position.next).toBe('q04');
    expect(position.skipped).toEqual(['q02']);
  });

  it('keeps a skipped question waiting, and an answer takes it off the list', () => {
    expect(discoveryPosition(SET, new Set(['q02']), new Set(['q02'])).skipped).toEqual([]);
  });

  it('is finished only when every question is answered or skipped', () => {
    const done = discoveryPosition(SET, new Set(['q01', 'q02', 'q04']), new Set(['q03']));
    expect(done).toEqual({ next: null, skipped: ['q03'], finished: true });
  });

  it('ignores answers and skips outside the current set', () => {
    const coreOnly = [{ id: 'q02' }, { id: 'q04' }];
    const position = discoveryPosition(coreOnly, new Set(['q01']), new Set(['q03']));
    expect(position).toEqual({ next: 'q02', skipped: [], finished: false });
  });
});

describe('discoveryLedgerFrom', () => {
  it('reads its own keys beside the first run’s', () => {
    const ledger = discoveryLedgerFrom({
      initiation_shown_at: '2026-09-30T10:00:00.000Z',
      [DISCOVERY_STARTED_KEY]: '2026-09-30T10:05:00.000Z',
      [skippedKeyFor('q07')]: '2026-09-30T10:04:00.000Z',
      [skippedKeyFor('q09')]: null,
    });
    expect(ledger).toEqual({ started: true, skipped: ['q07'] });
  });

  it.each([null, undefined, 'x', [], 3])('reads nothing from %p', (progress) => {
    expect(discoveryLedgerFrom(progress)).toEqual({ started: false, skipped: [] });
  });
});

describe('answers', () => {
  it('writes a branch as the opening of the value, and reads it back', () => {
    const value = answerValue({ words: 'On long walks.', branch: 'yes' });
    expect(value).toBe('Yes. On long walks.');
    expect(readAnswer(value, true)).toEqual({ words: 'On long walks.', branch: 'yes' });
    expect(readAnswer(answerValue({ words: 'Calm.', branch: 'no' }), true)).toEqual({
      words: 'Calm.',
      branch: 'no',
    });
  });

  it('writes plain words on a question that does not branch, and reads them whole', () => {
    expect(answerValue({ words: 'Yes. All of it.' })).toBe('Yes. All of it.');
    expect(readAnswer('Yes. All of it.', false)).toEqual({ words: 'Yes. All of it.' });
  });

  it('reads a value with no branch opening as words alone, even where it branches', () => {
    expect(readAnswer('Sometimes.', true)).toEqual({ words: 'Sometimes.' });
  });
});

describe('discoveryActionSchema', () => {
  it('accepts an answer, a skip and a leave', () => {
    expect(
      discoveryActionSchema.parse({
        action: 'answer',
        questionId: 'q04',
        answer: ' x ',
        branch: 'no',
      })
    ).toEqual({ action: 'answer', questionId: 'q04', answer: 'x', branch: 'no' });
    expect(discoveryActionSchema.safeParse({ action: 'skip', questionId: 'q01' }).success).toBe(
      true
    );
    expect(discoveryActionSchema.safeParse({ action: 'leave' }).success).toBe(true);
  });

  it.each([
    ['an empty answer', { action: 'answer', questionId: 'q01', answer: '   ' }],
    [
      'an answer over the limit',
      { action: 'answer', questionId: 'q01', answer: 'x'.repeat(MAX_ANSWER_LENGTH + 1) },
    ],
    ['a missing question', { action: 'answer', answer: 'x' }],
    ['an unknown branch', { action: 'answer', questionId: 'q01', answer: 'x', branch: 'maybe' }],
    ['an unknown key', { action: 'skip', questionId: 'q01', extra: true }],
    ['an unknown action', { action: 'delete', questionId: 'q01' }],
  ])('refuses %s', (_label, body) => {
    expect(discoveryActionSchema.safeParse(body).success).toBe(false);
  });

  it('accepts an answer at exactly the limit', () => {
    const body = { action: 'answer', questionId: 'q01', answer: 'x'.repeat(MAX_ANSWER_LENGTH) };
    expect(discoveryActionSchema.safeParse(body).success).toBe(true);
  });
});
