/**
 * The leaning rows migration (f-leanings t-136): every existing voice overlay
 * set gets the drafted pole lines and their framing, as the seed writes them
 * for a fresh one.
 *
 * A migration is frozen once applied, so the rows it embeds are a second copy
 * of the seed file's, and a second copy is the thing that drifts. These cases
 * keep the two honest, and pin what the migration must and must not touch.
 *
 * @see prisma/migrations/20261011100100_app_voice_leaning_overlays/migration.sql
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { LEANING_FRAMING_SITUATION, isLeaningSituation } from '@/lib/app/voice/leanings-select';
import { LEANING_KEYS } from '@/lib/app/voice/leanings';

const MIGRATION = 'prisma/migrations/20261011100100_app_voice_leaning_overlays/migration.sql';
const SCHEMA_MIGRATION = 'prisma/migrations/20261011100000_app_turn_leanings/migration.sql';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('the leaning rows migration (f-leanings t-136)', () => {
  const sql = () => read(MIGRATION);

  it('writes exactly the leaning rows the seed builds today', () => {
    const match = /\$t136overlays\$([\s\S]*?)\$t136overlays\$/.exec(sql());

    expect(match, 'the migration no longer embeds the leaning rows').not.toBeNull();
    const embedded = JSON.parse(match![1]) as { overlays: unknown[] };
    const seeded = buildVoiceOverlaySeed().overlays.filter((o) => isLeaningSituation(o.situation));
    // fp6: the framing and four poles per dial, so the equality is not of two empties.
    expect(seeded).toHaveLength(1 + LEANING_KEYS.length * 4);
    expect(seeded.map((o) => o.situation)).toContain(LEANING_FRAMING_SITUATION);
    expect(embedded.overlays).toEqual(seeded);
  });

  it('inserts only a situation the org does not have yet, so an operator’s own survives', () => {
    expect(sql()).toContain('WHERE NOT EXISTS (');
    expect(sql()).toContain('"e"."situation" = "o"."value"->>\'situation\'');
  });

  it('places them after the set’s last overlay, since positions are unique per set', () => {
    expect(sql()).toContain('COALESCE(MAX("x"."position"), 0)');
  });

  it('records the same changed fields the service records, as drafts, under the org', async () => {
    const { VOICE_OVERLAY_SNAPSHOT_FIELDS } = await import('@/lib/app/content/voice-overlay-store');
    expect(sql()).toContain(
      `ARRAY[${VOICE_OVERLAY_SNAPSHOT_FIELDS.map((f) => `'${f}'`).join(', ')}]`
    );
    expect(sql()).toContain(`WHERE "o"."situation" LIKE 'leaning-%'`);
    expect(sql()).not.toContain("'signed_off'");
    expect(sql()).toContain("set_config('app.bypass_rls', 'on', true)");
    expect(sql()).toContain('"set"."orgId"');
  });
});

describe('the turn’s leanings column (f-leanings t-136)', () => {
  it('adds a nullable JSON column and nothing else', () => {
    const statements = read(SCHEMA_MIGRATION)
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('--'));
    expect(statements).toEqual(['ALTER TABLE "app_turn" ADD COLUMN "leanings" JSONB;']);
  });
});
