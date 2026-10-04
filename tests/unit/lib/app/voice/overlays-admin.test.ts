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

/** The fake as the Prisma client it stands in for, for a test that edits a stored row directly. */
const stored = () => db.current!.client as unknown as PrismaClient;

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
    expect(added).toMatchObject({ situation: 'grief', position: 7, status: 'draft', revision: 1 });
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

// t-114: the set and each overlay are found by their name first, and their
// revisions by the generated id that read returns. These are the paths where
// the name finds nothing.
describe('history and restore, when the name finds nothing', () => {
  it('lists the set history, and none on a database that was never seeded', async () => {
    expect((await overlays.listOverlaySetHistory()).map((entry) => entry.revision)).toEqual([1]);

    db.current = createContentDbFake();
    expect(await overlays.listOverlaySetHistory()).toEqual([]);
  });

  it('lists one overlay history, and refuses a situation nobody holds', async () => {
    expect((await overlays.listOverlayHistory('discovery')).map((entry) => entry.revision)).toEqual(
      [1]
    );
    await expect(overlays.listOverlayHistory('nowhere')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to restore a revision the set or an overlay never had', async () => {
    await expect(overlays.restoreOverlaySetRevision(99, 1, EDITOR)).rejects.toMatchObject({
      status: 404,
    });
    await expect(overlays.restoreOverlayRevision('discovery', 99, 1, EDITOR)).rejects.toMatchObject(
      { status: 404 }
    );
    await expect(overlays.restoreOverlayRevision('nowhere', 1, 1, EDITOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses the set revision on a database that was never seeded', async () => {
    db.current = createContentDbFake();
    await expect(overlays.restoreOverlaySetRevision(1, 1, EDITOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('plans an import into a database that was never seeded as a refusal, writing nothing', async () => {
    const file = await overlays.exportOverlaysFile();
    db.current = createContentDbFake();

    const preview = await overlays.previewOverlaysImport(file, false);

    expect(preview.refusals.length).toBeGreaterThan(0);
    expect(db.current.rows('appVoiceOverlaySet')).toEqual([]);
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
      ['guiding', 4],
      ['teaching', 5],
    ]);
  });

  it('names what selects each overlay on the view, before anyone deletes it', async () => {
    const view = await overlays.getOverlaysAdminView();
    const firstMeeting = view.overlays.find((row) => row.situation === 'first-meeting')!;
    const values = view.overlays.find((row) => row.situation === 'values')!;

    expect(firstMeeting.selectedBy).toHaveLength(2);
    expect(values.selectedBy).toEqual(['the admin chat, when it is asked for this situation']);
    // A register's overlay is chosen by the facilitator seat, not pinned to it (t-125).
    for (const register of ['guiding', 'teaching']) {
      const row = view.overlays.find((r) => r.situation === register)!;
      expect(row.selectedBy[0]).toBe(
        `the facilitator seat, whenever a turn is steered to the ${register} register`
      );
    }
  });

  it('keeps a move from undoing a sign-off: the order decides nothing a model reads', async () => {
    const values = await editOf('values');
    await overlays.signOffOverlay('values', values.revision, EDITOR);
    const { revision } = await editOf('first-meeting');

    await overlays.deleteOverlay('first-meeting', revision, EDITOR);

    expect(await statusOf('values')).toBe('signed_off');
  });

  it('refuses to delete the last one', async () => {
    for (const situation of ['first-meeting', 'discovery', 'values', 'guiding', 'teaching']) {
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
      'guiding',
      'teaching',
      'values',
    ]);
    expect(stored.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6]);
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
      'guiding',
      'teaching',
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

describe('an unseeded database', () => {
  it('reports itself plainly, with nothing to edit', async () => {
    db.current = createContentDbFake();

    expect(await overlays.getOverlaysAdminView()).toEqual({
      seeded: false,
      unservable: null,
      set: null,
      overlays: [],
    });
  });

  it('refuses to save, sign off, or add to the set', async () => {
    db.current = createContentDbFake();
    const blank = {
      exemplars: {
        heading: 'h',
        originLabel: 'o',
        lines: ['l'],
        noneFoundNote: 'n',
        unavailableNote: 'u',
      },
      coreOnly: { heading: 'h', lines: ['l'] },
    };

    await expect(overlays.updateOverlaySet(blank, 1, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'not_seeded' },
    });
    await expect(overlays.signOffOverlaySet(1, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'not_seeded' },
    });
    await expect(
      overlays.createOverlay(
        {
          situation: 'grief',
          label: 'Grief',
          when: 'w',
          heading: 'h',
          lines: ['l'],
          exemplarQuery: 'q',
        },
        EDITOR
      )
    ).rejects.toMatchObject({ status: 409, details: { reason: 'not_seeded' } });
    await expect(overlays.exportOverlaysFile()).rejects.toMatchObject({
      status: 409,
      details: { reason: 'nothing_to_export' },
    });
  });
});

describe('a stored row the schemas no longer accept', () => {
  it('marks the set unservable and its fields unreadable, but still lists the overlays', async () => {
    const setRow = db.current!.rows('appVoiceOverlaySet')[0];
    await stored().appVoiceOverlaySet.update({
      where: { id: String(setRow.id) },
      data: { coreOnly: { heading: '', lines: ['x'] } },
    });

    const view = await overlays.getOverlaysAdminView();

    expect(view.seeded).toBe(true);
    expect(view.unservable).toMatch(/failed validation on read/);
    expect(view.set).toBeNull();
    expect(view.overlays).toHaveLength(6);
  });

  it('refuses to export overlays when a stored row no longer fits the file schema', async () => {
    const overlayRow = db.current!.rows('appVoiceOverlay')[0];
    await stored().appVoiceOverlay.update({
      where: { id: String(overlayRow.id) },
      data: { label: '' },
    });

    await expect(overlays.exportOverlaysFile()).rejects.toMatchObject({
      status: 409,
      details: { reason: 'unexportable' },
    });
  });

  it('plans a wholesale replace of the set’s framing when its stored JSON no longer parses', async () => {
    const file = await overlays.exportOverlaysFile();
    const setRow = db.current!.rows('appVoiceOverlaySet')[0];
    await stored().appVoiceOverlaySet.update({
      where: { id: String(setRow.id) },
      data: { coreOnly: { heading: '', lines: ['x'] } },
    });

    const preview = await overlays.previewOverlaysImport(file, false);

    const section = preview.sections.find((s) => s.entity === 'set')!;
    expect(section.updates[0].changedFields).toEqual([
      'title',
      'version',
      'locale',
      'provenance',
      'exemplars',
      'coreOnly',
      'leanings',
    ]);
  });
});

describe('the set’s framing, on its own', () => {
  it('refuses a save against a revision that has moved', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    await overlays.updateOverlaySet(
      { exemplars: set.exemplars, coreOnly: { heading: 'First', lines: ['First'] } },
      set.revision,
      EDITOR
    );

    await expect(
      overlays.updateOverlaySet(
        { exemplars: set.exemplars, coreOnly: { heading: 'Second', lines: ['Second'] } },
        set.revision,
        EDITOR
      )
    ).rejects.toMatchObject({ status: 409, details: { reason: 'revision_moved' } });
  });

  it('writes nothing when nothing changed', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    const before = db.current!.fingerprint();

    const outcome = await overlays.updateOverlaySet(
      { exemplars: set.exemplars, coreOnly: set.coreOnly },
      set.revision,
      EDITOR
    );

    expect(outcome.changed).toEqual([]);
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('restores an earlier revision as a new one, in draft', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    await overlays.updateOverlaySet(
      { exemplars: set.exemplars, coreOnly: { heading: 'Changed heading', lines: ['Changed'] } },
      set.revision,
      EDITOR
    );

    const outcome = await overlays.restoreOverlaySetRevision(1, set.revision + 1, EDITOR);

    expect(outcome).toMatchObject({ status: 'draft', revision: set.revision + 2 });
    const after = (await overlays.getOverlaysAdminView()).set!;
    expect(after.coreOnly).toEqual(set.coreOnly);
  });

  it('refuses to sign off against a revision that has moved', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    await overlays.updateOverlaySet(
      { exemplars: set.exemplars, coreOnly: { heading: 'Changed', lines: ['Changed'] } },
      set.revision,
      EDITOR
    );

    await expect(overlays.signOffOverlaySet(set.revision, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'revision_moved' },
    });
  });

  it('signing off twice is a no-op the second time', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    const first = await overlays.signOffOverlaySet(set.revision, EDITOR);

    const second = await overlays.signOffOverlaySet(first.revision, EDITOR);

    expect(second).toMatchObject({ changed: [], status: 'signed_off', revision: first.revision });
    expect(await overlays.listOverlaySetHistory()).toHaveLength(2);
  });
});

describe('one overlay, edge cases', () => {
  it('refuses to update, sign off, or delete a situation nobody holds', async () => {
    const { edit } = await editOf('values');

    await expect(overlays.updateOverlay('nowhere', edit, 1, EDITOR)).rejects.toMatchObject({
      status: 404,
    });
    await expect(overlays.signOffOverlay('nowhere', 1, EDITOR)).rejects.toMatchObject({
      status: 404,
    });
    await expect(overlays.deleteOverlay('nowhere', 1, EDITOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('signing one overlay off twice is a no-op the second time', async () => {
    const { revision } = await editOf('values');
    const first = await overlays.signOffOverlay('values', revision, EDITOR);

    const second = await overlays.signOffOverlay('values', first.revision, EDITOR);

    expect(second).toMatchObject({ changed: [], status: 'signed_off', revision: first.revision });
  });
});

describe('adding a situation directly', () => {
  it('positions the first overlay at 1 when the set has none yet', async () => {
    await stored().appVoiceOverlay.deleteMany({ where: {} });

    const created = await overlays.createOverlay(
      {
        situation: 'first-ever',
        label: 'First ever',
        when: 'w',
        heading: 'h',
        lines: ['l'],
        exemplarQuery: 'q',
      },
      EDITOR
    );

    expect(created).toEqual({ situation: 'first-ever', position: 1 });
  });

  it('treats a duplicate insert that slips past the check as the situation being taken', async () => {
    interface CreateDelegate {
      create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    }
    const overlayTable = db.current!.client.appVoiceOverlay as CreateDelegate;
    const createSpy = vi
      .spyOn(overlayTable, 'create')
      .mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      );

    await expect(
      overlays.createOverlay(
        {
          situation: 'brand-new',
          label: 'L',
          when: 'w',
          heading: 'h',
          lines: ['l'],
          exemplarQuery: 'q',
        },
        EDITOR
      )
    ).rejects.toMatchObject({ status: 409, details: { reason: 'exists' } });

    createSpy.mockRestore();
  });
});

describe('a set-level change through the file round-trip', () => {
  it('previews a set-level change as its own section', async () => {
    const file = await overlays.exportOverlaysFile();
    const changed = { ...file, fingerprint: { ...file.fingerprint, title: 'A retitled set' } };

    const preview = await overlays.previewOverlaysImport(changed, false);

    expect(preview.sections.find((s) => s.entity === 'set')).toMatchObject({
      updates: [{ changedFields: ['title'] }],
    });
  });

  it('applies a set-level change: writes the pointer and its revision', async () => {
    const before = (await overlays.getOverlaysAdminView()).set!;
    const file = await overlays.exportOverlaysFile();
    const changed = { ...file, fingerprint: { ...file.fingerprint, title: 'A retitled set' } };

    await overlays.applyOverlaysImport(changed, false, EDITOR);

    const after = (await overlays.getOverlaysAdminView()).set!;
    expect(after).toMatchObject({
      title: 'A retitled set',
      revision: before.revision + 1,
      status: 'draft',
    });
    const [latest] = await overlays.listOverlaySetHistory();
    expect(latest.changedFields).toEqual(['title']);
  });

  it('appends a status flip to the history when a set-level import lands on a signed-off set', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    await overlays.signOffOverlaySet(set.revision, EDITOR);
    const file = await overlays.exportOverlaysFile();
    const changed = { ...file, fingerprint: { ...file.fingerprint, title: 'A retitled set' } };

    await overlays.applyOverlaysImport(changed, false, EDITOR);

    expect((await overlays.getOverlaysAdminView()).set!.status).toBe('draft');
    const [latest] = await overlays.listOverlaySetHistory();
    expect(latest.changedFields).toEqual(['title', 'status']);
  });

  it('creates a new overlay from an import that adds a situation the store does not have', async () => {
    const file = await overlays.exportOverlaysFile();
    const withNew = {
      ...file,
      overlays: [
        ...file.overlays,
        {
          situation: 'grief',
          label: 'Grief',
          when: 'Someone has lost someone.',
          heading: 'Register for this moment — grief',
          lines: ['Stay.'],
          exemplarQuery: 'loss, grief',
        },
      ],
    };

    await overlays.applyOverlaysImport(withNew, false, EDITOR);

    const created = (await overlays.getOverlaysAdminView()).overlays.find(
      (o) => o.situation === 'grief'
    );
    expect(created).toMatchObject({ status: 'draft', revision: 1, position: 7 });
  });
});

describe('overlaysExportFilename', () => {
  it('names the export file by the date', () => {
    expect(overlays.overlaysExportFilename(new Date('2026-03-04T12:00:00Z'))).toBe(
      'lelanea-voice-overlays-2026-03-04.json'
    );
  });
});

describe('the leaning bounds travel with the set (f-leanings t-135)', () => {
  /** The stored bounds, read the way the leanings store reads them. */
  const storedBounds = () => db.current!.rows('appVoiceOverlaySet')[0].leanings;

  it('are exported with the set, so an export can be imported back whole', async () => {
    const file = await overlays.exportOverlaysFile();

    expect(file.leanings).toEqual(buildVoiceOverlaySeed().set.leanings);
  });

  it('are kept when an imported file carries none, rather than read as "lock every dial"', async () => {
    const before = storedBounds();
    const { leanings: _none, ...file } = await overlays.exportOverlaysFile();
    const changed = { ...file, fingerprint: { ...file.fingerprint, title: 'A retitled set' } };

    const preview = await overlays.previewOverlaysImport(changed, false);
    await overlays.applyOverlaysImport(changed, false, EDITOR);

    expect(preview.sections.find((s) => s.entity === 'set')).toMatchObject({
      updates: [{ changedFields: ['title'] }],
    });
    expect(storedBounds()).toEqual(before);
    const [latest] = await overlays.listOverlaySetHistory();
    expect(latest.snapshot.leanings).toEqual(before);
  });

  it('change through an import that carries different ones, recorded as such', async () => {
    const file = await overlays.exportOverlaysFile();
    const tighter = {
      ...file.leanings!,
      dials: { ...file.leanings!.dials, pace: { min: 0, max: 0, suggest: false } },
    };

    await overlays.applyOverlaysImport({ ...file, leanings: tighter }, false, EDITOR);

    expect(storedBounds()).toEqual(tighter);
    const [latest] = await overlays.listOverlaySetHistory();
    expect(latest.changedFields).toEqual(['leanings']);
  });

  it('are kept when a revision from before them is restored', async () => {
    const before = storedBounds();
    // Revision 1 as a database migrated by t-135 holds it: written before the
    // set had bounds, so its column is null.
    const first = db.current!.rows('appVoiceOverlaySetRevision').find((r) => r.revision === 1)!;
    // Through the fake's own client, untyped: Prisma's input type has no plain
    // `null` for a JSON column, and the stored value is exactly that.
    const revisions = db.current!.client.appVoiceOverlaySetRevision as {
      update: (args: { where: { id: string }; data: { leanings: null } }) => Promise<unknown>;
    };
    await revisions.update({ where: { id: String(first.id) }, data: { leanings: null } });
    expect(
      db.current!.rows('appVoiceOverlaySetRevision').find((r) => r.revision === 1)!.leanings
    ).toBeNull();
    const set = (await overlays.getOverlaysAdminView()).set!;
    await overlays.updateOverlaySet(
      { exemplars: set.exemplars, coreOnly: { heading: 'Changed heading', lines: ['Changed'] } },
      set.revision,
      EDITOR
    );

    await overlays.restoreOverlaySetRevision(1, set.revision + 1, EDITOR);

    expect(storedBounds()).toEqual(before);
    const [latest] = await overlays.listOverlaySetHistory();
    expect(latest.changedFields).toEqual(['coreOnly']);
  });

  it('are snapshotted on every revision, a sign-off included', async () => {
    const set = (await overlays.getOverlaysAdminView()).set!;
    await overlays.signOffOverlaySet(set.revision, EDITOR);

    for (const revision of db.current!.rows('appVoiceOverlaySetRevision')) {
      expect(revision.leanings, `revision ${String(revision.revision)}`).toEqual(storedBounds());
    }
  });
});
