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
  isQuotable,
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
