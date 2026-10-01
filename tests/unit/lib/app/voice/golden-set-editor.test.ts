/**
 * The golden set, edited in the admin (f-content-seeds t-92).
 *
 * The REAL editor and the REAL routes against one in-memory database, seeded
 * as seed 004 seeds it: the pointer through `seedGoldenSetPointer`, the dataset
 * and its cases through `projectGoldenSetCases`, the control agent from the
 * authored file. A comparison having run is one `aiEvaluationRun` row naming
 * the dataset, which is exactly what `comparison.ts` writes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';
import { mockAdminUser } from '@/tests/helpers/auth';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
const audit = vi.hoisted(() => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => audit);

import { auth } from '@/lib/auth/config';
import { seedGoldenSetPointer } from '@/lib/app/content/golden-set-store';
import { buildGoldenSetSeed } from '@/lib/app/content/seed-input/golden-set-seed';
import { getVoiceGoldenSet } from '@/lib/app/content/seed-input/voice-golden-set';
import {
  goldenSetDatasetId,
  projectGoldenSetCases,
  VOICE_CONTROL_AGENT_SLUG,
} from '@/lib/app/voice/golden-set';
import { hashDatasetCases } from '@/lib/orchestration/evaluations/datasets/hash';
import * as editor from '@/lib/app/voice/golden-set-editor';
import {
  PUT as savePrompt,
  DELETE as removePrompt,
} from '@/app/api/v1/admin/app/voice/golden-set/prompts/[key]/route';
import { POST as newVersion } from '@/app/api/v1/admin/app/voice/golden-set/versions/route';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

const EDITOR = 'editor-id';
const goldenSet = getVoiceGoldenSet();
const VERSION = goldenSet.collection.version;
const DATASET = goldenSetDatasetId(VERSION, INSTALL_ORG_ID);

/** The fake as the Prisma client it stands in for, for a test that edits a stored row directly. */
const stored = () => db.current!.client as unknown as PrismaClient;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  db.current = createContentDbFake();
  const client = db.current.client as unknown as PrismaClient;
  await seedGoldenSetPointer(buildGoldenSetSeed(goldenSet), client);
  const cases = projectGoldenSetCases(goldenSet);
  db.current.insert('aiDataset', {
    id: DATASET,
    name: `${goldenSet.dataset.name} v${VERSION}`,
    description: goldenSet.dataset.description,
    tags: [...goldenSet.dataset.tags],
    caseCount: cases.length,
    contentHash: hashDatasetCases(cases),
    source: 'manual',
  });
  db.current.insert(
    'aiDatasetCase',
    ...cases.map((entry, index) => ({
      id: `case-${index}`,
      datasetId: DATASET,
      position: entry.position,
      input: entry.input,
      metadata: { ...entry.metadata },
    }))
  );
  db.current.insert('aiAgent', {
    id: 'control',
    slug: VOICE_CONTROL_AGENT_SLUG,
    name: goldenSet.control.name,
    description: goldenSet.control.description,
    systemInstructions: goldenSet.control.systemInstructions,
  });
});

/** A comparison has been queued against the current version. */
function runIt(datasetId = DATASET) {
  db.current!.insert('aiEvaluationRun', { id: `run-${datasetId}`, datasetId });
}

async function view() {
  return editor.getGoldenSetEditorView();
}

const BASE = 'https://lelanea.com/api/v1/admin/app/voice/golden-set';
function req(method: string, path: string, body?: unknown): NextRequest {
  const request = new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as NextRequest;
}
async function call(response: Promise<Response>) {
  const settled = await response;
  return {
    status: settled.status,
    ...((await settled.json()) as {
      data?: Record<string, unknown>;
      error?: { message: string; details?: Record<string, unknown> };
    }),
  };
}
const keyParams = (key: string) => ({ params: Promise.resolve({ key }) });

describe('editing a prompt through the API', () => {
  it('saves a prompt nothing has run yet, and re-pins the dataset hash', async () => {
    const { contentHash, prompts } = await view();
    const first = prompts[0];

    const response = await call(
      savePrompt(
        req('PUT', `/prompts/${first.key}`, {
          kind: first.kind,
          probe: 'Whether the opening sounds like her rather than a product.',
          prompt: first.prompt,
          contentHash,
        }),
        keyParams(first.key)
      )
    );

    expect(response.status).toBe(200);
    const after = await view();
    expect(after.prompts[0]?.probe).toBe(
      'Whether the opening sounds like her rather than a product.'
    );
    expect(after.contentHash).not.toBe(contentHash);
    // The stored hash is the hash of what is stored, as the worker re-checks it.
    const stored = db.current!.rows('aiDataset').find((row) => row.id === DATASET)!;
    const cases = db.current!.rows('aiDatasetCase').filter((row) => row.datasetId === DATASET);
    expect(stored.contentHash).toBe(
      hashDatasetCases(
        cases.map((row) => ({
          position: row.position as number,
          input: row.input,
          metadata: row.metadata,
        }))
      )
    );
    expect(audit.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_voice_golden_set.prompt.update' })
    );
  });

  it('refuses to edit a prompt once a comparison has run, and says why', async () => {
    runIt();
    const { contentHash, prompts, frozen, runCount } = await view();
    expect({ frozen, runCount }).toEqual({ frozen: true, runCount: 1 });
    const first = prompts[0];
    const before = db.current!.fingerprint();

    const response = await call(
      savePrompt(
        req('PUT', `/prompts/${first.key}`, {
          kind: first.kind,
          probe: first.probe,
          prompt: 'Something else',
          contentHash,
        }),
        keyParams(first.key)
      )
    );

    expect(response.status).toBe(409);
    expect(response.error?.details).toMatchObject({ reason: 'golden_set_frozen', runCount: 1 });
    expect(response.error?.message).toMatch(/only readable beside the question/);
    expect(response.error?.message).toMatch(/Start a new version/);
    expect(db.current!.fingerprint()).toBe(before);
    expect(audit.logAdminAction).not.toHaveBeenCalled();
  });

  it('refuses to remove a prompt from a frozen version too', async () => {
    runIt();
    const { contentHash, prompts } = await view();

    const response = await call(
      removePrompt(
        req('DELETE', `/prompts/${prompts[0].key}?contentHash=${contentHash}`),
        keyParams(prompts[0].key)
      )
    );

    expect(response.status).toBe(409);
    expect(response.error?.details).toMatchObject({ reason: 'golden_set_frozen' });
  });

  it('refuses a save against a hash that has moved', async () => {
    const { contentHash, prompts } = await view();
    const [first, second] = prompts;
    await editor.updateGoldenPrompt(first.key, { ...first, probe: 'One' }, contentHash!);

    await expect(
      editor.updateGoldenPrompt(second.key, { ...second, probe: 'Two' }, contentHash!)
    ).rejects.toMatchObject({ status: 409, details: { reason: 'revision_moved' } });
  });
});

describe('the kinds of moment', () => {
  it('refuses to remove the only prompt of a kind', async () => {
    const { contentHash, prompts } = await view();
    const greeting = prompts.filter((prompt) => prompt.kind === 'greeting');
    expect(greeting).toHaveLength(1);

    await expect(editor.deleteGoldenPrompt(greeting[0].key, contentHash!)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'kind_uncovered', missing: ['greeting'] },
    });
  });

  it('removes one of several of a kind', async () => {
    const { contentHash, prompts } = await view();
    const refusal = prompts.find((prompt) => prompt.kind === 'refusal')!;

    await editor.deleteGoldenPrompt(refusal.key, contentHash!);

    const after = await view();
    expect(after.prompts.map((prompt) => prompt.key)).not.toContain(refusal.key);
    expect(db.current!.rows('aiDataset')[0]?.caseCount).toBe(prompts.length - 1);
    // Positions stay contiguous from 0, the shape the seed and the hash assume.
    expect(
      db
        .current!.rows('aiDatasetCase')
        .map((row) => row.position)
        .sort((a, b) => (a as number) - (b as number))
    ).toEqual(Array.from({ length: prompts.length - 1 }, (_, index) => index));
  });
});

describe('starting a new version', () => {
  it('copies the frozen prompts into the next version, points the install at it, and lets it be edited', async () => {
    runIt();
    const before = await view();
    expect(before.nextVersion).not.toBe(VERSION);

    const response = await call(
      newVersion(req('POST', '/versions', { revision: before.pointer!.revision }))
    );

    expect(response.status).toBe(201);
    const after = await view();
    expect(after.pointer?.version).toBe(before.nextVersion);
    expect(after.frozen).toBe(false);
    expect(after.prompts).toEqual(before.prompts);
    expect(after.contentHash).toBe(before.contentHash);
    // The old version and what was asked of it are untouched.
    expect(
      db.current!.rows('aiDatasetCase').filter((row) => row.datasetId === DATASET)
    ).toHaveLength(before.prompts.length);
    expect(db.current!.rows('aiEvaluationRun')).toEqual([
      expect.objectContaining({ datasetId: DATASET }),
    ]);

    const first = after.prompts[0];
    await expect(
      editor.updateGoldenPrompt(
        first.key,
        { ...first, probe: 'Now it can change' },
        after.contentHash!
      )
    ).resolves.toMatchObject({ changed: ['probe'], version: before.nextVersion });
  });

  it('names the version in the dataset the way the seed does', async () => {
    const { pointer } = await view();
    const { to } = await editor.startNewGoldenSetVersion(pointer!.revision, EDITOR);

    const created = db
      .current!.rows('aiDataset')
      .find((row) => row.id === goldenSetDatasetId(to, INSTALL_ORG_ID));
    expect(created?.name).toBe(`${goldenSet.dataset.name} v${to}`);
  });

  it('refuses a second press from a page that read the old pointer', async () => {
    const { pointer } = await view();
    await editor.startNewGoldenSetVersion(pointer!.revision, EDITOR);

    await expect(editor.startNewGoldenSetVersion(pointer!.revision, EDITOR)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('skips a version whose dataset already exists', () => {
    expect(editor.nextGoldenSetVersion('1.1', new Set(['1.1', '1.2']))).toBe('1.3');
    expect(editor.nextGoldenSetVersion('1.1.4', new Set())).toBe('1.2');
  });
});

describe('the file round-trip', () => {
  it('plans no writes when a fresh export is imported', async () => {
    const file = await editor.exportGoldenSetFile();
    const before = db.current!.fingerprint();

    const preview = await editor.previewGoldenSetImport(file, false);
    const applied = await editor.applyGoldenSetImport(file, false, EDITOR);

    expect(preview).toMatchObject({ writesNothing: true, refusals: [] });
    expect(applied.writesNothing).toBe(true);
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('plans no writes for a fresh export of a frozen version either', async () => {
    runIt();
    const file = await editor.exportGoldenSetFile();

    expect(await editor.previewGoldenSetImport(file, true)).toMatchObject({
      writesNothing: true,
      refusals: [],
    });
  });

  it('refuses a changed prompt against a frozen version, naming the remedy', async () => {
    runIt();
    const file = await editor.exportGoldenSetFile();
    const changed = {
      ...file,
      prompts: file.prompts.map((p, i) => (i === 0 ? { ...p, prompt: 'Something new' } : p)),
    };

    const preview = await editor.previewGoldenSetImport(changed, false);
    expect(preview.refusals.join(' ')).toMatch(/Start a new version/);
  });

  it('keeps a prompt the file leaves out, unless asked to remove it', async () => {
    const file = await editor.exportGoldenSetFile();
    const leftOut = file.prompts.find((p) => p.kind === 'refusal')!;
    const without = { ...file, prompts: file.prompts.filter((p) => p.key !== leftOut.key) };

    const kept = await editor.previewGoldenSetImport(without, false);
    expect(kept.sections.find((s) => s.entity === 'prompt')?.kept).toEqual([leftOut.key]);

    await editor.applyGoldenSetImport(without, true, EDITOR);
    expect((await view()).prompts.map((p) => p.key)).not.toContain(leftOut.key);
  });

  it('refuses a file that changes the control, which the seed owns', async () => {
    const file = await editor.exportGoldenSetFile();
    const changed = {
      ...file,
      control: { ...file.control, systemInstructions: 'Speak in her voice.' },
    };

    const preview = await editor.previewGoldenSetImport(changed, false);
    expect(preview.refusals.join(' ')).toMatch(/control agent/);
  });

  it('refuses a file for another version', async () => {
    const file = await editor.exportGoldenSetFile();
    const other = { ...file, goldenSet: { ...file.goldenSet, version: '9.0' } };

    const preview = await editor.previewGoldenSetImport(other, false);
    expect(preview.refusals.join(' ')).toMatch(/v9\.0/);
  });
});

describe('a stored case that is not the shape the seed writes', () => {
  /** Break the first case's metadata so `promptOf` can no longer read it as a prompt. */
  async function breakFirstCase() {
    await stored().aiDatasetCase.update({
      where: { id: 'case-0' },
      data: { metadata: Prisma.DbNull },
    });
  }

  it('is reported as malformed, not shown as a prompt', async () => {
    await breakFirstCase();

    const after = await view();

    expect(after.malformed).toEqual([0]);
    expect(after.prompts.map((p) => p.key)).not.toContain('first-hello');
    expect(after.prompts).toHaveLength(goldenSet.prompts.length - 1);
  });

  it('blocks every prompt edit until an import repairs it', async () => {
    const { contentHash, prompts } = await view();
    await breakFirstCase();

    await expect(
      editor.updateGoldenPrompt(prompts[1].key, { ...prompts[1], probe: 'Changed' }, contentHash!)
    ).rejects.toMatchObject({ status: 409, details: { reason: 'malformed' } });
  });

  it('cannot be written as a file: exporting is refused rather than writing a broken one', async () => {
    await breakFirstCase();

    await expect(editor.exportGoldenSetFile()).rejects.toMatchObject({
      status: 409,
      details: { reason: 'unexportable' },
    });
  });

  it('is carried into a new version rather than dropped, since it is copied as stored', async () => {
    await breakFirstCase();
    const { pointer } = await view();

    const { to } = await editor.startNewGoldenSetVersion(pointer!.revision, EDITOR);

    const copied = db
      .current!.rows('aiDatasetCase')
      .filter((row) => row.datasetId === goldenSetDatasetId(to, INSTALL_ORG_ID));
    const carried = copied.find((row) => row.position === 0);
    expect(carried?.metadata).toEqual({});
  });

  it('is reported in an import plan so applying the import repairs it', async () => {
    const file = await editor.exportGoldenSetFile();
    const cases = db.current!.rows('aiDatasetCase').filter((row) => row.datasetId === DATASET);
    await stored().aiDatasetCase.update({
      where: { id: String(cases[0].id) },
      data: { metadata: Prisma.DbNull },
    });
    await stored().aiDatasetCase.update({
      where: { id: String(cases[1].id) },
      data: { metadata: Prisma.DbNull },
    });

    const preview = await editor.previewGoldenSetImport(file, false);

    const section = preview.sections.find((s) => s.entity === 'prompt')!;
    expect(section.updates.map((u) => u.key)).toContain('2 malformed stored cases');
    expect(preview.writesNothing).toBe(false);
  });
});

describe('an unseeded database', () => {
  it('reports itself plainly, with nothing to edit', async () => {
    db.current = createContentDbFake();

    expect(await view()).toEqual({
      seeded: false,
      pointer: null,
      datasetId: null,
      contentHash: null,
      runCount: 0,
      frozen: false,
      prompts: [],
      malformed: [],
      nextVersion: null,
    });
  });

  it('refuses every write to the golden set', async () => {
    db.current = createContentDbFake();
    const hash = '0'.repeat(64);

    await expect(
      editor.updateGoldenPrompt('x', { kind: 'greeting', probe: 'p', prompt: 'q' }, hash)
    ).rejects.toMatchObject({ status: 409, details: { reason: 'not_seeded' } });
    await expect(
      editor.createGoldenPrompt({ key: 'x', kind: 'greeting', probe: 'p', prompt: 'q' }, hash)
    ).rejects.toMatchObject({ status: 409, details: { reason: 'not_seeded' } });
    await expect(editor.deleteGoldenPrompt('x', hash)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'not_seeded' },
    });
    await expect(editor.startNewGoldenSetVersion(1, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'not_seeded' },
    });
    await expect(editor.exportGoldenSetFile()).rejects.toMatchObject({
      status: 409,
      details: { reason: 'nothing_to_export' },
    });
  });

  it('plans an import as a refusal', async () => {
    const file = await editor.exportGoldenSetFile();
    db.current = createContentDbFake();

    const preview = await editor.previewGoldenSetImport(file, false);

    expect(preview.refusals.join(' ')).toMatch(/has not been seeded/);
    expect(preview.refusals.length).toBeGreaterThan(0);
  });
});

describe('more edits to a prompt', () => {
  it('names the run count in its own words when the golden set has run more than once', async () => {
    db.current!.insert('aiEvaluationRun', { datasetId: DATASET });
    db.current!.insert('aiEvaluationRun', { datasetId: DATASET });
    const { contentHash, prompts } = await view();

    let error: unknown;
    try {
      await editor.updateGoldenPrompt(
        prompts[0].key,
        { ...prompts[0], probe: 'Changed' },
        contentHash!
      );
    } catch (err) {
      error = err;
    }

    expect(error).toMatchObject({
      status: 409,
      details: { reason: 'golden_set_frozen', runCount: 2 },
    });
    expect((error as Error).message).toMatch(/run 2 times/);
  });

  it('writes nothing, not even a new hash, when a save changes no field', async () => {
    const { contentHash, prompts } = await view();
    const first = prompts[0];
    const before = db.current!.fingerprint();

    const result = await editor.updateGoldenPrompt(
      first.key,
      { kind: first.kind, probe: first.probe, prompt: first.prompt },
      contentHash!
    );

    expect(result.changed).toEqual([]);
    expect(result.changes).toEqual({});
    expect(result.contentHash).toBe(contentHash);
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('refuses to update or delete a prompt key that does not exist', async () => {
    const { contentHash } = await view();

    await expect(
      editor.updateGoldenPrompt(
        'nowhere',
        { kind: 'greeting', probe: 'x', prompt: 'y' },
        contentHash!
      )
    ).rejects.toMatchObject({ status: 404 });
    await expect(editor.deleteGoldenPrompt('nowhere', contentHash!)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('adding a prompt directly', () => {
  it('adds a new prompt at the end, and re-pins the dataset hash and count', async () => {
    const { contentHash, prompts } = await view();

    const created = await editor.createGoldenPrompt(
      {
        key: 'asked-for-a-hug',
        kind: 'decline',
        probe: 'Whether the reply declines physical affection kindly.',
        prompt: 'Can I get a hug?',
      },
      contentHash!
    );

    expect(created.changed).toEqual(['created']);
    expect(created.contentHash).not.toBe(contentHash);
    const after = await view();
    expect(after.prompts.at(-1)).toMatchObject({ key: 'asked-for-a-hug', kind: 'decline' });
    expect(after.prompts).toHaveLength(prompts.length + 1);
    expect(db.current!.rows('aiDataset')[0]?.caseCount).toBe(prompts.length + 1);
  });

  it('refuses a key that is already taken', async () => {
    const { contentHash, prompts } = await view();

    await expect(
      editor.createGoldenPrompt(
        { key: prompts[0].key, kind: prompts[0].kind, probe: 'x', prompt: 'y' },
        contentHash!
      )
    ).rejects.toMatchObject({ status: 409, details: { reason: 'exists' } });
  });
});

describe('the dataset name', () => {
  it('is left alone when it does not carry the version suffix', async () => {
    await stored().aiDataset.update({
      where: { id: DATASET },
      data: { name: 'Golden set, unversioned' },
    });

    const file = await editor.exportGoldenSetFile();

    expect(file.dataset.name).toBe('Golden set, unversioned');
  });
});

describe('exporting without a control agent', () => {
  it('refuses to export, since the file cannot say what the bare arm is', async () => {
    await stored().aiAgent.delete({ where: { id: 'control' } });

    await expect(editor.exportGoldenSetFile()).rejects.toMatchObject({
      status: 409,
      details: { reason: 'unexportable' },
    });
  });
});

describe('an import that changes the pointer or adds a prompt', () => {
  it('refuses a file for another golden set', async () => {
    const file = await editor.exportGoldenSetFile();
    const other = { ...file, goldenSet: { ...file.goldenSet, id: 'someone_elses_set' } };

    const preview = await editor.previewGoldenSetImport(other, false);

    expect(preview.refusals.join(' ')).toMatch(/someone_elses_set/);
  });

  it('refuses a file that changes the dataset’s name, description or tags', async () => {
    const file = await editor.exportGoldenSetFile();
    const changed = {
      ...file,
      dataset: { ...file.dataset, description: 'A different description' },
    };

    const preview = await editor.previewGoldenSetImport(changed, false);

    expect(preview.refusals.join(' ')).toMatch(/name, description or tags/);
  });

  it('stages the set’s title and provenance as their own section when a file changes them', async () => {
    const file = await editor.exportGoldenSetFile();
    const changed = { ...file, goldenSet: { ...file.goldenSet, title: 'A retitled golden set' } };

    const preview = await editor.previewGoldenSetImport(changed, false);

    expect(preview.sections[0]).toMatchObject({
      entity: 'set',
      updates: [{ changedFields: ['title'] }],
    });
  });

  it('refuses to apply an import whose plan carries refusals', async () => {
    const file = await editor.exportGoldenSetFile();
    const other = { ...file, goldenSet: { ...file.goldenSet, version: '9.0' } };

    await expect(editor.applyGoldenSetImport(other, false, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'import_refused' },
    });
  });

  it('applies a title-only change: writes the pointer and its revision, and leaves the prompts untouched', async () => {
    const before = await view();
    const file = await editor.exportGoldenSetFile();
    const changed = { ...file, goldenSet: { ...file.goldenSet, title: 'A retitled golden set' } };

    const plan = await editor.applyGoldenSetImport(changed, false, EDITOR);

    expect(plan.writesNothing).toBe(false);
    const after = await view();
    expect(after.pointer?.title).toBe('A retitled golden set');
    expect(after.pointer?.revision).toBe(before.pointer!.revision + 1);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.prompts).toEqual(before.prompts);
  });

  it('creates a new prompt from an import that adds a key the store does not have', async () => {
    const file = await editor.exportGoldenSetFile();
    const withNew = {
      ...file,
      prompts: [
        ...file.prompts,
        {
          key: 'asked-for-a-hug',
          kind: 'decline' as const,
          probe: 'Whether the reply declines warmly.',
          prompt: 'Can I get a hug?',
        },
      ],
    };

    await editor.applyGoldenSetImport(withNew, false, EDITOR);

    expect((await view()).prompts.map((p) => p.key)).toContain('asked-for-a-hug');
  });
});

describe('goldenSetExportFilename', () => {
  it('names the export file by the date', () => {
    expect(editor.goldenSetExportFilename(new Date('2026-03-04T12:00:00Z'))).toBe(
      'lelanea-voice-golden-set-2026-03-04.json'
    );
  });
});
