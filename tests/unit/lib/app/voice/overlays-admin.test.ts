/**
 * Her register overlays, edited in the admin (f-content-seeds t-92).
 *
 * Runs the REAL seed, the REAL admin service and the REAL voice contributor
 * against one in-memory database (`tests/helpers/app/content-db-fake.ts`), so
 * "an overlay edit is what the next turn's prompt carries" is shown on the
 * block `loadVoiceContext` composes from the row, not on the service's return
 * value. Only what the contributor reaches beyond the rows is stubbed: her
 * passages, the slot vocabulary and the resource offering.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/app/voice/exemplars', () => ({
  retrieveVoiceExemplarsSafely: vi.fn(async () => []),
}));
vi.mock('@/lib/app/slots/vocabulary', () => ({ slotVocabulary: vi.fn(async () => '') }));
vi.mock('@/lib/app/resources/offering', () => ({ loadResourceOffering: vi.fn(async () => '') }));
vi.mock('@/lib/framework/facilitation/agents/binding-queries', () => ({
  getFacilitationBindingByRole: vi.fn(async () => null),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { seedVoiceOverlays } from '@/lib/app/content/voice-overlay-store';
import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { loadVoiceContext } from '@/lib/app/voice/context-contributor';
import * as overlays from '@/lib/app/voice/overlays-admin';
import type { OverlayEdit } from '@/lib/validations/app-voice-content';

const EDITOR = 'editor-id';

beforeEach(async () => {
  db.current = createContentDbFake();
  await seedVoiceOverlays(buildVoiceOverlaySeed(), db.current.client as unknown as PrismaClient);
  db.current.insert('user', { id: EDITOR, email: 'editor@example.com' });
});

/** The editable words of one overlay, as the view reads them. */
async function editOf(situation: string): Promise<{ edit: OverlayEdit; revision: number }> {
  const row = (await overlays.getOverlaysAdminView()).overlays.find(
    (overlay) => overlay.situation === situation
  )!;
  return {
    revision: row.revision,
    edit: {
      label: row.label,
      when: row.when,
      heading: row.heading,
      lines: row.lines,
      exemplarQuery: row.exemplarQuery,
    },
  };
}

async function statusOf(situation: string) {
  return (await overlays.getOverlaysAdminView()).overlays.find(
    (overlay) => overlay.situation === situation
  )?.status;
}

describe('an edit reaches the next turn', () => {
  it('puts an edited overlay line in the block the next voice turn composes', async () => {
    const before = await loadVoiceContext('first-meeting');
    expect(before).toContain('Meet the person before you offer them anything.');

    const { edit, revision } = await editOf('first-meeting');
    await overlays.updateOverlay(
      'first-meeting',
      { ...edit, lines: ['Say hello as if you had been waiting for them.'] },
      revision,
      EDITOR
    );

    const after = await loadVoiceContext('first-meeting');
    expect(after).toContain('Say hello as if you had been waiting for them.');
    expect(after).not.toContain('Meet the person before you offer them anything.');
  });

  it('puts an edited core-only block in a turn no overlay matches', async () => {
    const view = await overlays.getOverlaysAdminView();
    await overlays.updateOverlaySet(
      {
        exemplars: view.set!.exemplars,
        coreOnly: { heading: 'Register for this moment', lines: ['Plainer, and shorter.'] },
      },
      view.set!.revision,
      EDITOR
    );

    expect(await loadVoiceContext('no-such-moment')).toContain('Plainer, and shorter.');
  });

  it('makes a newly added situation selectable by name on the next turn', async () => {
    await overlays.createOverlay(
      {
        situation: 'grief',
        label: 'Grief',
        when: 'Someone has lost someone.',
        heading: 'Register for this moment — grief',
        lines: ['Stay. Do not reach for meaning on their behalf.'],
        exemplarQuery: 'loss, grief, staying with someone',
      },
      EDITOR
    );

    expect(await loadVoiceContext('grief')).toContain('Do not reach for meaning on their behalf.');
    const added = (await overlays.getOverlaysAdminView()).overlays.at(-1)!;
    expect(added).toMatchObject({ situation: 'grief', position: 5, status: 'draft', revision: 1 });
  });
});

describe('sign-off', () => {
  it('shows a signed-off overlay as signed off, and records the sign-off as a revision', async () => {
    const { revision } = await editOf('values');
    const outcome = await overlays.signOffOverlay('values', revision, EDITOR);

    expect(outcome).toMatchObject({ status: 'signed_off', revision: revision + 1 });
    expect(await statusOf('values')).toBe('signed_off');
    const [latest] = await overlays.listOverlayHistory('values');
    expect(latest).toMatchObject({
      revision: revision + 1,
      changedFields: ['status'],
      origin: 'admin',
      editorEmail: 'editor@example.com',
    });
  });

  it('returns a signed-off overlay to draft when its words change', async () => {
    const first = await editOf('values');
    await overlays.signOffOverlay('values', first.revision, EDITOR);
    const signed = await editOf('values');

    const outcome = await overlays.updateOverlay(
      'values',
      { ...signed.edit, heading: 'A new heading' },
      signed.revision,
      EDITOR
    );

    expect(outcome.status).toBe('draft');
    expect(outcome.changed).toEqual(['heading']);
    expect(await statusOf('values')).toBe('draft');
    const [latest] = await overlays.listOverlayHistory('values');
    expect(latest?.changedFields).toEqual(['heading', 'status']);
  });

  it('refuses a sign-off of words that have changed since they were read', async () => {
    const { edit, revision } = await editOf('values');
    await overlays.updateOverlay(
      'values',
      { ...edit, label: 'Values, reworded' },
      revision,
      EDITOR
    );

    await expect(overlays.signOffOverlay('values', revision, EDITOR)).rejects.toMatchObject({
      status: 409,
    });
    expect(await statusOf('values')).toBe('draft');
  });

  it('signs the set off, and an edit to it returns it to draft', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    await overlays.signOffOverlaySet(set.revision, EDITOR);
    const signed = (await overlays.getOverlaysAdminView()).set!;
    expect(signed.status).toBe('signed_off');

    await overlays.updateOverlaySet(
      {
        exemplars: { ...signed.exemplars, heading: 'Her writing, for register' },
        coreOnly: signed.coreOnly,
      },
      signed.revision,
      EDITOR
    );
    expect((await overlays.getOverlaysAdminView()).set!.status).toBe('draft');
  });
});

describe('saves', () => {
  it('writes nothing, not even a revision, when nothing changed', async () => {
    const { edit, revision } = await editOf('discovery');
    const before = db.current!.fingerprint();

    const outcome = await overlays.updateOverlay('discovery', edit, revision, EDITOR);

    expect(outcome.changed).toEqual([]);
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('refuses a save against a revision that has moved', async () => {
    const { edit, revision } = await editOf('discovery');
    await overlays.updateOverlay('discovery', { ...edit, label: 'First' }, revision, EDITOR);

    await expect(
      overlays.updateOverlay('discovery', { ...edit, label: 'Second' }, revision, EDITOR)
    ).rejects.toMatchObject({ status: 409, details: { reason: 'revision_moved' } });
  });

  it('restores an earlier revision as a new one, in draft', async () => {
    const { edit, revision } = await editOf('discovery');
    await overlays.updateOverlay('discovery', { ...edit, label: 'Changed' }, revision, EDITOR);

    const outcome = await overlays.restoreOverlayRevision('discovery', 1, revision + 1, EDITOR);

    expect(outcome).toMatchObject({ changed: ['label'], revision: revision + 2, status: 'draft' });
    expect((await editOf('discovery')).edit.label).toBe(edit.label);
  });

  it('refuses a situation key that is already taken', async () => {
    const { edit } = await editOf('values');
    await expect(
      overlays.createOverlay({ ...edit, situation: 'values' }, EDITOR)
    ).rejects.toMatchObject({ status: 409, details: { reason: 'exists' } });
  });
});

describe('deleting a situation', () => {
  it('names the seat that selects it, and closes the gap in the order', async () => {
    const { revision } = await editOf('first-meeting');

    const outcome = await overlays.deleteOverlay('first-meeting', revision, EDITOR);

    expect(outcome.selectedBy[0]).toMatch(/onboarding seat/);
    expect(outcome.removed.lines[0]).toBe('Meet the person before you offer them anything.');
    const left = (await overlays.getOverlaysAdminView()).overlays;
    expect(left.map((row) => [row.situation, row.position])).toEqual([
      ['discovery', 1],
      ['values', 2],
      ['difficulty', 3],
    ]);
  });

  it('names what selects each overlay on the view, before anyone deletes it', async () => {
    const view = await overlays.getOverlaysAdminView();
    const firstMeeting = view.overlays.find((row) => row.situation === 'first-meeting')!;
    const values = view.overlays.find((row) => row.situation === 'values')!;

    expect(firstMeeting.selectedBy).toHaveLength(2);
    expect(values.selectedBy).toEqual(['the admin chat, when it is asked for this situation']);
  });

  it('keeps a move from undoing a sign-off: the order decides nothing a model reads', async () => {
    const values = await editOf('values');
    await overlays.signOffOverlay('values', values.revision, EDITOR);
    const { revision } = await editOf('first-meeting');

    await overlays.deleteOverlay('first-meeting', revision, EDITOR);

    expect(await statusOf('values')).toBe('signed_off');
  });

  it('refuses to delete the last one', async () => {
    for (const situation of ['first-meeting', 'discovery', 'values']) {
      await overlays.deleteOverlay(situation, (await editOf(situation)).revision, EDITOR);
    }
    const { revision } = await editOf('difficulty');

    await expect(overlays.deleteOverlay('difficulty', revision, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'last_overlay' },
    });
  });
});

describe('the file round-trip', () => {
  it('plans no writes when a fresh export is imported, and applying it writes nothing', async () => {
    const file = await overlays.exportOverlaysFile();
    const before = db.current!.fingerprint();

    const preview = await overlays.previewOverlaysImport(file, false);
    const applied = await overlays.applyOverlaysImport(file, false, EDITOR);

    expect(preview.writesNothing).toBe(true);
    expect(applied.writesNothing).toBe(true);
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('still round-trips after an edit, a new situation and a deletion', async () => {
    const { edit, revision } = await editOf('values');
    await overlays.updateOverlay('values', { ...edit, label: 'Values, again' }, revision, EDITOR);
    await overlays.createOverlay({ ...edit, situation: 'grief', label: 'Grief' }, EDITOR);
    await overlays.deleteOverlay('discovery', (await editOf('discovery')).revision, EDITOR);

    const file = await overlays.exportOverlaysFile();
    expect((await overlays.previewOverlaysImport(file, false)).writesNothing).toBe(true);
    expect((await overlays.previewOverlaysImport(file, true)).writesNothing).toBe(true);
  });

  it('keeps a situation the file leaves out, and says so, unless asked to remove it', async () => {
    const file = await overlays.exportOverlaysFile();
    const without = { ...file, overlays: file.overlays.filter((o) => o.situation !== 'values') };

    const kept = await overlays.applyOverlaysImport(without, false, EDITOR);

    const section = kept.sections.find((s) => s.entity === 'overlay')!;
    expect(section.removals).toEqual([]);
    expect(section.kept).toEqual(['values']);
    const stored = (await overlays.getOverlaysAdminView()).overlays;
    expect(stored.map((row) => row.situation)).toEqual([
      'first-meeting',
      'discovery',
      'difficulty',
      'values',
    ]);
    expect(stored.map((row) => row.position)).toEqual([1, 2, 3, 4]);
  });

  it('removes it when asked, and only then', async () => {
    const file = await overlays.exportOverlaysFile();
    const without = { ...file, overlays: file.overlays.filter((o) => o.situation !== 'values') };

    const preview = await overlays.previewOverlaysImport(without, true);
    expect(preview.sections.find((s) => s.entity === 'overlay')!.removals).toEqual([
      { key: 'values', changedFields: expect.any(Array) },
    ]);
    await overlays.applyOverlaysImport(without, true, EDITOR);

    expect((await overlays.getOverlaysAdminView()).overlays.map((row) => row.situation)).toEqual([
      'first-meeting',
      'discovery',
      'difficulty',
    ]);
  });

  it('returns an imported change to draft, and leaves an untouched overlay signed off', async () => {
    for (const situation of ['values', 'discovery']) {
      await overlays.signOffOverlay(situation, (await editOf(situation)).revision, EDITOR);
    }
    const file = await overlays.exportOverlaysFile();
    const changed = {
      ...file,
      overlays: file.overlays.map((o) => (o.situation === 'values' ? { ...o, label: 'New' } : o)),
    };

    await overlays.applyOverlaysImport(changed, false, EDITOR);

    expect(await statusOf('values')).toBe('draft');
    expect(await statusOf('discovery')).toBe('signed_off');
  });

  it('refuses a file for another set', async () => {
    const file = await overlays.exportOverlaysFile();
    const other = { ...file, fingerprint: { ...file.fingerprint, id: 'someone_elses_overlays' } };
    const before = db.current!.fingerprint();

    await expect(overlays.applyOverlaysImport(other, false, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'import_refused' },
    });
    expect(db.current!.fingerprint()).toBe(before);
  });
});
