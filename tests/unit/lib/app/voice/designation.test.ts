/**
 * The vocabulary, and the rule as a pure function.
 *
 * Small, and three of the cases here are the ones that would otherwise be
 * discovered in production:
 *
 *  - slugs must satisfy the PLATFORM's tag-slug rule, not ours. The plan wrote
 *    `purpose:voice`; `knowledgeTagSlugSchema` is `^[a-z0-9-]+$` and would have
 *    rejected every one of them at the seed.
 *  - a conflicting designation must resolve to the SAFE reading. A document
 *    somehow carrying both `purpose-voice` and `purpose-knowledge` has to read as
 *    voice, because being wrong that way costs a passage that is never quoted and
 *    being wrong the other way is her Substack pasted into a reply.
 *  - every vocabulary value must have the admin copy that explains it, so a value
 *    cannot ship as an unexplained word in a dropdown.
 */

import { describe, it, expect } from 'vitest';

import type { DocumentPurpose } from '@/lib/app/voice/designation';
import {
  DESIGNATION_TAG_SLUGS,
  DOCUMENT_PURPOSES,
  DOCUMENT_SENSITIVITIES,
  PURPOSE_COPY,
  PURPOSE_TAG_SLUGS,
  SENSITIVITY_COPY,
  SENSITIVITY_TAG_SLUGS,
  TOOL_PATH_PURPOSES,
  UNGRANTABLE_SENSITIVITIES,
  VOICE_PATH_PURPOSES,
  isQuotable,
  isVoiceExemplar,
  purposeFromTagSlug,
  purposeTagSlug,
  readDesignation,
  sensitivityFromTagSlug,
  sensitivityTagSlug,
} from '@/lib/app/voice/designation';

describe('the slugs', () => {
  it('satisfy the platform’s own tag-slug rule', () => {
    // The shape `lib/validations/orchestration.ts#knowledgeTagSlugSchema`
    // enforces. A colon-separated slug — which is what the plan text used —
    // fails this, and would have failed at the seed rather than here.
    for (const slug of DESIGNATION_TAG_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug.length).toBeLessThanOrEqual(64);
    }
  });

  it('are unique across both families', () => {
    expect(new Set(DESIGNATION_TAG_SLUGS).size).toBe(DESIGNATION_TAG_SLUGS.length);
    expect(DESIGNATION_TAG_SLUGS).toHaveLength(
      DOCUMENT_PURPOSES.length + DOCUMENT_SENSITIVITIES.length
    );
  });

  it('round-trip through their parsers', () => {
    for (const purpose of DOCUMENT_PURPOSES) {
      expect(purposeFromTagSlug(purposeTagSlug(purpose))).toBe(purpose);
      expect(sensitivityFromTagSlug(purposeTagSlug(purpose))).toBeNull();
    }
    for (const sensitivity of DOCUMENT_SENSITIVITIES) {
      expect(sensitivityFromTagSlug(sensitivityTagSlug(sensitivity))).toBe(sensitivity);
      expect(purposeFromTagSlug(sensitivityTagSlug(sensitivity))).toBeNull();
    }
  });

  it('do not read an unrelated tag as an answer', () => {
    // Prefix matching, so a tag an admin happened to call `purpose-ish` must not
    // parse as a purpose.
    expect(purposeFromTagSlug('purpose-ish')).toBeNull();
    expect(purposeFromTagSlug('onboarding')).toBeNull();
    expect(sensitivityFromTagSlug('sensitivity')).toBeNull();
  });

  it('keep the two families separable by prefix — the write path partitions on it', () => {
    // `setDesignation` clears one family without touching the other by filtering
    // these lists on their prefix. If a slug ever stopped carrying it, the clear
    // would silently become a no-op.
    expect(PURPOSE_TAG_SLUGS.every((slug) => slug.startsWith('purpose-'))).toBe(true);
    expect(SENSITIVITY_TAG_SLUGS.every((slug) => slug.startsWith('sensitivity-'))).toBe(true);
  });
});

describe('the rule', () => {
  it('admits knowledge and both, and never voice', () => {
    expect(TOOL_PATH_PURPOSES).toEqual(['knowledge', 'both']);
    expect(TOOL_PATH_PURPOSES).not.toContain('voice');
  });

  it('admits no `client` material — the deferred decision, expressed', () => {
    expect(UNGRANTABLE_SENSITIVITIES).toEqual(['client']);
    // And it is a real vocabulary value, so a document can be marked honestly on
    // upload rather than left undesignated or mis-labelled.
    expect(DOCUMENT_SENSITIVITIES).toContain('client');
    expect(isQuotable({ purpose: 'knowledge', sensitivity: 'client', licensing: null })).toBe(
      false
    );
    expect(isQuotable({ purpose: 'both', sensitivity: 'client', licensing: null })).toBe(false);
  });

  it('treats an undesignated document as reaching nothing', () => {
    expect(isQuotable({ purpose: null, sensitivity: null, licensing: null })).toBe(false);
    expect(isQuotable({ purpose: null, sensitivity: 'public', licensing: null })).toBe(false);
  });

  it('admits her quotable material', () => {
    expect(isQuotable({ purpose: 'knowledge', sensitivity: 'public', licensing: null })).toBe(true);
    expect(isQuotable({ purpose: 'knowledge', sensitivity: 'private', licensing: null })).toBe(
      true
    );
    expect(isQuotable({ purpose: 'both', sensitivity: null, licensing: null })).toBe(true);
  });

  it('never admits voice, at any sensitivity', () => {
    for (const sensitivity of [...DOCUMENT_SENSITIVITIES, null]) {
      expect(isQuotable({ purpose: 'voice', sensitivity, licensing: null })).toBe(false);
    }
  });
});

describe('isVoiceExemplar — the other path over the same corpus', () => {
  it('admits voice and both, and never knowledge', () => {
    // The mirror image of the tool path's list. `voice` being here is what makes
    // this path exist at all; removing it would leave the mechanism dark while
    // everything still passed.
    expect(VOICE_PATH_PURPOSES).toEqual(['voice', 'both']);
    expect(VOICE_PATH_PURPOSES).not.toContain('knowledge');
  });

  it('admits her voice material, and `both` with it', () => {
    expect(isVoiceExemplar({ purpose: 'voice', sensitivity: 'public', licensing: null })).toBe(
      true
    );
    expect(isVoiceExemplar({ purpose: 'voice', sensitivity: 'private', licensing: null })).toBe(
      true
    );
    // `both` carries her knowledge AND her register, so it is on both paths.
    expect(isVoiceExemplar({ purpose: 'both', sensitivity: null, licensing: null })).toBe(true);
  });

  it('never shows a knowledge-only document as an example of how she writes', () => {
    for (const sensitivity of [...DOCUMENT_SENSITIVITIES, null]) {
      expect(isVoiceExemplar({ purpose: 'knowledge', sensitivity, licensing: null })).toBe(false);
    }
  });

  it('refuses `sensitivity: client` here too, at any purpose', () => {
    // The deferral is about the model seeing the words at all. A rule that let
    // client material through because it was "only" an example of register would
    // be the leak the deferral exists to prevent, arriving by the other door.
    expect(isVoiceExemplar({ purpose: 'voice', sensitivity: 'client', licensing: null })).toBe(
      false
    );
    expect(isVoiceExemplar({ purpose: 'both', sensitivity: 'client', licensing: null })).toBe(
      false
    );
  });

  it('treats an undesignated document as reaching nothing', () => {
    expect(isVoiceExemplar({ purpose: null, sensitivity: null, licensing: null })).toBe(false);
    expect(isVoiceExemplar({ purpose: null, sensitivity: 'public', licensing: null })).toBe(false);
  });
});

describe('a document carrying two purpose tags', () => {
  it('resolves by precedence, not by which tag came first', () => {
    // Sunrise's own tag modal knows nothing about these families and will put
    // both on one row, so this is the real case rather than a contrived one.
    // The first version resolved `voice` explicitly and then fell through to
    // `purposes[0]`, which left every OTHER pair to tag order —
    // `purpose-knowledge` + `purpose-both` read as one or the other according to
    // nothing, and the two readings put the document on different paths. Caught
    // by /code-review.
    const pairs: [DocumentPurpose, DocumentPurpose, DocumentPurpose][] = [
      ['voice', 'knowledge', 'voice'],
      ['voice', 'both', 'voice'],
      ['both', 'knowledge', 'both'],
    ];

    for (const [first, second, expected] of pairs) {
      expect(readDesignation([purposeTagSlug(first), purposeTagSlug(second)], null).purpose).toBe(
        expected
      );
      // The same answer with the tags the other way round — which is the whole
      // point, and the half the first version got wrong.
      expect(readDesignation([purposeTagSlug(second), purposeTagSlug(first)], null).purpose).toBe(
        expected
      );
    }
  });

  it('resolves `client` over any laxer sensitivity, whichever order they arrive in', () => {
    for (const laxer of ['public', 'private'] as const) {
      expect(
        readDesignation([sensitivityTagSlug('client'), sensitivityTagSlug(laxer)], null).sensitivity
      ).toBe('client');
      expect(
        readDesignation([sensitivityTagSlug(laxer), sensitivityTagSlug('client')], null).sensitivity
      ).toBe('client');
    }
  });

  it('can still read every single value in the vocabulary', () => {
    // The guard on the precedence lists covering the vocabulary: a value added
    // to `DOCUMENT_PURPOSES` and not to the precedence reads back as `null`,
    // which would make the document reach nothing while the admin surface showed
    // the operator's answer.
    for (const purpose of DOCUMENT_PURPOSES) {
      expect(readDesignation([purposeTagSlug(purpose)], null).purpose).toBe(purpose);
    }
    for (const sensitivity of DOCUMENT_SENSITIVITIES) {
      expect(readDesignation([sensitivityTagSlug(sensitivity)], null).sensitivity).toBe(
        sensitivity
      );
    }
  });
});

describe('the two paths, read together', () => {
  it('cover the vocabulary between them, so no purpose falls through both', () => {
    // The pair is the point of the vocabulary: `voice` is on one path and not the
    // other, `knowledge` the reverse, `both` on both. A purpose added to neither
    // would be a document an operator had designated that reached nothing at
    // all — deny-by-default is right for an UNDESIGNATED document and wrong for a
    // designated one, and the difference is invisible on the admin surface.
    for (const purpose of DOCUMENT_PURPOSES) {
      const designation = { purpose, sensitivity: 'public' as const, licensing: null };
      expect({ purpose, reaches: isQuotable(designation) || isVoiceExemplar(designation) }).toEqual(
        { purpose, reaches: true }
      );
    }
  });

  it('keeps `voice` on exactly one of them — the one that cannot quote', () => {
    const voice = { purpose: 'voice' as const, sensitivity: null, licensing: null };

    expect(isQuotable(voice)).toBe(false);
    expect(isVoiceExemplar(voice)).toBe(true);
  });

  it('agrees that `client` reaches neither', () => {
    for (const purpose of [...DOCUMENT_PURPOSES, null]) {
      const designation = { purpose, sensitivity: 'client' as const, licensing: null };
      expect(isQuotable(designation)).toBe(false);
      expect(isVoiceExemplar(designation)).toBe(false);
    }
  });
});

describe('readDesignation', () => {
  it('reads one purpose and one sensitivity out of a document’s tags', () => {
    expect(
      readDesignation([purposeTagSlug('knowledge'), sensitivityTagSlug('private')], 'Hers, 2023')
    ).toEqual({ purpose: 'knowledge', sensitivity: 'private', licensing: 'Hers, 2023' });
  });

  it('ignores tags that are not ours', () => {
    expect(readDesignation(['onboarding', purposeTagSlug('both')], null)).toEqual({
      purpose: 'both',
      sensitivity: null,
      licensing: null,
    });
  });

  it('resolves a conflicting purpose to `voice`, the safe reading', () => {
    // Reachable today: `/admin/orchestration/knowledge` can put any tags on any
    // document and knows nothing about these families. The first-found reading
    // would depend on tag insertion order, which is not a basis for deciding
    // whether the agent may quote somebody's words.
    const designation = readDesignation(
      [purposeTagSlug('knowledge'), purposeTagSlug('voice')],
      null
    );

    expect(designation.purpose).toBe('voice');
    expect(isQuotable(designation)).toBe(false);
  });

  it('resolves a conflicting sensitivity to `client`, the safe reading', () => {
    const designation = readDesignation(
      [purposeTagSlug('knowledge'), sensitivityTagSlug('public'), sensitivityTagSlug('client')],
      null
    );

    expect(designation.sensitivity).toBe('client');
    expect(isQuotable(designation)).toBe(false);
  });
});

describe('the admin copy', () => {
  it('explains every value in both families', () => {
    // A value added to the vocabulary without its sentence would render as a bare
    // word in a dropdown and as `undefined` in the help popover.
    for (const purpose of DOCUMENT_PURPOSES) {
      expect(PURPOSE_COPY[purpose]?.label).toBeTruthy();
      expect(PURPOSE_COPY[purpose]?.help).toBeTruthy();
    }
    for (const sensitivity of DOCUMENT_SENSITIVITIES) {
      expect(SENSITIVITY_COPY[sensitivity]?.label).toBeTruthy();
      expect(SENSITIVITY_COPY[sensitivity]?.help).toBeTruthy();
    }
  });

  it('carries no copy for a value that is not in the vocabulary', () => {
    expect(Object.keys(PURPOSE_COPY).sort()).toEqual([...DOCUMENT_PURPOSES].sort());
    expect(Object.keys(SENSITIVITY_COPY).sort()).toEqual([...DOCUMENT_SENSITIVITIES].sort());
  });
});
