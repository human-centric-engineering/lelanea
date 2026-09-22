/**
 * Which golden set is current, read from and written to the database
 * (f-content-seeds t-88).
 *
 * **The one service for `app_voice_golden_set`.** The seed writes through it
 * now, and the admin editor will in t-92.
 *
 * ## What this row is, and what it deliberately is not
 *
 * It holds the POINTER and the PROVENANCE, and nothing else (`fp4`). The
 * prompts are `AiDatasetCase` rows under
 * `goldenSetDatasetId(version)`; the control's system instructions are columns
 * on the control agent. Both are written by
 * `prisma/seeds/app-lelanea/004-voice-golden-set.ts` and both are already read
 * back from the database by `comparison-admin.ts`. Copying either into a table
 * of ours would give her prompts two writable homes, which is the failure t-87
 * named when it split the journey's roster from the journey's words.
 *
 * Before t-88 the authored file answered "which version is current", which is
 * why no database read could: a dataset is keyed BY the version, so knowing the
 * id already required knowing the answer.
 *
 * Read per request, no cache; an unseeded database throws
 * {@link ContentNotSeededError} and there is no fallback to the file.
 *
 * @see lib/app/voice/golden-set.ts — `goldenSetDatasetId`, and the case shape
 * @see lib/app/content/golden-set-seed.ts — what the seed writes
 */

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultClient } from '@/lib/db/client';
import { ContentNotSeededError } from '@/lib/app/content/document-view';
import {
  storedProvenanceSchema,
  type VoiceContentStatus,
  type VoiceProvenance,
} from '@/lib/app/content/voice-overlay-view';
import type { GoldenSetSeed } from '@/lib/app/content/golden-set-seed';

/** The one row there is. */
export const VOICE_GOLDEN_SET_ID = 'lelanea_voice_golden_set';

/** Which golden set is current, and what its provenance says. */
export interface VoiceGoldenSetPointer {
  id: string;
  title: string;
  /** The authored version. `goldenSetDatasetId(version)` is the dataset it names. */
  version: string;
  locale: string;
  provenance: VoiceProvenance;
  status: VoiceContentStatus;
  revision: number;
}

const statusSchema = z.enum(['draft', 'signed_off']);

// ============================================================================
// Reads
// ============================================================================

/**
 * Which golden set is current.
 *
 * @throws ContentNotSeededError when the seed has not run.
 */
export async function getGoldenSetPointer(): Promise<VoiceGoldenSetPointer> {
  const row = await defaultClient.appVoiceGoldenSet.findUnique({
    where: { id: VOICE_GOLDEN_SET_ID },
  });
  if (!row) {
    throw new ContentNotSeededError(
      'No golden set pointer in the database',
      '004-voice-golden-set.ts'
    );
  }
  const provenance = storedProvenanceSchema.safeParse(row.provenance);
  const status = statusSchema.safeParse(row.status);
  if (!provenance.success || !status.success) {
    throw new Error(`Golden set "${row.id}" failed validation on read`);
  }
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    locale: row.locale,
    provenance: provenance.data,
    status: status.data,
    revision: row.revision,
  };
}

// ============================================================================
// Writes
// ============================================================================

/** The fields a revision snapshots. At revision 1 every one is "changed". */
export const GOLDEN_SET_SNAPSHOT_FIELDS = [
  'title',
  'version',
  'locale',
  'provenance',
  'status',
] as const;

export type SeedGoldenSetResult = { status: 'seeded' } | { status: 'skipped'; version: string };

/**
 * Write the pointer and its first revision, once.
 *
 * **Write-once (`fp4`)**, unlike the dataset beside it, which seed 004
 * reconciles. The difference is deliberate and is the whole reason this row
 * exists separately: a dataset is a pure projection of the authored prompts, so
 * reconciling it cannot lose anyone's work, whereas this row is about to become
 * editable in t-92 and an operator who points the install at a different
 * version must not have that undone on the next boot.
 */
export async function seedGoldenSetPointer(
  seed: GoldenSetSeed,
  client: PrismaClient = defaultClient
): Promise<SeedGoldenSetResult> {
  const existing = await client.appVoiceGoldenSet.findUnique({
    where: { id: seed.id },
    select: { version: true },
  });
  if (existing) return { status: 'skipped', version: existing.version };

  const now = new Date();
  const { id, ...text } = seed;
  const framing = { ...text, provenance: storedProvenanceSchema.parse(text.provenance) };

  await client.$transaction([
    client.appVoiceGoldenSet.create({
      data: { id, ...framing, status: 'draft', revision: 1, createdAt: now, updatedAt: now },
    }),
    client.appVoiceGoldenSetRevision.create({
      data: {
        setId: id,
        revision: 1,
        ...framing,
        status: 'draft',
        changedFields: [...GOLDEN_SET_SNAPSHOT_FIELDS],
        origin: 'seed',
        editorId: null,
        changedAt: now,
      },
    }),
  ]);

  return { status: 'seeded' };
}
