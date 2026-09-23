/**
 * The golden set as `/admin/app/voice` renders it (f-content-seeds t-88).
 *
 * It composes three stores rather than owning any of them, which is why it
 * lives here and not in `lib/app/content`: the pointer and provenance come
 * from `app_voice_golden_set`, the prompts from the dataset's cases, and the
 * control's system instructions from the control agent. A content store
 * reaching into `lib/app/voice` for the dataset id would have inverted the
 * dependency — and did, until ESLint's type-aware pass refused to resolve it.
 *
 * Nothing here reads the authored file.
 *
 * @see lib/app/content/golden-set-store.ts — the pointer row
 */

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultClient } from '@/lib/db/client';
import { ContentNotSeededError } from '@/lib/app/content/document-view';
import { getGoldenSetPointer } from '@/lib/app/content/golden-set-store';
import { goldenSetDatasetId, VOICE_CONTROL_AGENT_SLUG } from '@/lib/app/voice/golden-set';

/** The golden set as `/admin/app/voice` renders it. */
export interface GoldenSetAdminView {
  version: string;
  provenanceNote: string;
  awaitingSignOffFrom: string | null;
  prompts: { key: string; kind: string; prompt: string; probe: string }[];
  controlInstructions: string;
}

const caseMetadataSchema = z.object({
  key: z.string().optional(),
  kind: z.string().optional(),
  probe: z.string().optional(),
});

/**
 * Everything the voice page shows about the current golden set, from the
 * database.
 *
 * Three rows' worth, from the three places that own them: the pointer and
 * provenance here, the prompts from the dataset's cases, the control's
 * instructions from the control agent. Nothing is read from the authored file.
 *
 * A case whose metadata lost its `key` still has a position, so it is keyed by
 * that rather than dropped — the same fallback `comparison-admin.ts` makes, and
 * for the same reason: a prompt missing from the list reads as a prompt that
 * was never asked.
 *
 * @throws ContentNotSeededError when the pointer or the dataset is absent.
 */
export async function getGoldenSetAdminView(
  client: PrismaClient = defaultClient
): Promise<GoldenSetAdminView> {
  const pointer = await getGoldenSetPointer(client);

  const [cases, control] = await Promise.all([
    client.aiDatasetCase.findMany({
      where: { datasetId: goldenSetDatasetId(pointer.version) },
      orderBy: { position: 'asc' },
      select: { position: true, input: true, metadata: true },
    }),
    client.aiAgent.findUnique({
      where: { slug: VOICE_CONTROL_AGENT_SLUG },
      select: { systemInstructions: true },
    }),
  ]);

  if (cases.length === 0) {
    throw new ContentNotSeededError(
      `The golden set v${pointer.version} has no cases in this install`,
      '004-voice-golden-set.ts'
    );
  }

  return {
    version: pointer.version,
    provenanceNote: pointer.provenance.note,
    awaitingSignOffFrom: pointer.provenance.awaitingSignOffFrom,
    prompts: cases.map((row) => {
      // `safeParse`, not `parse`: `metadata` is a JSON column, so a row holding
      // a string, a number or an array is a shape the schema rejects rather
      // than a field it can default. Throwing there would lose the whole list
      // — every prompt, not the malformed one — for the same reason the
      // fallbacks below exist: a prompt missing from the list reads as a prompt
      // that was never asked. A row that parses to nothing gets the same
      // treatment as one whose `key` is absent (found by /code-review).
      const parsed = caseMetadataSchema.safeParse(row.metadata ?? {});
      const metadata: z.infer<typeof caseMetadataSchema> = parsed.success ? parsed.data : {};
      return {
        key: metadata.key ?? `position-${row.position}`,
        kind: metadata.kind ?? 'unknown',
        // `input` is a JSON column; every case the seed writes is a string.
        // Stringified rather than dropped for the reason `comparison-admin.ts`
        // gives: a prompt missing from the list reads as one never asked.
        prompt: typeof row.input === 'string' ? row.input : JSON.stringify(row.input),
        probe: metadata.probe ?? '',
      };
    }),
    controlInstructions: control?.systemInstructions ?? '',
  };
}
