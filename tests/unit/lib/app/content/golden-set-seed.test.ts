/**
 * Which golden set is current, and the two writers that must agree about it.
 *
 * The pointer row is small and easy to dismiss, but it is what decides which
 * dataset a comparison runs and which one the voice page shows. Before t-88
 * the authored file decided that, which is why nothing in the database could
 * answer it.
 *
 * As with the overlays, production migrates on every start and seeds only when
 * asked, so the row every environment gets comes from the data migration. That
 * makes the migration a second copy of the builder, and these cases keep the
 * two honest.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads Lelañea's own authored material
 * ---------------------------------------------------------------------------
 * Upstream there is no golden set and no pointer table, so this file fails at
 * import. That is the seam being unfilled, not a defect.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildGoldenSetSeed } from '@/lib/app/content/golden-set-seed';
import { getVoiceGoldenSet } from '@/lib/app/content';
import { goldenSetDatasetId } from '@/lib/app/voice/golden-set';

const MIGRATION = 'prisma/migrations/20260929100400_app_voice_golden_set_data/migration.sql';

function migrationSql(): string {
  return readFileSync(path.join(process.cwd(), MIGRATION), 'utf8');
}

describe('what the seed builds', () => {
  it('points at the authored version, which is what names the dataset', () => {
    const seed = buildGoldenSetSeed();
    const authored = getVoiceGoldenSet();

    expect(seed.version).toBe(authored.collection.version);
    // The whole reason the row exists: `version` is not decoration, it is the
    // suffix of the id every reader resolves the dataset by.
    expect(goldenSetDatasetId(seed.version)).toContain(seed.version);
  });

  it('carries the provenance the voice page shows, whole', () => {
    const seed = buildGoldenSetSeed();
    const authored = getVoiceGoldenSet();

    expect(seed.provenance).toEqual({
      status: authored.provenance.status,
      awaitingSignOffFrom: authored.provenance.awaitingSignOffFrom,
      note: authored.provenance.note,
    });
    expect(seed.provenance.note.trim()).not.toBe('');
  });

  it('holds no prompt, because the prompts are the dataset', () => {
    const seed = buildGoldenSetSeed();
    const serialised = JSON.stringify(seed);

    // `fp4`, one owner per field. A copy of her prompts here would be the
    // two-writable-copies failure t-87 named — and it would be the copy
    // nobody reads, because every reader goes to `ai_dataset_case`.
    const authored = getVoiceGoldenSet();
    expect(authored.prompts.length).toBeGreaterThan(0);
    for (const prompt of authored.prompts) {
      expect(serialised).not.toContain(prompt.prompt);
    }
    // Nor the control's instructions, which live on the control agent.
    expect(serialised).not.toContain(authored.control.systemInstructions);
  });
});

describe('the data migration', () => {
  it('writes exactly what the seed builds today', () => {
    const match = /\$t88gs\$([\s\S]*?)\$t88gs\$/.exec(migrationSql());

    expect(match, 'the migration no longer embeds the golden-set seed JSON').not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(buildGoldenSetSeed());
  });

  it('records the same changed fields the service records', async () => {
    const { GOLDEN_SET_SNAPSHOT_FIELDS } = await import('@/lib/app/content/golden-set-store');

    expect(migrationSql()).toContain(
      `ARRAY[${GOLDEN_SET_SNAPSHOT_FIELDS.map((f) => `'${f}'`).join(', ')}]`
    );
  });

  it('inserts only into an empty table, so a repointed install survives a re-deploy', () => {
    // Operator-owned (`fp4`). This row is about to become editable in t-92,
    // and an operator who points the install at a different version must not
    // have that undone on the next boot.
    expect(migrationSql()).toContain('WHERE NOT EXISTS (SELECT 1 FROM "app_voice_golden_set")');
  });

  it('writes the row as a draft', () => {
    const sql = migrationSql();

    expect(sql).not.toContain("'signed_off'");
    expect(sql).toContain("'draft'");
  });
});
