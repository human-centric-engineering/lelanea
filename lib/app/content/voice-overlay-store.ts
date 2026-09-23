/**
 * The voice overlays, read from and written to the database
 * (f-content-seeds t-88).
 *
 * **The one service for `app_voice_overlay_set` and `app_voice_overlay`.** The
 * seed writes through it now, and the admin editor will in t-92.
 * `lib/app/voice/overlays.ts` selects from it by situation and
 * `lib/app/voice/context-contributor.ts` composes the block that reaches a
 * prompt.
 *
 * Read per request, no cache, and an unseeded database throws
 * {@link ContentNotSeededError}, both for the reasons `document-store.ts`
 * gives. **There is no fallback to the bundled file** — the same rule t-88
 * applied to the crisis copy, and for the same reason: a second source that
 * answers when the first cannot is a second thing to keep signed off, and it
 * is the one nobody looks at.
 *
 * Note what this does NOT cache. The composed context block is already cached
 * for 60s per `(type, id, userId)` by `lib/orchestration/chat/context-builder`,
 * above this read, so caching here would only stack a second staleness window
 * on the first.
 *
 * @see lib/app/content/voice-overlay-view.ts — the projection
 * @see lib/app/content/voice-overlay-seed.ts — what the seed writes
 */

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '@/lib/db/client';
import { ContentNotSeededError } from '@/lib/app/content/document-view';
import {
  storedCoreOnlySchema,
  storedExemplarsSchema,
  storedProvenanceSchema,
  toVoiceOverlays,
  VOICE_OVERLAY_SET_ID,
  type VoiceOverlays,
} from '@/lib/app/content/voice-overlay-view';
import type { VoiceOverlaySeed } from '@/lib/app/content/voice-overlay-seed';

/**
 * The one set there is, re-exported so this module stays its import path.
 *
 * Defined in `voice-overlay-view.ts` because the seed needs the same value and
 * cannot import it from here — the docblock there has the cycle it would
 * close, and what it deadlocks.
 */
export { VOICE_OVERLAY_SET_ID };

// ============================================================================
// Reads
// ============================================================================

/**
 * The context-selected overlays, the labelling copy for a retrieved passage,
 * and the core-only fallback body.
 *
 * Read `provenance` before putting any of it in front of anyone: these lines
 * were drafted in her register from the corpus, exactly as the core was, and
 * are a proposal until she has signed them off.
 *
 * @throws ContentNotSeededError when the seed has not run.
 */
export async function getVoiceOverlays(): Promise<VoiceOverlays> {
  const set = await defaultClient.appVoiceOverlaySet.findUnique({
    where: { id: VOICE_OVERLAY_SET_ID },
    include: { overlays: { orderBy: { position: 'asc' } } },
  });
  if (!set) {
    throw new ContentNotSeededError('No voice overlays in the database', '019-voice-overlays.ts');
  }
  return toVoiceOverlays(set, set.overlays);
}

// ============================================================================
// Writes
// ============================================================================

/** The fields a set revision snapshots. At revision 1 every one is "changed". */
export const VOICE_OVERLAY_SET_SNAPSHOT_FIELDS = [
  'title',
  'version',
  'locale',
  'provenance',
  'exemplars',
  'coreOnly',
  'status',
] as const;

/** The fields an overlay revision snapshots. */
export const VOICE_OVERLAY_SNAPSHOT_FIELDS = [
  'position',
  'label',
  'reviewerNote',
  'heading',
  'lines',
  'exemplarQuery',
  'status',
] as const;

export type SeedVoiceOverlaysResult =
  | { status: 'seeded'; overlays: number }
  /** The set already exists. Nothing was written. */
  | { status: 'skipped'; overlays: number };

/**
 * Write the set, its overlays and each one's first revision, once.
 *
 * **Write-once (`fp4`)**, marked by the set row, which is written in the same
 * transaction as everything else. **Safe on empty**: no removal pass.
 *
 * Seeded `draft`, never `signed_off`: the words are a proposal in her register
 * until she says otherwise, and a seed is not the thing that can say so.
 */
export async function seedVoiceOverlays(
  seed: VoiceOverlaySeed,
  client: PrismaClient = defaultClient
): Promise<SeedVoiceOverlaysResult> {
  const existing = await client.appVoiceOverlaySet.findUnique({
    where: { id: seed.set.id },
    select: { id: true },
  });
  if (existing) {
    return {
      status: 'skipped',
      overlays: await client.appVoiceOverlay.count({ where: { setId: seed.set.id } }),
    };
  }

  const now = new Date();
  const { id: setId, ...setText } = seed.set;
  // Validated again at the write, not just when the seed was built.
  const framing = {
    ...setText,
    provenance: storedProvenanceSchema.parse(setText.provenance),
    exemplars: storedExemplarsSchema.parse(setText.exemplars),
    coreOnly: storedCoreOnlySchema.parse(setText.coreOnly),
  };
  const provenance = { origin: 'seed' as const, editorId: null, changedAt: now };

  await client.$transaction([
    client.appVoiceOverlaySet.create({
      data: { id: setId, ...framing, status: 'draft', revision: 1, createdAt: now, updatedAt: now },
    }),
    client.appVoiceOverlay.createMany({
      data: seed.overlays.map((overlay) => ({
        ...overlay,
        setId,
        status: 'draft' as const,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    }),
    client.appVoiceOverlaySetRevision.create({
      data: {
        setId,
        revision: 1,
        ...framing,
        status: 'draft',
        changedFields: [...VOICE_OVERLAY_SET_SNAPSHOT_FIELDS],
        ...provenance,
      },
    }),
    client.appVoiceOverlayRevision.createMany({
      data: seed.overlays.map((overlay) => ({
        ...overlay,
        revision: 1,
        status: 'draft' as const,
        changedFields: [...VOICE_OVERLAY_SNAPSHOT_FIELDS],
        ...provenance,
      })),
    }),
  ]);

  return { status: 'seeded', overlays: seed.overlays.length };
}
