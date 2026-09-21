/**
 * `suggest_resource`: an id in, the library's own record out, and a refusal
 * for anything else (f-resources t-77).
 *
 * The library is mocked with a small fixture so the cases do not depend on
 * what the shipped file holds today (nothing — her list is t-76). The shape
 * reader in `suggestion.ts` and the provenance resolver are covered here too,
 * because they are the two other places a suggestion is read from.
 *
 * @see lib/app/resources/suggest.ts
 * @see lib/app/resources/suggestion.ts
 */

import { describe, it, expect, vi } from 'vitest';

import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

vi.mock('@/lib/app/content/resources', () => ({
  getResourcesLibrary: () => ({
    collection: {
      id: 'lelanea_resources',
      title: 'F',
      version: '0.1',
      locale: 'en-US',
      provenance: {},
    },
    films: [
      {
        id: 'on-stalling',
        title: 'On stalling',
        subtitle: 'why the words you avoid are the work',
        relatesTo: null,
        duration: '5:04',
        href: 'https://example.com/on-stalling',
      },
    ],
    readings: [
      {
        id: 'evidence',
        title: 'What counts as evidence',
        subtitle: 'why a value needs a receipt',
        relatesTo: 'module_01_values',
        readingTime: '6 min',
        href: 'https://example.com/evidence',
      },
    ],
    words: {},
  }),
}));

const { SuggestResourceCapability, findResource, suggestionsFromProvenance } =
  await import('@/lib/app/resources/suggest');
const { suggestionFromResult, SUGGEST_RESOURCE_SLUG } =
  await import('@/lib/app/resources/suggestion');

const context: CapabilityContext = { userId: 'user-1', agentId: 'agent-1' };
const capability = new SuggestResourceCapability();

describe('the capability', () => {
  it('is the slug the seed advertises, and processes no PII', () => {
    expect(capability.slug).toBe(SUGGEST_RESOURCE_SLUG);
    expect(capability.functionDefinition.name).toBe(SUGGEST_RESOURCE_SLUG);
    expect(capability.processesPii).toBe(false);
  });

  it('answers a film with the library’s own words', async () => {
    const result = await capability.execute(capability.validate({ id: 'on-stalling' }), context);

    expect(result).toEqual({
      success: true,
      data: {
        id: 'on-stalling',
        kind: 'film',
        title: 'On stalling',
        subtitle: 'why the words you avoid are the work',
        length: '5:04',
      },
    });
  });

  it('answers a reading, with its reading time as its length', async () => {
    const result = await capability.execute(capability.validate({ id: 'evidence' }), context);

    expect(result).toMatchObject({
      success: true,
      data: { id: 'evidence', kind: 'reading', length: '6 min' },
    });
  });

  it('refuses an id the library does not have, without throwing', async () => {
    const result = await capability.execute(capability.validate({ id: 'not-a-thing' }), context);

    expect(result).toEqual({
      success: false,
      error: { code: 'unknown_resource', message: expect.stringContaining('not-a-thing') },
    });
  });

  it('refuses at validation anything that is not an id', () => {
    for (const bad of [{ id: 'Not An Id' }, { id: '' }, { id: 'x'.repeat(81) }, {}, { id: 3 }]) {
      expect(() => capability.validate(bad)).toThrow();
    }
  });

  it('trims a padded id rather than refusing it', async () => {
    const result = await capability.execute(capability.validate({ id: '  evidence ' }), context);
    expect(result.success).toBe(true);
  });
});

describe('reading a suggestion back', () => {
  it('finds a resource by id and nothing by a title', () => {
    expect(findResource('on-stalling')?.kind).toBe('film');
    expect(findResource('On stalling')).toBeNull();
  });

  it('reads one off a live result, and nothing off a refusal or a stranger', () => {
    const live = { success: true, data: findResource('evidence') };
    expect(suggestionFromResult(live)).toEqual(findResource('evidence'));
    expect(suggestionFromResult({ success: false, error: { code: 'x', message: 'y' } })).toBeNull();
    expect(suggestionFromResult({ success: true, data: { chunks: [] } })).toBeNull();
    expect(suggestionFromResult(null)).toBeNull();
  });

  it('rebuilds them from a stored turn’s traces, in order, answered calls only', () => {
    const provenance = {
      capabilityCalls: [
        { slug: 'search_knowledge_base', success: true, arguments: { query: 'x' } },
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'evidence' } },
        { slug: SUGGEST_RESOURCE_SLUG, success: false, arguments: { id: 'nope' } },
        // The trace keeps the RAW argument; a padded id answered live, so it
        // must resolve here too.
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: ' on-stalling ' } },
        // A resource the file no longer has: no chip to nowhere.
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'removed-since' } },
        'not a trace',
      ],
    };

    expect(suggestionsFromProvenance(provenance).map((s) => s.id)).toEqual([
      'evidence',
      'on-stalling',
    ]);
    expect(suggestionsFromProvenance(null)).toEqual([]);
    expect(suggestionsFromProvenance({ citations: [] })).toEqual([]);
  });
});
