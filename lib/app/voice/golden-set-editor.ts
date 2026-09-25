/**
 * The golden set, edited in the admin (f-content-seeds t-92): its prompts and
 * what each tests, a new version when the current one is frozen, and the file
 * round-trip.
 *
 * ## Where the words live
 *
 * The prompts are the platform's `AiDatasetCase` rows under
 * `goldenSetDatasetId(pointer.version)`, with `key`, `kind` and `probe` in each
 * case's `metadata` — the shape seed 004 writes, kept exactly so the dataset's
 * `contentHash` means the same thing whoever wrote it. Every write here
 * recomputes that hash and the case count, because a comparison records the
 * hash it asked (`AppVoiceComparison.datasetContentHash`) and the evaluation
 * worker re-hashes on claim.
 *
 * **The hash is also the lock.** A case has no revision column, and "the
 * prompts as the admin read them" is exactly what `contentHash` fingerprints,
 * so a save names the hash it read and a stale form is refused 409.
 *
 * ## The freeze, and its remedy (`HB10`)
 *
 * A version something has run is frozen: a scored case cannot be deleted
 * (`AiEvaluationCaseResult` restricts it), and rewording one would re-caption
 * every stored answer with a question it was never asked. So an edit to a
 * frozen version is refused with the reason, and {@link startNewGoldenSetVersion}
 * is the way on — the owner's ruling, 2026-09-24: it copies the prompts into
 * the next version's dataset and points the install at it, leaving the old
 * version and its comparisons as they were.
 *
 * ## What is not edited here
 *
 * The dataset's name, description and tags, and the control agent's
 * instructions, are reconciled from the seed file by seed 004 on every run. An
 * import whose file changes them is refused with that reason rather than
 * written and then undone by the next seed.
 *
 * @see lib/app/voice/golden-set.ts — the dataset id and the case shape
 * @see prisma/seeds/app-lelanea/004-voice-golden-set.ts — the first write
 */

import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import {
  GOLDEN_SET_REQUIRED_KINDS,
  voiceGoldenSetFileSchema,
  type GoldenSetKind,
  type VoiceGoldenSetFile,
} from '@/lib/app/content/schemas';
import { VOICE_GOLDEN_SET_ID } from '@/lib/app/content/golden-set-store';
import {
  storedProvenanceSchema,
  type VoiceContentStatus,
  type VoiceProvenance,
} from '@/lib/app/content/voice-overlay-view';
import {
  changedFieldsOf,
  planKeyedImport,
  stableJson,
  type KeyedPlan,
} from '@/lib/app/content/admin/keyed-import';
import {
  importRefused,
  parseContentFile,
  revisionMoved,
  sectionsWriteNothing,
  toPlanSection,
  type ContentImportPlan,
  type ImportPlanSection,
} from '@/lib/app/content/admin/shared';
import { goldenSetDatasetId, VOICE_CONTROL_AGENT_SLUG } from '@/lib/app/voice/golden-set';
import { hashDatasetCases } from '@/lib/orchestration/evaluations/datasets/hash';
import type { GoldenPromptEdit } from '@/lib/validations/app-voice-content';

type Tx = Parameters<Parameters<typeof executeTransaction>[0]>[0];
type Client = Pick<
  typeof prisma,
  'appVoiceGoldenSet' | 'aiDataset' | 'aiDatasetCase' | 'aiEvaluationRun' | 'aiAgent'
>;

// ─── Shapes ─────────────────────────────────────────────────────────────────

/** One prompt as stored: what it asks, what kind of moment, what it tests. */
export interface GoldenPrompt {
  key: string;
  kind: GoldenSetKind;
  probe: string;
  prompt: string;
}

export interface GoldenSetEditorView {
  seeded: boolean;
  pointer: {
    title: string;
    version: string;
    locale: string;
    provenance: VoiceProvenance;
    status: VoiceContentStatus;
    revision: number;
  } | null;
  datasetId: string | null;
  /** The lock a save names. Null when the current version has no dataset in this install. */
  contentHash: string | null;
  /** How many evaluation runs have asked this version. Any at all freezes it. */
  runCount: number;
  frozen: boolean;
  prompts: GoldenPrompt[];
  /** A case whose metadata or input is not the shape the seed writes. Editing is refused until an import repairs it. */
  malformed: number[];
  /** The version "Start a new version" would create. */
  nextVersion: string | null;
}

const kindSchema = z.enum(GOLDEN_SET_REQUIRED_KINDS);
const caseMetadataSchema = z.object({
  key: z.string().min(1),
  kind: kindSchema,
  probe: z.string(),
});

interface CaseRow {
  position: number;
  input: unknown;
  metadata: unknown;
}

/** A stored case as a prompt, or null when it is not the shape the seed writes. */
function promptOf(row: CaseRow): GoldenPrompt | null {
  const metadata = caseMetadataSchema.safeParse(row.metadata);
  if (!metadata.success || typeof row.input !== 'string') return null;
  return {
    key: metadata.data.key,
    kind: metadata.data.kind,
    probe: metadata.data.probe,
    prompt: row.input,
  };
}

/** Prompts as dataset cases, in the seed's exact shape: 0-based positions, metadata `{ key, kind, probe }`. */
function toCases(prompts: readonly GoldenPrompt[]) {
  return prompts.map((prompt, position) => ({
    position,
    input: prompt.prompt satisfies Prisma.InputJsonValue,
    metadata: { key: prompt.key, kind: prompt.kind, probe: prompt.probe },
  }));
}

export function hashPrompts(prompts: readonly GoldenPrompt[]): string {
  return hashDatasetCases(toCases(prompts));
}

/**
 * The next version after `version` that has no dataset yet: the minor number
 * bumped, any patch dropped (`1.1` → `1.2`, `1.1.3` → `1.2`).
 */
export function nextGoldenSetVersion(version: string, taken: ReadonlySet<string>): string {
  const [major = '1', minor = '0'] = version.split('.');
  let next = Number(minor) + 1;
  while (taken.has(`${major}.${next}`)) next += 1;
  return `${major}.${next}`;
}

/** The dataset's name without the version the seed appends to it. */
function baseDatasetName(name: string, version: string): string {
  const suffix = ` v${version}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

function frozenRefusal(version: string, runCount: number): ConflictError {
  return new ConflictError(
    `The golden set v${version} has been run ${runCount === 1 ? 'once' : `${runCount} times`}, so its prompts are locked: every stored answer is only readable beside the question that produced it. Start a new version to change them; this one and its comparisons stay as they are.`,
    { reason: 'golden_set_frozen', runCount }
  );
}

function hashMoved(): ConflictError {
  return new ConflictError(
    'The golden set was changed by someone else since you opened it. Reload and read it again before saving.',
    { reason: 'revision_moved' }
  );
}

function notSeeded(): ConflictError {
  return new ConflictError(
    'The golden set has not been seeded in this install, so there is nothing to edit. Run `npm run db:seed`.',
    { reason: 'not_seeded' }
  );
}

/** Refuse a set that no longer covers every required kind — the seed file's own rule. */
function assertCoverage(prompts: readonly GoldenPrompt[]): void {
  const covered = new Set(prompts.map((prompt) => prompt.kind));
  const missing = GOLDEN_SET_REQUIRED_KINDS.filter((kind) => !covered.has(kind));
  if (missing.length > 0) {
    throw new ConflictError(
      `The golden set must keep a prompt for every kind of moment, and this would leave none for: ${missing.join(', ')}. Add one of that kind first.`,
      { reason: 'kind_uncovered', missing }
    );
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

async function readCurrent(client: Client) {
  const pointer = await client.appVoiceGoldenSet.findUnique({ where: { id: VOICE_GOLDEN_SET_ID } });
  if (!pointer) return null;
  const datasetId = goldenSetDatasetId(pointer.version);
  const [dataset, cases, runCount] = await Promise.all([
    client.aiDataset.findUnique({ where: { id: datasetId } }),
    client.aiDatasetCase.findMany({
      where: { datasetId },
      orderBy: { position: 'asc' },
      select: { position: true, input: true, metadata: true },
    }),
    client.aiEvaluationRun.count({ where: { datasetId } }),
  ]);
  return { pointer, datasetId, dataset, cases, runCount };
}

/** The current version and its prompts, as the editor shows them. */
export async function getGoldenSetEditorView(): Promise<GoldenSetEditorView> {
  const current = await readCurrent(prisma);
  if (!current) {
    return {
      seeded: false,
      pointer: null,
      datasetId: null,
      contentHash: null,
      runCount: 0,
      frozen: false,
      prompts: [],
      malformed: [],
      nextVersion: null,
    };
  }
  const { pointer, datasetId, dataset, cases, runCount } = current;
  const provenance = storedProvenanceSchema.parse(pointer.provenance);
  const prompts: GoldenPrompt[] = [];
  const malformed: number[] = [];
  for (const row of cases) {
    const prompt = promptOf(row);
    if (prompt) prompts.push(prompt);
    else malformed.push(row.position);
  }
  const versions = await prisma.aiDataset.findMany({
    where: { id: { startsWith: goldenSetDatasetId('') } },
    select: { id: true },
  });
  const taken = new Set(versions.map((row) => row.id.slice(goldenSetDatasetId('').length)));
  return {
    seeded: dataset !== null,
    pointer: {
      title: pointer.title,
      version: pointer.version,
      locale: pointer.locale,
      provenance,
      status: pointer.status,
      revision: pointer.revision,
    },
    datasetId,
    contentHash: dataset?.contentHash ?? null,
    runCount,
    frozen: runCount > 0,
    prompts,
    malformed,
    nextVersion: dataset ? nextGoldenSetVersion(pointer.version, taken) : null,
  };
}

// ─── Writes to the prompts ──────────────────────────────────────────────────

/**
 * Read the current version for a write: seeded, not frozen, not malformed, and
 * at the hash the admin read.
 */
async function openForEdit(tx: Tx, hashRead: string) {
  const current = await readCurrent(tx);
  if (!current?.dataset) throw notSeeded();
  if (current.runCount > 0) throw frozenRefusal(current.pointer.version, current.runCount);
  if (current.dataset.contentHash !== hashRead) throw hashMoved();
  const prompts = current.cases.map(promptOf);
  if (prompts.some((prompt) => prompt === null)) {
    throw new ConflictError(
      'A stored prompt is not in the shape the seed writes, so the set cannot be edited prompt by prompt. Import a file to repair it.',
      { reason: 'malformed' }
    );
  }
  return { ...current, dataset: current.dataset, prompts: prompts as GoldenPrompt[] };
}

/** Replace the version's cases with these prompts, and re-pin its hash and count. */
async function writePrompts(
  tx: Tx,
  datasetId: string,
  prompts: readonly GoldenPrompt[]
): Promise<string> {
  const contentHash = hashPrompts(prompts);
  await tx.aiDatasetCase.deleteMany({ where: { datasetId } });
  await tx.aiDatasetCase.createMany({
    data: toCases(prompts).map((row) => ({ datasetId, ...row })),
  });
  await tx.aiDataset.update({
    where: { id: datasetId },
    data: { caseCount: prompts.length, contentHash },
  });
  return contentHash;
}

export interface GoldenPromptWriteResult {
  changed: string[];
  changes: Record<string, { from: unknown; to: unknown }>;
  contentHash: string;
  version: string;
}

const PROMPT_FIELDS = ['kind', 'probe', 'prompt'] as const;

/** Save one prompt's words. Its key and place stay. */
export async function updateGoldenPrompt(
  key: string,
  edit: GoldenPromptEdit,
  hashRead: string
): Promise<GoldenPromptWriteResult> {
  return executeTransaction(async (tx) => {
    const current = await openForEdit(tx, hashRead);
    const index = current.prompts.findIndex((prompt) => prompt.key === key);
    if (index === -1) throw new NotFoundError(`The golden set has no prompt "${key}".`);
    const before = current.prompts[index];
    const after: GoldenPrompt = { key, ...edit };
    const changed = changedFieldsOf(before, after, PROMPT_FIELDS);
    if (changed.length === 0) {
      return { changed, changes: {}, contentHash: hashRead, version: current.pointer.version };
    }
    const next = current.prompts.map((prompt, i) => (i === index ? after : prompt));
    assertCoverage(next);
    const contentHash = await writePrompts(tx, current.datasetId, next);
    return {
      changed,
      changes: Object.fromEntries(
        changed.map((field) => [field, { from: before[field], to: after[field] }])
      ),
      contentHash,
      version: current.pointer.version,
    };
  });
}

/** Add a prompt at the end. 409 when the key is taken. */
export async function createGoldenPrompt(
  prompt: GoldenPrompt,
  hashRead: string
): Promise<GoldenPromptWriteResult> {
  return executeTransaction(async (tx) => {
    const current = await openForEdit(tx, hashRead);
    if (current.prompts.some((existing) => existing.key === prompt.key)) {
      throw new ConflictError(`There is already a prompt "${prompt.key}". Edit that one instead.`, {
        reason: 'exists',
      });
    }
    const contentHash = await writePrompts(tx, current.datasetId, [...current.prompts, prompt]);
    return {
      changed: ['created'],
      changes: { prompt: { from: null, to: prompt } },
      contentHash,
      version: current.pointer.version,
    };
  });
}

/** Remove a prompt. Refused while it is the only one of its kind. */
export async function deleteGoldenPrompt(
  key: string,
  hashRead: string
): Promise<GoldenPromptWriteResult> {
  return executeTransaction(async (tx) => {
    const current = await openForEdit(tx, hashRead);
    const removed = current.prompts.find((prompt) => prompt.key === key);
    if (!removed) throw new NotFoundError(`The golden set has no prompt "${key}".`);
    const next = current.prompts.filter((prompt) => prompt.key !== key);
    assertCoverage(next);
    const contentHash = await writePrompts(tx, current.datasetId, next);
    return {
      changed: ['deleted'],
      changes: { prompt: { from: removed, to: null } },
      contentHash,
      version: current.pointer.version,
    };
  });
}

// ─── A new version ──────────────────────────────────────────────────────────

/**
 * Copy the current version's prompts into the next version's dataset and point
 * the install at it. The old version, its cases and every comparison that asked
 * it stay exactly as they were; the new one is editable until something runs it.
 *
 * Named on the pointer's revision, so two admins pressing it at once mint one
 * version rather than two.
 */
export async function startNewGoldenSetVersion(
  revisionRead: number,
  editorId: string
): Promise<{ from: string; to: string; revision: number; contentHash: string }> {
  return executeTransaction(async (tx) => {
    const current = await readCurrent(tx);
    if (!current?.dataset) throw notSeeded();
    const { pointer, dataset } = current;
    if (pointer.revision !== revisionRead)
      throw revisionMoved('The golden set', pointer.revision, revisionRead);

    const prefix = goldenSetDatasetId('');
    const existing = await tx.aiDataset.findMany({
      where: { id: { startsWith: prefix } },
      select: { id: true },
    });
    const version = nextGoldenSetVersion(
      pointer.version,
      new Set(existing.map((row) => row.id.slice(prefix.length)))
    );
    const datasetId = goldenSetDatasetId(version);

    // Copied as stored, so a case this editor could not parse is carried over
    // rather than dropped: the new version asks exactly what the old one did.
    const cases = current.cases.map((row) => ({
      position: row.position,
      input: row.input as Prisma.InputJsonValue,
      metadata: row.metadata ?? {},
    }));
    const contentHash = hashDatasetCases(cases);
    await tx.aiDataset.create({
      data: {
        id: datasetId,
        userId: null,
        name: `${baseDatasetName(dataset.name, pointer.version)} v${version}`,
        description: dataset.description,
        tags: [...dataset.tags],
        caseCount: cases.length,
        contentHash,
        source: 'manual',
        cases: { create: cases },
      },
    });

    const revision = pointer.revision + 1;
    const { count } = await tx.appVoiceGoldenSet.updateMany({
      where: { id: VOICE_GOLDEN_SET_ID, revision: revisionRead },
      data: { version, status: 'draft', signedOffAt: null, revision },
    });
    if (count === 0) throw revisionMoved('The golden set', revision, revisionRead);
    await tx.appVoiceGoldenSetRevision.create({
      data: {
        setId: VOICE_GOLDEN_SET_ID,
        revision,
        title: pointer.title,
        version,
        locale: pointer.locale,
        provenance: storedProvenanceSchema.parse(pointer.provenance),
        status: 'draft',
        changedFields: pointer.status === 'draft' ? ['version'] : ['version', 'status'],
        origin: 'admin',
        editorId,
      },
    });
    return { from: pointer.version, to: version, revision, contentHash };
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

export function goldenSetExportFilename(now: Date): string {
  return `lelanea-voice-golden-set-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * The current version as the seed's file. The dataset's words and the
 * control's come from their rows; the file's working notes are left out rather
 * than invented. Parsed with the seed's schema before it is handed out.
 */
export async function exportGoldenSetFile(): Promise<VoiceGoldenSetFile> {
  const current = await readCurrent(prisma);
  if (!current?.dataset) {
    throw new ConflictError('There is nothing to export: the golden set has not been seeded.', {
      reason: 'nothing_to_export',
    });
  }
  const control = await prisma.aiAgent.findUnique({
    where: { slug: VOICE_CONTROL_AGENT_SLUG },
    select: { name: true, description: true, systemInstructions: true },
  });
  const { pointer, dataset } = current;
  const file = {
    goldenSet: {
      id: pointer.id,
      title: pointer.title,
      layer: 'golden-set',
      version: pointer.version,
      locale: pointer.locale,
      provenance: pointer.provenance,
    },
    dataset: {
      name: baseDatasetName(dataset.name, pointer.version),
      description: dataset.description ?? '',
      tags: [...dataset.tags],
    },
    control: {
      name: control?.name ?? '',
      description: control?.description ?? '',
      systemInstructions: control?.systemInstructions ?? '',
    },
    prompts: current.cases.map((row) => {
      const prompt = promptOf(row);
      return prompt
        ? { key: prompt.key, kind: prompt.kind, probe: prompt.probe, prompt: prompt.prompt }
        : { position: row.position };
    }),
  };
  const parsed = voiceGoldenSetFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new ConflictError(
      `The stored golden set cannot be written as a file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
        .join('; ')}.`,
      { reason: 'unexportable' }
    );
  }
  return parsed.data;
}

// ─── Import ─────────────────────────────────────────────────────────────────

type PromptFields = Omit<GoldenPrompt, 'key'> & { position: number };
const PROMPT_PLAN_FIELDS = ['position', 'kind', 'probe', 'prompt'] as const;
const POINTER_FIELDS = ['title', 'locale', 'provenance'] as const;

type Current = NonNullable<Awaited<ReturnType<typeof readCurrent>>>;
interface StoredGoldenSet {
  current: Current | null;
  control: { name: string; description: string | null; systemInstructions: string } | null;
}

interface GoldenSetImport {
  plan: ContentImportPlan;
  pointerChanged: (typeof POINTER_FIELDS)[number][];
  prompts: KeyedPlan<PromptFields>;
  /** The whole set after the import, in order. */
  after: GoldenPrompt[];
}

/**
 * What a golden set file would do. Pure.
 *
 * It applies to the version the install is on, and only that one. The prompts
 * are planned by key; one the file leaves out is kept, after the file's own,
 * unless `removeAbsent` asks for it to go. A frozen version refuses any change
 * to its prompts, with the remedy.
 */
export function planGoldenSetImport(
  file: VoiceGoldenSetFile,
  stored: StoredGoldenSet,
  removeAbsent: boolean
): GoldenSetImport {
  const refusals: string[] = [];
  const current = stored.current;
  if (!current?.dataset) {
    refusals.push('The golden set has not been seeded, so there is nothing to import into.');
  } else {
    if (file.goldenSet.id !== current.pointer.id) {
      refusals.push(
        `This file is for the set "${file.goldenSet.id}", and this install holds "${current.pointer.id}".`
      );
    }
    if (file.goldenSet.version !== current.pointer.version) {
      refusals.push(
        `This file is v${file.goldenSet.version}, and this install asks v${current.pointer.version}. An import changes the version the install is on; export again, or start a new version first and change the file's version to match.`
      );
    }
    const dataset = current.dataset;
    if (
      file.dataset.name !== baseDatasetName(dataset.name, current.pointer.version) ||
      file.dataset.description !== (dataset.description ?? '') ||
      stableJson(file.dataset.tags) !== stableJson(dataset.tags)
    ) {
      refusals.push(
        'The file changes the dataset’s name, description or tags. Those are written by the seed from seed-data/drafted/lelanea_voice_golden_set.json; change them there.'
      );
    }
    if (
      stored.control &&
      (file.control.name !== stored.control.name ||
        file.control.description !== (stored.control.description ?? '') ||
        file.control.systemInstructions !== stored.control.systemInstructions)
    ) {
      refusals.push(
        'The file changes the control agent. It is written by the seed from seed-data/drafted/lelanea_voice_golden_set.json on every run, so an edit here would be undone; change it there.'
      );
    }
  }

  const storedPrompts = (current?.cases ?? [])
    .map(promptOf)
    .filter((prompt): prompt is GoldenPrompt => prompt !== null);
  const malformed = (current?.cases.length ?? 0) - storedPrompts.length;
  const inFile = new Set(file.prompts.map((prompt) => prompt.key));
  const kept = removeAbsent ? [] : storedPrompts.filter((prompt) => !inFile.has(prompt.key));
  const after: GoldenPrompt[] = [
    ...file.prompts.map(({ key, kind, probe, prompt }) => ({ key, kind, probe, prompt })),
    ...kept,
  ];
  const fieldsAt = (prompt: GoldenPrompt, position: number): PromptFields => ({
    position,
    kind: prompt.kind,
    probe: prompt.probe,
    prompt: prompt.prompt,
  });

  const prompts = planKeyedImport<PromptFields, PromptFields>({
    incoming: after.map((prompt, position) => ({
      key: prompt.key,
      value: fieldsAt(prompt, position),
    })),
    stored: storedPrompts.map((prompt) => ({
      key: prompt.key,
      fields: fieldsAt(
        prompt,
        current!.cases.findIndex((row) => promptOf(row)?.key === prompt.key)
      ),
      revision: 0,
    })),
    diff: (before, next) => changedFieldsOf(before, next, PROMPT_PLAN_FIELDS),
    allFields: PROMPT_PLAN_FIELDS,
    toCreate: (value) => value,
    toUpdate: (_before, value) => value,
    onAbsent: removeAbsent ? () => null : 'keep',
  });

  // A malformed stored case has no key to plan by, so it is always rewritten.
  const promptsChange =
    malformed > 0 || prompts.creates.length + prompts.updates.length + prompts.removals.length > 0;
  if (current?.dataset && current.runCount > 0 && promptsChange) {
    refusals.push(frozenRefusal(current.pointer.version, current.runCount).message);
  }

  let pointerChanged: GoldenSetImport['pointerChanged'] = [];
  if (current) {
    pointerChanged = changedFieldsOf(
      {
        title: current.pointer.title,
        locale: current.pointer.locale,
        provenance: storedProvenanceSchema.parse(current.pointer.provenance),
      },
      {
        title: file.goldenSet.title,
        locale: file.goldenSet.locale,
        provenance: file.goldenSet.provenance,
      },
      POINTER_FIELDS
    );
  }

  const promptSection: ImportPlanSection = {
    ...toPlanSection('prompt', 'Prompts', prompts, 'delete'),
    kept: kept.map((prompt) => prompt.key),
  };
  if (malformed > 0) {
    promptSection.updates.push({
      key: `${malformed} malformed stored ${malformed === 1 ? 'case' : 'cases'}`,
      changedFields: ['replaced'],
    });
  }
  const sections: ImportPlanSection[] = [promptSection];
  if (pointerChanged.length > 0 && current) {
    sections.unshift({
      entity: 'set',
      label: 'The set’s title and provenance',
      creates: [],
      updates: [{ key: current.pointer.id, changedFields: pointerChanged }],
      removals: [],
      removalKind: 'delete',
      unchanged: [],
      skippedRetired: [],
    });
  }

  return {
    plan: {
      collection: 'golden set',
      sections,
      refusals,
      writesNothing: sectionsWriteNothing(sections),
    },
    pointerChanged,
    prompts,
    after,
  };
}

async function readStored(client: Client): Promise<StoredGoldenSet> {
  const [current, control] = await Promise.all([
    readCurrent(client),
    client.aiAgent.findUnique({
      where: { slug: VOICE_CONTROL_AGENT_SLUG },
      select: { name: true, description: true, systemInstructions: true },
    }),
  ]);
  return { current, control };
}

function parseGoldenSetFile(raw: unknown): VoiceGoldenSetFile {
  return parseContentFile(voiceGoldenSetFileSchema, raw, 'golden set');
}

export async function previewGoldenSetImport(
  raw: unknown,
  removeAbsent: boolean
): Promise<ContentImportPlan> {
  return planGoldenSetImport(parseGoldenSetFile(raw), await readStored(prisma), removeAbsent).plan;
}

/** Apply a golden set file to the current version. Re-planned in the transaction; idempotent. */
export async function applyGoldenSetImport(
  raw: unknown,
  removeAbsent: boolean,
  editorId: string
): Promise<ContentImportPlan> {
  const file = parseGoldenSetFile(raw);
  return executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planGoldenSetImport(file, stored, removeAbsent);
      if (planned.plan.refusals.length > 0)
        throw importRefused('golden set', planned.plan.refusals);
      if (planned.plan.writesNothing) return planned.plan;
      const current = stored.current!;

      const promptSection = planned.plan.sections.find((section) => section.entity === 'prompt');
      if (
        promptSection &&
        promptSection.creates.length +
          promptSection.updates.length +
          promptSection.removals.length >
          0
      ) {
        assertCoverage(planned.after);
        await writePrompts(tx, current.datasetId, planned.after);
      }

      if (planned.pointerChanged.length > 0) {
        const revision = current.pointer.revision + 1;
        const words = {
          title: file.goldenSet.title,
          version: current.pointer.version,
          locale: file.goldenSet.locale,
          provenance: file.goldenSet.provenance,
        };
        await tx.appVoiceGoldenSet.update({
          where: { id: VOICE_GOLDEN_SET_ID },
          data: { ...words, status: 'draft', signedOffAt: null, revision },
        });
        await tx.appVoiceGoldenSetRevision.create({
          data: {
            setId: VOICE_GOLDEN_SET_ID,
            revision,
            ...words,
            status: 'draft',
            changedFields:
              current.pointer.status === 'draft'
                ? planned.pointerChanged
                : [...planned.pointerChanged, 'status'],
            origin: 'admin',
            editorId,
          },
        });
      }
      return planned.plan;
    },
    { timeout: 30_000 }
  );
}
