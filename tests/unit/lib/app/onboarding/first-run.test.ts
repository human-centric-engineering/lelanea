/**
 * The first-run rules (t-103): which beats exist, in what order, how each is
 * keyed in the onboarding node's `progress`, and what is still to come.
 *
 * @see lib/app/onboarding/first-run.ts
 */

import { describe, expect, it } from 'vitest';

import {
  FIRST_RUN_BEATS,
  firstRunBeatSchema,
  NOTHING_RECORDED,
  ONBOARDING_READS,
  pendingBeats,
  progressFromLedger,
  progressKeyFor,
  readPath,
} from '@/lib/app/onboarding/first-run';
import { seededDocumentRows } from '@/tests/helpers/app/foundational-documents';

describe('the reads', () => {
  it('are heart, mission, creator, lineage, in that order', () => {
    expect(ONBOARDING_READS).toEqual([
      'the_heart_behind_lelanea',
      'the_mission',
      'about_the_creator',
      'the_lineage_of_lelanea',
    ]);
  });

  it('are each a document the seed writes', () => {
    const ids = new Set(seededDocumentRows().map((row) => row.slug));
    for (const id of ONBOARDING_READS) expect(ids.has(id), id).toBe(true);
  });

  it('open in the shell', () => {
    expect(readPath('the_mission')).toBe('/app/read/the_mission');
  });
});

describe('the beats', () => {
  it('welcome first, then orient', () => {
    expect(FIRST_RUN_BEATS).toEqual([
      'initiation',
      'read:the_heart_behind_lelanea',
      'read:the_mission',
      'read:about_the_creator',
      'read:the_lineage_of_lelanea',
    ]);
  });

  it('are each recorded under their own flat key, so a shallow merge loses none', () => {
    const keys = FIRST_RUN_BEATS.map(progressKeyFor);
    expect(new Set(keys).size).toBe(keys.length);
    expect(progressKeyFor('initiation')).toBe('initiation_shown_at');
    expect(progressKeyFor('read:the_mission')).toBe('read_offered_at:the_mission');
  });

  it('accepts exactly those beats on the wire', () => {
    for (const beat of FIRST_RUN_BEATS) {
      expect(firstRunBeatSchema.safeParse({ beat }).success, beat).toBe(true);
    }
    for (const beat of ['read:the_initiation', 'read:disclaimer', 'read:', 'welcome', '']) {
      expect(firstRunBeatSchema.safeParse({ beat }).success, beat).toBe(false);
    }
  });
});

describe('progressFromLedger', () => {
  it('reads nothing recorded from an empty or missing payload', () => {
    for (const payload of [null, undefined, {}, [], 'x', 3]) {
      expect(progressFromLedger(payload)).toEqual(NOTHING_RECORDED);
    }
  });

  it('reads its own keys and ignores anything else the module records there', () => {
    const progress = progressFromLedger({
      initiation_shown_at: '2026-09-30T10:00:00.000Z',
      'read_offered_at:the_mission': '2026-09-30T10:05:00.000Z',
      discovery_started_at: '2026-09-30T10:10:00.000Z',
    });
    expect(progress).toEqual({ initiationShown: true, readsOffered: ['the_mission'] });
  });

  it('counts a null tombstone as not recorded', () => {
    expect(progressFromLedger({ initiation_shown_at: null }).initiationShown).toBe(false);
  });

  it('lists the reads in the order they are offered, not the payload’s', () => {
    const progress = progressFromLedger({
      'read_offered_at:the_lineage_of_lelanea': 't',
      'read_offered_at:the_heart_behind_lelanea': 't',
    });
    expect(progress.readsOffered).toEqual(['the_heart_behind_lelanea', 'the_lineage_of_lelanea']);
  });
});

describe('pendingBeats', () => {
  it('is every beat for someone new', () => {
    expect(pendingBeats(NOTHING_RECORDED)).toEqual(FIRST_RUN_BEATS);
  });

  it('resumes after what is recorded, skipping a read already offered', () => {
    expect(
      pendingBeats({ initiationShown: true, readsOffered: ['the_heart_behind_lelanea'] })
    ).toEqual(['read:the_mission', 'read:about_the_creator', 'read:the_lineage_of_lelanea']);
  });

  it('is empty once every beat is behind the person', () => {
    expect(pendingBeats({ initiationShown: true, readsOffered: [...ONBOARDING_READS] })).toEqual(
      []
    );
  });
});
