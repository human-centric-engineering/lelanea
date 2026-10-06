/**
 * The leaning bounds, edited by an admin (f-leanings t-138).
 *
 * Runs the REAL seed, the REAL admin service, the REAL leanings store and the
 * REAL leanings block against one in-memory database
 * (`tests/helpers/app/content-db-fake.ts`), so "an admin's edit is what the
 * person's dials and the AI's instructions honour" is shown on what those
 * readers return from the stored row, not on the service's return value. Only
 * Daybreak's slot writer is stood in for, appending to the same fake table the
 * store reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/framework/data-slots', () => ({
  appendSlotValue: vi.fn(async (input: { userId: string; slotSlug: string }) => {
    const version =
      db
        .current!.rows('slotValue')
        .filter((row) => row.userId === input.userId && row.slotSlug === input.slotSlug).length + 1;
    db.current!.insert('slotValue', { ...input, version, supersededAt: null });
    return { version };
  }),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { seedVoiceOverlays } from '@/lib/app/content/voice-overlay-store';
import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';
import * as overlays from '@/lib/app/voice/overlays-admin';
import { getLeanings, setLeaning } from '@/lib/app/voice/leanings-store';
import {
  LEANING_RULE,
  LEANING_RULE_ASKED_ONLY,
  composeLeaningContext,
} from '@/lib/app/voice/leaning-context';
import {
  LEANING_KEYS,
  LEANING_REASONING_NOTES,
  LEANING_SOURCE_TYPE,
  leaningSlotSlug,
  type LeaningBounds,
  type LeaningDialBounds,
  type LeaningKey,
} from '@/lib/app/voice/leanings';

const EDITOR = 'editor-id';
const PERSON = 'person-id';

beforeEach(async () => {
  db.current = createContentDbFake();
  await seedVoiceOverlays(buildVoiceOverlaySeed(), db.current.client as unknown as PrismaClient);
  db.current.insert('user', { id: EDITOR, email: 'editor@example.com' });
});

/** The bounds and revision the admin page reads. */
async function readSet(): Promise<{ bounds: LeaningBounds; revision: number }> {
  const set = (await overlays.getOverlaysAdminView()).set!;
  return { bounds: set.leanings!, revision: set.revision };
}

/** Save `bounds` with one dial changed, at the revision just read. */
async function saveDial(key: LeaningKey, dial: LeaningDialBounds) {
  const { bounds, revision } = await readSet();
  return overlays.updateLeaningBounds(
    { ...bounds, dials: { ...bounds.dials, [key]: dial } },
    revision,
    EDITOR
  );
}

/** The person's own setting for one dial, stored as the store's writer stores it. */
function storeStop(key: LeaningKey, stop: number) {
  db.current!.insert('slotValue', {
    userId: PERSON,
    slotSlug: leaningSlotSlug(key),
    version: 1,
    value: 'set in Settings',
    valueJson: stop,
    sourceType: LEANING_SOURCE_TYPE,
    reasoningNote: LEANING_REASONING_NOTES.settings,
    supersededAt: null,
  });
}

const dialOf = async (key: LeaningKey) =>
  (await getLeanings(PERSON)).dials.find((dial) => dial.key === key)!;

describe('an admin edits a dial’s bounds', () => {
  it('is a new revision of the set, back to draft, recorded as a change to the bounds', async () => {
    const { revision: before } = await readSet();
    // Signed off first, so the edit has a sign-off to undo.
    await overlays.signOffOverlaySet(before, EDITOR);

    const outcome = await saveDial('pace', { min: -1, max: 1, suggest: true });

    expect(outcome).toMatchObject({ changed: ['leanings'], revision: before + 2, status: 'draft' });
    const [latest] = await overlays.listOverlaySetHistory();
    expect(latest.revision).toBe(before + 2);
    expect(latest.changedFields).toEqual(['leanings', 'status']);
    expect(latest.snapshot.leanings!.dials.pace).toEqual({ min: -1, max: 1, suggest: true });
  });

  it('is what the person’s dials read next, and what a write is clamped to', async () => {
    await saveDial('length', { min: 0, max: 1, suggest: true });

    expect(await dialOf('length')).toMatchObject({ min: 0, max: 1, locked: false });
    const written = await setLeaning({ userId: PERSON, key: 'length', stop: 2, via: 'settings' });
    expect(written.dial.position).toBe(1);
    expect(db.current!.rows('slotValue').map((row) => row.valueJson)).toEqual([1]);
  });

  it('locks a dial with neither way allowed, and a write to it is refused', async () => {
    await saveDial('devotion', { min: 0, max: 0, suggest: true });

    expect(await dialOf('devotion')).toMatchObject({ locked: true, suggest: true });
    await expect(
      setLeaning({ userId: PERSON, key: 'devotion', stop: 1, via: 'settings' })
    ).rejects.toMatchObject({ details: { reason: 'leaning_locked' } });
    expect(db.current!.rows('slotValue')).toEqual([]);
  });

  it('writes nothing when the bounds saved are the ones stored', async () => {
    const { bounds, revision } = await readSet();
    const before = db.current!.fingerprint();

    const outcome = await overlays.updateLeaningBounds(bounds, revision, EDITOR);

    expect(outcome).toMatchObject({ changed: [], revision });
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('is refused when the set moved since it was read, and writes nothing', async () => {
    const { bounds, revision } = await readSet();
    await saveDial('pace', { min: -1, max: 1, suggest: true });
    const before = db.current!.fingerprint();

    await expect(
      overlays.updateLeaningBounds(
        { ...bounds, dials: { ...bounds.dials, imagery: { min: 0, max: 0, suggest: false } } },
        revision,
        EDITOR
      )
    ).rejects.toMatchObject({ details: { reason: 'revision_moved' } });
    expect(db.current!.fingerprint()).toBe(before);
  });
});

describe('tightening a bound never rewrites what a person chose', () => {
  it('clamps it on read, and loosening the bound gives it back', async () => {
    storeStop('warmth', -2);
    const stored = db.current!.rows('slotValue');
    expect(await dialOf('warmth')).toMatchObject({ stored: -2, position: -2 });

    await saveDial('warmth', { min: -1, max: 1, suggest: true });

    expect(await dialOf('warmth')).toMatchObject({ stored: -2, position: -1 });
    expect(db.current!.rows('slotValue')).toEqual(stored);

    await saveDial('warmth', { min: -2, max: 1, suggest: true });

    expect(await dialOf('warmth')).toMatchObject({ stored: -2, position: -2 });
    expect(db.current!.rows('slotValue')).toEqual(stored);
  });

  it('holds a locked dial at rest on read, and leaves the setting stored for later', async () => {
    storeStop('imagery', 2);

    await saveDial('imagery', { min: 0, max: 0, suggest: false });

    expect(await dialOf('imagery')).toMatchObject({ stored: 2, position: 0, locked: true });
    expect(db.current!.rows('slotValue')).toHaveLength(1);
  });
});

describe('an admin turns suggestions off', () => {
  /** The leanings block the AI is given for the person, as composed from the store. */
  const block = async () => composeLeaningContext(await getLeanings(PERSON));
  const lineFor = (text: string, key: LeaningKey) =>
    text.split('\n').find((line) => line.startsWith(`- ${key}:`))!;

  it('for every dial: no dial is offered, and the propose route is left out', async () => {
    const before = await block();
    // The population: with suggestions on, the drafted bounds offer them.
    expect(before).toContain(LEANING_RULE);
    expect(LEANING_KEYS.some((key) => lineFor(before, key).includes('You may suggest'))).toBe(true);

    const { bounds, revision } = await readSet();
    await overlays.updateLeaningBounds({ ...bounds, suggest: false }, revision, EDITOR);

    const after = await block();
    for (const key of LEANING_KEYS) {
      expect(lineFor(after, key), key).not.toContain('You may suggest');
    }
    expect(after).not.toContain('how: proposed');
    expect(after.endsWith(LEANING_RULE_ASKED_ONLY)).toBe(true);
    // A person can still ask.
    expect(after).toContain('use set_leaning with how: asked');
  });

  it('for one dial: that dial only, and the rule still offers the rest', async () => {
    expect(lineFor(await block(), 'length')).toContain('You may suggest a change.');

    await saveDial('length', { min: -2, max: 2, suggest: false });

    const after = await block();
    expect(lineFor(after, 'length')).toContain('Change it only if they ask.');
    expect(lineFor(after, 'length')).not.toContain('You may suggest');
    expect(lineFor(after, 'pace')).toContain('You may suggest a change.');
    expect(after).toContain(LEANING_RULE);
  });
});
