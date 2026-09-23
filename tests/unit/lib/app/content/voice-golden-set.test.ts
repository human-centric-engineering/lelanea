/**
 * The ninth authored file: the golden set she is heard through.
 *
 * It reads the REAL `seed-data/drafted/lelanea_voice_golden_set.json` through the accessor
 * that ships, for the same reason its two siblings do: a fixture would test the
 * schema against itself, and the coupling to what is actually authored is the
 * whole value.
 *
 * What this file is for, over and above "it parses":
 *
 * - **The coverage promise is structural, not a comment.** The task this file
 *   belongs to promises a set covering a greeting, a decline, a grounded claim,
 *   and a question with nothing retrievable behind it. A set that quietly lost
 *   the last of those would still parse, still seed and still run — and would
 *   stop asking the one question that proves the core carries a turn alone. The
 *   schema refuses it, and the case below proves the schema refuses it.
 * - **Provenance cannot go quiet.** The third file in a row that is not a
 *   transcription, and the oddest of the three: these are words a PERSON puts to
 *   her. The block is served rather than withheld, and it still names who has yet
 *   to sign it off. That case is MEANT to be edited, once.
 * - **The control is real copy.** The bare arm's whole system prompt is
 *   authored here rather than written into a seed, so what the comparison
 *   compares against is as readable, and as much hers to change, as what it
 *   compares.
 * - **Keys are addressable.** A case key is the join between two versions of the
 *   set and appears in a URL, so it is a slug; a duplicate is a parse error,
 *   because the second would be unreachable and whoever authored it would have
 *   no way to tell from the file that their prompt is never read.
 *
 * `projectGoldenSetCases()` lost its default parameter in t-88 (it used to read
 * the authored file itself, which made a `lib/app/voice` module a file reader at
 * runtime) — every call here passes `getVoiceGoldenSet()` explicitly.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * Every case here is about Lelañea's authored set, not a platform contract. A
 * fork with its own `content/` has no `lelanea_voice_golden_set.json` and should
 * expect the whole file to fail. Rewrite it against your own set rather than
 * deleting it; if your fork ships none, delete the file and the schema together.
 *
 * @see lib/app/content/schemas.ts — `voiceGoldenSetFileSchema`
 * @see tests/unit/lib/app/voice/comparison.test.ts — what the set is run through
 */

import { describe, it, expect } from 'vitest';
import { getVoiceGoldenSet } from '@/lib/app/content';
import { GOLDEN_SET_REQUIRED_KINDS, voiceGoldenSetFileSchema } from '@/lib/app/content/schemas';
import { projectGoldenSetCases } from '@/lib/app/voice/golden-set';

/** A file that satisfies every rule, to mutate in the drift cases below. */
function validGoldenSetFile() {
  return {
    goldenSet: {
      id: 'g',
      title: 'T',
      layer: 'golden-set',
      version: '1.0',
      locale: 'en-US',
      provenance: {
        status: 'drafted_from_corpus',
        awaitingSignOffFrom: 'Lelañea Fulton',
        note: 'n',
      },
      notes: [],
    },
    dataset: { name: 'N', description: 'D', tags: [] },
    control: { name: 'C', description: 'D', systemInstructions: 'You are a helpful assistant.' },
    prompts: GOLDEN_SET_REQUIRED_KINDS.map((kind, index) => ({
      key: `case-${index}`,
      kind,
      probe: 'p',
      prompt: 'q',
    })),
    reviewNotes: [],
  };
}

describe('the authored golden set', () => {
  it('parses, and the fixture below is a real file rather than a shape that happens to pass', () => {
    expect(() => getVoiceGoldenSet()).not.toThrow();
    expect(voiceGoldenSetFileSchema.safeParse(validGoldenSetFile()).success).toBe(true);
  });

  it('covers every moment the feature promises', () => {
    const kinds = new Set(getVoiceGoldenSet().prompts.map((prompt) => prompt.kind));
    for (const kind of GOLDEN_SET_REQUIRED_KINDS) {
      expect(kinds).toContain(kind);
    }
  });

  it('still says it is awaiting her sign-off', () => {
    // MEANT to be edited, once, on the day she signs the set off — exactly like
    // its two siblings. Until then the file says what it is, and this pins that
    // it keeps saying it.
    const { provenance } = getVoiceGoldenSet();
    expect(provenance.status).toBe('drafted_from_corpus');
    expect(provenance.awaitingSignOffFrom).toBe('Lelañea Fulton');
  });

  it('gives the bare arm a real system prompt of its own', () => {
    // `composeSections()` omits a falsy section entirely, so a blank control
    // instruction composes to an EMPTY system prompt — at which point the
    // comparison is her core against nothing rather than against a bare model,
    // and every difference it reports is inflated.
    expect(getVoiceGoldenSet().control.systemInstructions.trim().length).toBeGreaterThan(0);
  });

  it('holds no expected output anywhere — the judgement is hers, not a string match', () => {
    // Asserted on the PROJECTION rather than on the file, because the projection
    // is what reaches the dataset rows: a reference answer smuggled in through
    // the seed rather than the schema would pass a file-level check.
    for (const projected of projectGoldenSetCases(getVoiceGoldenSet())) {
      expect(projected).not.toHaveProperty('expectedOutput');
    }
  });

  it('keeps every prompt addressable — no duplicate keys, no unslugged ones', () => {
    const keys = getVoiceGoldenSet().prompts.map((prompt) => prompt.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('the schema refuses the drifts that would pass unnoticed', () => {
  it('rejects a set that dropped one of the required moments', () => {
    const file = validGoldenSetFile();
    file.prompts = file.prompts.filter((prompt) => prompt.kind !== 'retrieval-empty');

    const result = voiceGoldenSetFileSchema.safeParse(file);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('retrieval-empty');
  });

  it('rejects two prompts sharing a key — the second would be unreachable', () => {
    const file = validGoldenSetFile();
    file.prompts[1].key = file.prompts[0].key;

    const result = voiceGoldenSetFileSchema.safeParse(file);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('duplicate prompt key');
  });

  it('rejects a blank control instruction', () => {
    const file = validGoldenSetFile();
    file.control.systemInstructions = '   ';
    expect(voiceGoldenSetFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects a version that cannot be ordered', () => {
    // The version becomes part of the dataset id and is how one run of the set is
    // told from another. `"v2 draft"` is not a version.
    const file = validGoldenSetFile();
    file.goldenSet.version = 'v2 draft';
    expect(voiceGoldenSetFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects an unknown key rather than dropping it', () => {
    const file = { ...validGoldenSetFile(), somethingNew: true };
    expect(voiceGoldenSetFileSchema.safeParse(file).success).toBe(false);
  });
});
