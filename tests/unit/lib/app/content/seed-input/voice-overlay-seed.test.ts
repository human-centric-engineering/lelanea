/**
 * The authored overlays, and the two writers that must agree about them.
 *
 * Production migrates on every start and seeds only when asked, so the rows
 * every environment actually gets come from the data migration rather than
 * from seed 019. That makes the migration a second copy of the seed, and a
 * second copy is the thing that drifts. These cases are what keep the two
 * honest: edit the file or the builder, and they fail until the migration is
 * regenerated.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads Lelañea's own authored material
 * ---------------------------------------------------------------------------
 * Upstream there is no `lelanea_voice_overlays.json` and no overlay table, so
 * this file fails at import. That is the seam being unfilled, not a defect.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildVoiceOverlaySeed,
  readVoiceOverlaysFile,
} from '@/lib/app/content/seed-input/voice-overlay-seed';
import { VOICE_OVERLAY_SET_ID } from '@/lib/app/content/voice-overlay-store';

const MIGRATION = 'prisma/migrations/20260929100100_app_voice_overlays_data/migration.sql';

function migrationSql(): string {
  return readFileSync(path.join(process.cwd(), MIGRATION), 'utf8');
}

describe('the authored overlays', () => {
  it('parse, with every overlay carrying beats and a query', () => {
    const file = readVoiceOverlaysFile();

    // fp6: non-empty, so the loop below is not vacuously green.
    expect(file.overlays.length).toBeGreaterThan(0);
    for (const overlay of file.overlays) {
      expect(overlay.lines.length).toBeGreaterThan(0);
      expect(overlay.exemplarQuery.trim()).not.toBe('');
      expect(overlay.heading.trim()).not.toBe('');
    }
  });

  it('name each situation once, so no overlay is unreachable', () => {
    const situations = readVoiceOverlaysFile().overlays.map((o) => o.situation);

    expect(new Set(situations).size).toBe(situations.length);
  });

  it('are still a proposal awaiting her sign-off', () => {
    const { provenance } = readVoiceOverlaysFile().fingerprint;

    // These lines were drafted in her register, not transcribed from her. The
    // seed writes every row `draft` on the strength of this.
    expect(provenance.status).toBe('drafted_from_corpus');
    expect(provenance.awaitingSignOffFrom).toBe('Lelañea Fulton');
  });
});

describe('what the seed builds', () => {
  it('numbers the overlays from 1 in authored order', () => {
    const seed = buildVoiceOverlaySeed();

    expect(seed.overlays.map((o) => o.position)).toEqual(
      seed.overlays.map((_, index) => index + 1)
    );
    expect(seed.overlays.map((o) => o.situation)).toEqual(
      readVoiceOverlaysFile().overlays.map((o) => o.situation)
    );
  });

  it('gives the set the id the reader looks for, whatever the file says', () => {
    const seed = buildVoiceOverlaySeed();

    // The only id `getVoiceOverlays()` will ever ask for. The builder used to
    // take this from `file.fingerprint.id`, which the schema lets be any
    // lowercase slug — and `seedVoiceOverlays` keys write-once off
    // `seed.set.id`, not an empty table. So a rename in the file seeded a
    // second, unreadable set row and reported success while every turn threw.
    expect(seed.set.id).toBe(VOICE_OVERLAY_SET_ID);

    // Proved against a file whose `fingerprint.id` is something else, so this
    // cannot pass by the two merely agreeing today.
    const renamed = buildVoiceOverlaySeed({
      ...readVoiceOverlaysFile(),
      fingerprint: { ...readVoiceOverlaysFile().fingerprint, id: 'renamed_by_an_editor' },
    });
    expect(renamed.set.id).toBe(VOICE_OVERLAY_SET_ID);
  });

  it("carries the file's `when` across as the reviewer note", () => {
    const file = readVoiceOverlaysFile();
    const seed = buildVoiceOverlaySeed();

    // Renamed in the column because `when` is reserved in SQL. A rename is
    // exactly the kind of thing that silently drops a field, so it is pinned.
    expect(seed.overlays.map((o) => o.reviewerNote)).toEqual(file.overlays.map((o) => o.when));
    for (const overlay of seed.overlays) expect(overlay.reviewerNote.trim()).not.toBe('');
  });

  it('carries the two blocks that belong to no situation', () => {
    const file = readVoiceOverlaysFile();
    const { set } = buildVoiceOverlaySeed();

    // `originLabel` is the load-bearing one: it is what tells the model her
    // writing from the person's, so losing it in the move would be a safety
    // regression rather than a cosmetic one.
    expect(set.exemplars).toEqual({
      heading: file.exemplars.heading,
      originLabel: file.exemplars.originLabel,
      lines: [...file.exemplars.lines],
      noneFoundNote: file.exemplars.noneFoundNote,
      unavailableNote: file.exemplars.unavailableNote,
    });
    expect(set.coreOnly).toEqual({
      heading: file.coreOnly.heading,
      lines: [...file.coreOnly.lines],
    });
  });

  it('leaves the working notes out of the rows', () => {
    const seed = buildVoiceOverlaySeed();

    // `reviewNotes`, `sourceFiles`, `notes` and `textFormat` are notes ABOUT
    // the words rather than the words, and none of them is a column.
    const serialised = JSON.stringify(seed);
    for (const note of readVoiceOverlaysFile().reviewNotes!) {
      expect(serialised).not.toContain(note);
    }
  });
});

describe('the data migration', () => {
  // Production migrates on every start and seeds only on request, so the rows
  // every environment gets come from the migration, not the seed. It embeds
  // the seed as JSON. This keeps the two from disagreeing: edit the file or
  // the builder, and this fails until the migration is regenerated (or, once
  // shipped, a follow-up migration moves the rows that need it).
  it('writes exactly what the seed builds today', () => {
    const match = /\$t88overlays\$([\s\S]*?)\$t88overlays\$/.exec(migrationSql());

    expect(match, 'the migration no longer embeds the overlay seed JSON').not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(buildVoiceOverlaySeed());
  });

  it('records the same changed fields the service records', async () => {
    const { VOICE_OVERLAY_SET_SNAPSHOT_FIELDS, VOICE_OVERLAY_SNAPSHOT_FIELDS } =
      await import('@/lib/app/content/voice-overlay-store');
    const sql = migrationSql();

    for (const fields of [VOICE_OVERLAY_SET_SNAPSHOT_FIELDS, VOICE_OVERLAY_SNAPSHOT_FIELDS]) {
      expect(sql).toContain(`ARRAY[${fields.map((f) => `'${f}'`).join(', ')}]`);
    }
  });

  it('inserts only into an empty table, so an edited row survives a re-deploy', () => {
    const sql = migrationSql();

    // Operator-owned (`fp4`). Without the guard a re-deploy would undo the
    // first admin edit, which is the whole failure t-88 exists to avoid.
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM "app_voice_overlay_set")');
    expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM "app_voice_overlay")');
  });

  it('writes every row as a draft, because a migration cannot sign her words off', () => {
    const sql = migrationSql();

    expect(sql).not.toContain("'signed_off'");
    expect(sql.match(/'draft'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
