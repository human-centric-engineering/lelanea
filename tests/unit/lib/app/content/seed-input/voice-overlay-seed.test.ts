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

import { REGISTERS } from '@/lib/app/voice/register';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildVoiceOverlaySeed,
  readVoiceOverlaysFile,
} from '@/lib/app/content/seed-input/voice-overlay-seed';
import { VOICE_OVERLAY_SET_ID } from '@/lib/app/content/voice-overlay-store';

const MIGRATION = 'prisma/migrations/20260929100100_app_voice_overlays_data/migration.sql';
const REGISTER_MIGRATION =
  'prisma/migrations/20261007100100_app_voice_register_overlays/migration.sql';
/** The overlays the t-125 migration adds, named for the registers that select them. */
const REGISTER_SITUATIONS: readonly string[] = ['guiding', 'teaching'];

/** t-114: moved the set's authored name from `id` into `slug`. */
const PER_ORG_KEYS_MIGRATION =
  'prisma/migrations/20261004100100_app_voice_crisis_budget_per_org_keys/migration.sql';

function migrationSql(file: string = MIGRATION): string {
  return readFileSync(path.join(process.cwd(), file), 'utf8');
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
    expect(seed.set.slug).toBe(VOICE_OVERLAY_SET_ID);

    // Proved against a file whose `fingerprint.id` is something else, so this
    // cannot pass by the two merely agreeing today.
    const renamed = buildVoiceOverlaySeed({
      ...readVoiceOverlaysFile(),
      fingerprint: { ...readVoiceOverlaysFile().fingerprint, id: 'renamed_by_an_editor' },
    });
    expect(renamed.set.slug).toBe(VOICE_OVERLAY_SET_ID);
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
    // The t-88 migration wrote the set's name into `id`; t-114 carried it into
    // `slug` (and gave the row a generated id). So what the seed builds today
    // is the embedded JSON with that one key moved, and nothing else changed.
    const embedded = JSON.parse(match![1]) as {
      set: Record<string, unknown> & { id: string };
      overlays: unknown[];
    };
    const { id: authoredName, ...setText } = embedded.set;
    // The registers' two overlays came later, in their own migration (t-125,
    // below), and so did the leaning bounds (t-135, below); t-88's literal is
    // the seed without them.
    const seed = buildVoiceOverlaySeed();
    const { leanings: _leanings, ...setBeforeLeanings } = seed.set;
    expect({ ...embedded, set: { ...setText, slug: authoredName } }).toEqual({
      ...seed,
      set: setBeforeLeanings,
      overlays: seed.overlays.filter((o) => !REGISTER_SITUATIONS.includes(o.situation)),
    });
    expect(migrationSql(PER_ORG_KEYS_MIGRATION)).toContain(
      'UPDATE "app_voice_overlay_set" SET "slug" = "id";'
    );
  });

  it('records the same changed fields the service records', async () => {
    const { VOICE_OVERLAY_SET_SNAPSHOT_FIELDS, VOICE_OVERLAY_SNAPSHOT_FIELDS } =
      await import('@/lib/app/content/voice-overlay-store');
    const sql = migrationSql();
    // `leanings` joined the set's snapshot later (t-135), in its own migration.
    const setFieldsThen = VOICE_OVERLAY_SET_SNAPSHOT_FIELDS.filter((f) => f !== 'leanings');

    for (const fields of [setFieldsThen, VOICE_OVERLAY_SNAPSHOT_FIELDS]) {
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

describe('the registers’ data migration (f-registers t-125)', () => {
  const sql = () => migrationSql(REGISTER_MIGRATION);

  it('writes exactly the guiding and teaching overlays the seed builds today', () => {
    const match = /\$t125overlays\$([\s\S]*?)\$t125overlays\$/.exec(sql());

    expect(match, 'the migration no longer embeds the register overlays').not.toBeNull();
    const embedded = JSON.parse(match![1]) as { overlays: unknown[] };
    const seeded = buildVoiceOverlaySeed().overlays.filter((o) =>
      REGISTER_SITUATIONS.includes(o.situation)
    );
    expect(seeded.map((o) => o.situation)).toEqual([...REGISTER_SITUATIONS]);
    expect(embedded.overlays).toEqual(seeded);
  });

  it('names one situation per register, so every register selects an overlay', () => {
    expect([...REGISTER_SITUATIONS]).toEqual([...REGISTERS]);
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
    expect(sql()).not.toContain("'signed_off'");
    expect(sql()).toContain("set_config('app.bypass_rls', 'on', true)");
    expect(sql()).toContain('"set"."orgId"');
  });
});

describe('the leaning bounds the seed writes (f-leanings t-135)', () => {
  it('refuses a file without them, rather than seed a set that locks every dial', () => {
    const { leanings: _none, ...file } = readVoiceOverlaysFile();

    expect(() => buildVoiceOverlaySeed(file)).toThrow(/no `leanings` block/);
  });

  it('writes the file’s bounds onto the set', () => {
    expect(buildVoiceOverlaySeed().set.leanings).toEqual(readVoiceOverlaysFile().leanings);
  });
});
