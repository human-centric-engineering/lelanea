/**
 * A person's leanings, applied as selection (f-leanings t-136).
 *
 * The rules are table tests on the pure function. The property the feature
 * rests on — a leaning only adds, and never removes the register overlay, the
 * exemplar framing or a safety line — is tested exhaustively over every
 * combination of extremes, against her real drafted rows composed by the real
 * `composeVoiceContext`, and the population is asserted non-empty before
 * anything is asserted absent (`fp6`).
 */

import { describe, it, expect, vi } from 'vitest';

// `composeVoiceContext` is pure, but its module reaches the database client at
// import; nothing here reads it.
vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import { composeVoiceContext } from '@/lib/app/voice/context-contributor';
import { toVoiceOverlays, type VoiceOverlays } from '@/lib/app/content/voice-overlay-view';
import { seededVoiceOverlayRows } from '@/tests/helpers/app/content-stores';
import {
  HELD_WHEN_HARD,
  LEANING_FRAMING_SITUATION,
  NO_LEANINGS,
  isLeaningSituation,
  leaningOfSituation,
  leaningOverlays,
  leaningSide,
  leaningSituation,
  parseLeaningsStamp,
  sameLeanings,
  selectLeanings,
  type LeaningPosition,
} from '@/lib/app/voice/leanings-select';
import {
  LEANING_KEYS,
  LEANING_STOPS,
  type LeaningKey,
  type LeaningStop,
} from '@/lib/app/voice/leanings';
import type { RegisterSource } from '@/lib/app/voice/register';
import type { VoiceExemplar } from '@/lib/app/voice/exemplars';

function content(): VoiceOverlays {
  const { set, overlays } = seededVoiceOverlayRows();
  return toVoiceOverlays(set, overlays);
}

/** Every dial at `stops[key]` (rest otherwise), with the full range allowed. */
function dials(stops: Partial<Record<LeaningKey, LeaningStop>> = {}): LeaningPosition[] {
  return LEANING_KEYS.map((key) => ({ key, stop: stops[key] ?? 0, min: -2, max: 2 }));
}

describe('the rows a stop selects', () => {
  it.each([
    ['directness', 2, 'leaning-directness-right-strong'],
    ['directness', 1, 'leaning-directness-right'],
    ['length', -1, 'leaning-length-left'],
    ['length', -2, 'leaning-length-left-strong'],
    ['pace', 0, null],
  ] as const)('%s at %s is %s', (key, stop, situation) => {
    expect(leaningSituation(key, stop)).toBe(situation);
  });

  it('has a drafted row for every stop off rest on every dial, and the framing', () => {
    const situations = new Set(content().overlays.map((overlay) => overlay.situation));
    const wanted = LEANING_KEYS.flatMap((key) =>
      LEANING_STOPS.flatMap((stop) => leaningSituation(key, stop) ?? [])
    );

    expect(wanted).toHaveLength(LEANING_KEYS.length * 4);
    for (const situation of [...wanted, LEANING_FRAMING_SITUATION]) {
      expect(situations, situation).toContain(situation);
    }
    // And no leaning row that no stop selects.
    const stray = [...situations].filter(
      (s) => isLeaningSituation(s) && s !== LEANING_FRAMING_SITUATION && !wanted.includes(s)
    );
    expect(stray).toEqual([]);
  });

  it('reads every pole row back to its dial and stop, and nothing else', () => {
    for (const key of LEANING_KEYS) {
      for (const stop of LEANING_STOPS.filter((candidate) => candidate !== 0)) {
        expect(leaningOfSituation(leaningSituation(key, stop)!)).toEqual({ key, stop });
      }
    }
    expect(leaningOfSituation(LEANING_FRAMING_SITUATION)).toBeNull();
    expect(leaningOfSituation('guiding')).toBeNull();
  });

  it('is never a register or a seat’s situation', () => {
    for (const situation of ['guiding', 'teaching', 'first-meeting', 'difficulty']) {
      expect(isLeaningSituation(situation)).toBe(false);
    }
  });
});

describe('selectLeanings', () => {
  it('applies nothing at rest', () => {
    expect(
      selectLeanings({ dials: dials(), registerSource: 'module', content: content() })
    ).toEqual(NO_LEANINGS);
  });

  it('applies each dial off rest, in settings order, whatever order the dials arrive in', () => {
    const stamp = selectLeanings({
      dials: [...dials({ formality: 1, abstraction: -2, length: 2 })].reverse(),
      registerSource: 'module',
      content: content(),
    });

    expect(stamp).toEqual({
      applied: [
        { key: 'abstraction', stop: -2 },
        { key: 'length', stop: 2 },
        { key: 'formality', stop: 1 },
      ],
      held: [],
    });
  });

  it('clamps a stop to its bounds again, and a locked dial applies nothing', () => {
    const stamp = selectLeanings({
      dials: [
        { key: 'warmth', stop: 2, min: -2, max: 1 },
        { key: 'questions', stop: -2, min: 0, max: 0 },
        { key: 'imagery', stop: -2, min: -1, max: 2 },
      ],
      registerSource: 'module',
      content: content(),
    });

    expect(stamp.applied).toEqual([
      { key: 'warmth', stop: 1 },
      { key: 'imagery', stop: -1 },
    ]);
  });

  it('applies nothing when the framing row has gone, so a pole never arrives without it', () => {
    const rows = content();
    const withoutFraming = {
      overlays: rows.overlays.filter((o) => o.situation !== LEANING_FRAMING_SITUATION),
    };

    expect(
      selectLeanings({ dials: dials({ length: 2 }), registerSource: 'module', content: rows })
        .applied
    ).toHaveLength(1);
    expect(
      selectLeanings({
        dials: dials({ length: 2 }),
        registerSource: 'module',
        content: withoutFraming,
      })
    ).toEqual(NO_LEANINGS);
  });

  it('does not stamp a stop whose row has been deleted as applied', () => {
    const rows = content();
    const without = {
      overlays: rows.overlays.filter((o) => o.situation !== 'leaning-length-right-strong'),
    };

    expect(
      selectLeanings({
        dials: dials({ length: 2, pace: 1 }),
        registerSource: 'module',
        content: without,
      }).applied
    ).toEqual([{ key: 'pace', stop: 1 }]);
  });

  describe('when something hard is here', () => {
    const hardSides = [...HELD_WHEN_HARD];

    it('names the poles it holds', () => {
      // fp6: the rule has something to hold.
      expect(hardSides.length).toBeGreaterThan(0);
      expect(Object.fromEntries(hardSides)).toEqual({
        directness: 'right',
        encouragement: 'right',
        warmth: 'right',
        pace: 'left',
        playfulness: 'left',
      });
    });

    it.each(['safety', 'fallback'] as const)(
      'under %s, holds every hard pole at both stops and applies its other side',
      (registerSource) => {
        for (const [key, side] of hardSides) {
          for (const magnitude of [1, 2] as const) {
            const hard = (side === 'right' ? magnitude : -magnitude) as LeaningStop;
            const held = selectLeanings({
              dials: dials({ [key]: hard }),
              registerSource,
              content: content(),
            });
            expect(held, `${key} at ${hard}`).toEqual({ applied: [], held: [key] });

            const soft = -hard as LeaningStop;
            const applied = selectLeanings({
              dials: dials({ [key]: soft }),
              registerSource,
              content: content(),
            });
            expect(applied, `${key} at ${soft}`).toEqual({
              applied: [{ key, stop: soft }],
              held: [],
            });
          }
        }
      }
    );

    it('does not report a pole as set aside when its row has gone, since it could never apply', () => {
      const rows = content();
      const without = {
        overlays: rows.overlays.filter((o) => o.situation !== 'leaning-warmth-right'),
      };

      expect(
        selectLeanings({
          dials: dials({ warmth: 1, pace: -1 }),
          registerSource: 'safety',
          content: without,
        })
      ).toEqual({ applied: [], held: ['pace'] });
    });

    it.each(['module', 'asked', null] as const)('under %s, holds nothing', (registerSource) => {
      const stamp = selectLeanings({
        dials: dials({ directness: 2, warmth: 2, pace: -2 }),
        registerSource,
        content: content(),
      });

      expect(stamp.held).toEqual([]);
      expect(stamp.applied.map((a) => a.key)).toEqual(['directness', 'warmth', 'pace']);
    });
  });
});

describe('leaningOverlays', () => {
  it('is the framing, then each applied pole’s row, in stamp order', () => {
    const rows = leaningOverlays(content(), {
      applied: [
        { key: 'length', stop: 2 },
        { key: 'devotion', stop: -1 },
      ],
      held: ['warmth'],
    });

    expect(rows.map((row) => row.situation)).toEqual([
      LEANING_FRAMING_SITUATION,
      'leaning-length-right-strong',
      'leaning-devotion-left',
    ]);
  });

  it('is empty with nothing applied, no stamp, or no framing row', () => {
    const rows = content();
    expect(leaningOverlays(rows, NO_LEANINGS)).toEqual([]);
    expect(leaningOverlays(rows, null)).toEqual([]);
    expect(
      leaningOverlays(
        { overlays: rows.overlays.filter((o) => o.situation !== LEANING_FRAMING_SITUATION) },
        { applied: [{ key: 'length', stop: 1 }], held: [] }
      )
    ).toEqual([]);
  });
});

describe('the stamp', () => {
  it('parses what selection writes, and refuses rest, an unknown key or a stray field', () => {
    const stamp = { applied: [{ key: 'length', stop: 2 }], held: ['warmth'] };
    expect(parseLeaningsStamp(stamp)).toEqual(stamp);
    expect(parseLeaningsStamp({ applied: [{ key: 'length', stop: 0 }], held: [] })).toBeNull();
    expect(parseLeaningsStamp({ applied: [{ key: 'volume', stop: 1 }], held: [] })).toBeNull();
    expect(parseLeaningsStamp({ ...stamp, extra: true })).toBeNull();
    expect(parseLeaningsStamp(null)).toBeNull();
  });

  it('compares by what it says', () => {
    expect(sameLeanings(NO_LEANINGS, { applied: [], held: [] })).toBe(true);
    expect(sameLeanings(NO_LEANINGS, null)).toBe(false);
    expect(sameLeanings(null, null)).toBe(true);
    expect(
      sameLeanings(
        { applied: [{ key: 'length', stop: 1 }], held: [] },
        { applied: [{ key: 'length', stop: 2 }], held: [] }
      )
    ).toBe(false);
  });
});

describe('every combination of extremes only adds (the feature’s safety property)', () => {
  const rows = content();
  const exemplars: VoiceExemplar[] = [{ passage: 'A passage of hers.', source: 'A document' }];
  const sources: (RegisterSource | null)[] = [null, 'module', 'asked', 'safety', 'fallback'];

  /** Every assignment of -2 or 2 to the eleven dials. */
  function* extremes(): Generator<Partial<Record<LeaningKey, LeaningStop>>> {
    for (let mask = 0; mask < 2 ** LEANING_KEYS.length; mask++) {
      yield Object.fromEntries(LEANING_KEYS.map((key, bit) => [key, (mask >> bit) & 1 ? 2 : -2]));
    }
  }

  it('keeps the register overlay, the exemplar framing and every safety line, and holds the hard poles', () => {
    const registers = ['guiding', 'teaching'].map((situation) => {
      const overlay = rows.overlays.find((o) => o.situation === situation);
      if (!overlay) throw new Error(`no ${situation} row`);
      return overlay;
    });
    const framing = rows.overlays.find((o) => o.situation === LEANING_FRAMING_SITUATION);
    // The lines that keep someone safe, by what they say: the registers' own,
    // and the framing's precedence. Found, not typed, so an edit to the copy
    // that drops one fails here rather than passing on an empty list.
    const safetyLines = [...registers, ...(framing ? [framing] : [])].flatMap((o) =>
      o.lines.filter((line) =>
        /hold space instead|no is a complete answer|the moment wins|refusal stays a refusal/.test(
          line
        )
      )
    );
    expect(safetyLines).toHaveLength(4);
    const heldHeadings = new Set(
      [...HELD_WHEN_HARD].flatMap(([key, side]) =>
        [1, 2].map((magnitude) => {
          const stop = (side === 'right' ? magnitude : -magnitude) as LeaningStop;
          const situation = leaningSituation(key, stop);
          return rows.overlays.find((o) => o.situation === situation)?.heading ?? '';
        })
      )
    );

    let compositions = 0;
    let poleRowsEmitted = 0;
    for (const stops of extremes()) {
      for (const registerSource of sources) {
        const stamp = selectLeanings({ dials: dials(stops), registerSource, content: rows });
        const shading = leaningOverlays(rows, stamp);
        for (const overlay of registers) {
          const plain = composeVoiceContext(rows, overlay, exemplars);
          const shaded = composeVoiceContext(rows, overlay, exemplars, shading);
          compositions++;
          poleRowsEmitted += Math.max(0, shading.length - 1);

          // The register's lines (its safety line among them) and the exemplar framing.
          for (const line of [...overlay.lines, ...rows.exemplars.lines]) {
            expect(shaded.includes(line), line).toBe(true);
          }
          // Everything the block says without the leanings, it says with them.
          for (const paragraph of plain.split('\n\n')) {
            expect(shaded.includes(paragraph)).toBe(true);
          }
          // A pole never arrives without the framing that says the moment wins.
          if (shading.length > 0) {
            for (const line of framing?.lines ?? []) expect(shaded.includes(line), line).toBe(true);
          }
          if (registerSource === 'safety' || registerSource === 'fallback') {
            for (const heading of heldHeadings) expect(shaded.includes(heading)).toBe(false);
          }
        }
      }
    }

    // fp6: the population was real — every combination ran, and pole rows were emitted.
    expect(compositions).toBe(2 ** LEANING_KEYS.length * sources.length * registers.length);
    expect(poleRowsEmitted).toBeGreaterThan(compositions);
  });

  it('places the leanings after the register and before her passages', () => {
    const overlay = rows.overlays.find((o) => o.situation === 'teaching');
    if (!overlay) throw new Error('no teaching row');
    const shading = leaningOverlays(rows, {
      applied: [{ key: 'length', stop: 2 }],
      held: [],
    });
    const block = composeVoiceContext(rows, overlay, exemplars, shading);

    const register = block.indexOf(overlay.heading);
    const lean = block.indexOf(shading[1].heading);
    const passages = block.indexOf(rows.exemplars.heading);
    expect(register).toBeGreaterThanOrEqual(0);
    expect(lean).toBeGreaterThan(register);
    expect(passages).toBeGreaterThan(lean);
  });

  it('still adds them to the core-only body, so the prompt says what the stamp says', () => {
    const shading = leaningOverlays(rows, { applied: [{ key: 'pace', stop: 1 }], held: [] });
    const block = composeVoiceContext(rows, null, [], shading);

    expect(block.startsWith(rows.coreOnly.heading)).toBe(true);
    expect(block).toContain(shading[1].heading);
    expect(block).not.toContain(rows.exemplars.heading);
  });
});

describe('leaningSide', () => {
  it.each(LEANING_STOPS.map((stop) => [stop, stop === 0 ? null : stop < 0 ? 'left' : 'right']))(
    '%s leans %s',
    (stop, side) => {
      expect(leaningSide(stop)).toBe(side);
    }
  );
});
