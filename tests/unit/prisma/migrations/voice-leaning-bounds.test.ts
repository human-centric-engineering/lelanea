/**
 * The leaning bounds migration (f-leanings t-135): every existing voice
 * overlay set gets the drafted bounds the seed writes for a fresh one.
 *
 * A migration is frozen once applied, so the bounds it embeds are a second copy
 * of the seed file's, and a second copy is the thing that drifts. These cases
 * keep the two honest, and pin what the migration must and must not touch.
 *
 * @see prisma/migrations/20261010100000_app_voice_leaning_bounds/migration.sql
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';

const MIGRATION = 'prisma/migrations/20261010100000_app_voice_leaning_bounds/migration.sql';

describe('the leaning bounds migration (f-leanings t-135)', () => {
  const sql = () => readFileSync(path.join(process.cwd(), MIGRATION), 'utf8');

  it('writes exactly the bounds the seed builds today', () => {
    const match = /\$t135leanings\$([\s\S]*?)\$t135leanings\$/.exec(sql());

    expect(match, 'the migration no longer embeds the leaning bounds').not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(buildVoiceOverlaySeed().set.leanings);
  });

  it('moves only a set with no bounds yet, so an edited set survives', () => {
    expect(sql()).toContain('WHERE "leanings" IS NULL');
  });

  it('records the change as the service would: a draft revision of the bounds, by the seed', () => {
    expect(sql()).toContain("ARRAY['leanings']");
    expect(sql()).toContain("ARRAY['leanings', 'status']");
    expect(sql()).toContain('"status" = \'draft\'');
    expect(sql()).not.toContain("'signed_off'");
    expect(sql()).toContain("'seed', NULL");
    expect(sql()).toContain("set_config('app.bypass_rls', 'on', true)");
    expect(sql()).toContain('"orgId"');
  });

  it('makes the set’s bounds required, and leaves older revisions without them', () => {
    expect(sql()).toContain(
      'ALTER TABLE "app_voice_overlay_set" ALTER COLUMN "leanings" SET NOT NULL;'
    );
    expect(sql()).not.toMatch(
      /app_voice_overlay_set_revision" ALTER COLUMN "leanings" SET NOT NULL/
    );
  });
});
