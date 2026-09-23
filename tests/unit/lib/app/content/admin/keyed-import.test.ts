/**
 * The keyed import planner shared by the content editors and the slot
 * taxonomy (f-content-seeds t-91). The slot planner's own tests
 * (`tests/unit/lib/app/slots/definitions-admin.test.ts`) cover it through that
 * caller; these pin the rules the content callers rely on.
 */

import { describe, expect, it } from 'vitest';

import {
  changedFieldsOf,
  keyedPlanWritesNothing,
  planKeyedImport,
  stableJson,
} from '@/lib/app/content/admin/keyed-import';
import { nextAcknowledgementVersion } from '@/lib/app/content/admin/ack-version';

interface F {
  text: string;
  meta: { a: number; b: number } | null;
}
const FIELDS = ['text', 'meta'] as const;

function plan(
  incoming: { key: string; value: F }[],
  stored: { key: string; fields: F; revision: number; retired?: boolean }[],
  onAbsent: 'keep' | ((before: F) => F | null) = 'keep'
) {
  return planKeyedImport<F, F>({
    incoming,
    stored,
    diff: (before, after) => changedFieldsOf(before, after, FIELDS),
    allFields: FIELDS,
    toCreate: (value) => value,
    toUpdate: (_before, value) => value,
    onAbsent,
  });
}

const row = (key: string, text: string, revision = 1) => ({
  key,
  fields: { text, meta: null },
  revision,
});

describe('planKeyedImport', () => {
  it('creates, updates and leaves unchanged, with the revision each will produce', () => {
    const result = plan(
      [
        { key: 'a', value: { text: 'same', meta: null } },
        { key: 'b', value: { text: 'new words', meta: null } },
        { key: 'c', value: { text: 'fresh', meta: null } },
      ],
      [row('a', 'same'), row('b', 'old words', 4)]
    );
    expect(result.unchanged).toEqual(['a']);
    expect(result.updates).toEqual([
      expect.objectContaining({ key: 'b', changedFields: ['text'], revision: 5 }),
    ]);
    expect(result.creates).toEqual([
      expect.objectContaining({ key: 'c', changedFields: ['text', 'meta'], revision: 1 }),
    ]);
  });

  it('never revives a retired key, and never removes one again', () => {
    const result = plan(
      [{ key: 'r', value: { text: 'x', meta: null } }],
      [
        { ...row('r', 'x'), retired: true },
        { ...row('s', 'y'), retired: true },
      ],
      () => null
    );
    expect(result.skippedRetired).toEqual(['r']);
    expect(result.removals).toEqual([]);
    expect(keyedPlanWritesNothing(result)).toBe(true);
  });

  it('reports an absent key, and removes it only when told how', () => {
    expect(plan([], [row('gone', 'x')]).removals).toEqual([]);
    expect(plan([], [row('gone', 'x')]).absentFromFile).toEqual(['gone']);
    expect(plan([], [row('gone', 'x')], () => null).removals).toEqual([
      expect.objectContaining({ key: 'gone', after: null }),
    ]);
  });

  it('is not fooled by key order inside JSON', () => {
    const result = plan(
      [{ key: 'a', value: { text: 'x', meta: { b: 2, a: 1 } } }],
      [{ key: 'a', fields: { text: 'x', meta: { a: 1, b: 2 } }, revision: 1 }]
    );
    expect(result.unchanged).toEqual(['a']);
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});

describe('nextAcknowledgementVersion', () => {
  it.each([
    ['1.1', '1.2'],
    ['1.9', '1.10'],
    ['2', '2.1'],
    ['1.1-draft', '1.1-draft.1'],
  ])('%s → %s', (current, next) => {
    expect(nextAcknowledgementVersion(current)).toBe(next);
  });
});
