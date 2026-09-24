/**
 * `suggest_resource`: an id in, the library's own record out, and a refusal
 * for anything else (f-resources t-77).
 *
 * The library's store is faked with the seed's rows plus two added here, so the
 * cases do not depend on what ships today (nothing — her list is t-76). The shape
 * reader in `suggestion.ts` and the provenance resolver are covered here too,
 * because they are the two other places a suggestion is read from.
 *
 * @see lib/app/resources/suggest.ts
 * @see lib/app/resources/suggestion.ts
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

// The library is rows since t-87. The fake serves what the seed writes (no
// videos, no articles yet) plus the two rows each test adds.
vi.mock('@/lib/app/content/resource-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeResourceStore()
);

import {
  SuggestResourceCapability,
  findResource,
  loadLibraryForChips,
  suggestionsByCall,
  suggestionsFromProvenance,
} from '@/lib/app/resources/suggest';
import { suggestionFromResult, SUGGEST_RESOURCE_SLUG } from '@/lib/app/resources/suggestion';
import { getResourcesLibrary } from '@/lib/app/content/resource-store';
import type { ResourcesLibrary } from '@/lib/app/content/resources';
import { fakeResourceStore, videoRow, articleRow } from '@/tests/helpers/app/content-stores';

const store = fakeResourceStore();

beforeEach(() => {
  vi.clearAllMocks();
  store.reset();
  store.addResource(
    videoRow('on-stalling', {
      title: 'On stalling',
      subtitle: 'why the words you avoid are the work',
      duration: '5:04',
      href: 'https://example.com/on-stalling',
    })
  );
  store.addResource(
    articleRow('evidence', {
      title: 'What counts as evidence',
      subtitle: 'why a value needs a receipt',
      relatesTo: 'module_01_values',
      readingTime: '6 min',
      href: 'https://example.com/evidence',
      documentId: null,
    })
  );
});

/** A provenance whose only answered call suggested `id`. */
const suggested = (id: string) => ({
  capabilityCalls: [{ slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id } }],
});

const context: CapabilityContext = { userId: 'user-1', agentId: 'agent-1' };
const capability = new SuggestResourceCapability();

describe('the capability', () => {
  it('is the slug the seed advertises, and processes no PII', () => {
    expect(capability.slug).toBe(SUGGEST_RESOURCE_SLUG);
    expect(capability.functionDefinition.name).toBe(SUGGEST_RESOURCE_SLUG);
    expect(capability.processesPii).toBe(false);
  });

  it('answers a video with the library’s own words', async () => {
    const result = await capability.execute(capability.validate({ id: 'on-stalling' }), context);

    expect(result).toEqual({
      success: true,
      data: {
        id: 'on-stalling',
        kind: 'video',
        title: 'On stalling',
        subtitle: 'why the words you avoid are the work',
        length: '5:04',
      },
    });
  });

  it('answers an article, with its reading time as its length', async () => {
    const result = await capability.execute(capability.validate({ id: 'evidence' }), context);

    expect(result).toMatchObject({
      success: true,
      data: { id: 'evidence', kind: 'article', length: '6 min' },
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
  it('finds a resource by id and nothing by a title', async () => {
    expect((await findResource('on-stalling'))?.kind).toBe('video');
    expect(await findResource('On stalling')).toBeNull();
  });

  it('reads one off a live result, and nothing off a refusal or a stranger', async () => {
    const live = { success: true, data: await findResource('evidence') };
    expect(suggestionFromResult(live)).toEqual(await findResource('evidence'));
    expect(suggestionFromResult({ success: false, error: { code: 'x', message: 'y' } })).toBeNull();
    expect(suggestionFromResult({ success: true, data: { chunks: [] } })).toBeNull();
    expect(suggestionFromResult(null)).toBeNull();
  });

  it('rebuilds them from a stored turn’s traces, in order, answered calls only', async () => {
    const library = await getResourcesLibrary();
    const provenance = {
      capabilityCalls: [
        { slug: 'search_knowledge_base', success: true, arguments: { query: 'x' } },
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'evidence' } },
        { slug: SUGGEST_RESOURCE_SLUG, success: false, arguments: { id: 'nope' } },
        // The trace keeps the RAW argument; a padded id answered live, so it
        // must resolve here too.
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: ' on-stalling ' } },
        // A resource the library no longer has: no chip to nowhere.
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'removed-since' } },
        'not a trace',
      ],
    };

    expect(suggestionsFromProvenance(provenance, library).map((s) => s.id)).toEqual([
      'evidence',
      'on-stalling',
    ]);
    expect(suggestionsFromProvenance(null, library)).toEqual([]);
    // Twice for the same id — a retry after a refusal — is one offer.
    expect(
      suggestionsFromProvenance(
        {
          capabilityCalls: [
            { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'evidence' } },
            { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'evidence' } },
          ],
        },
        library
      ).map((s) => s.id)
    ).toEqual(['evidence']);
    expect(suggestionsFromProvenance({ citations: [] }, library)).toEqual([]);
  });
});

describe('the rows are what is read (t-87)', () => {
  it('the tool answers with the row as it stands, not as the file wrote it', async () => {
    store.editResource('on-stalling', { title: 'On stalling, edited' });

    const result = await capability.execute(capability.validate({ id: 'on-stalling' }), context);

    expect(result).toMatchObject({ success: true, data: { title: 'On stalling, edited' } });
  });

  it('a reload rebuilds the chip from the row as it stands', async () => {
    store.editResource('evidence', { title: 'Evidence, edited' });

    const library = await loadLibraryForChips([suggested('evidence')]);

    expect(suggestionsFromProvenance(suggested('evidence'), library)).toEqual([
      expect.objectContaining({ id: 'evidence', title: 'Evidence, edited' }),
    ]);
  });

  it('reads the library once for many turns, and not at all when nothing was suggested', async () => {
    await loadLibraryForChips([suggested('evidence'), suggested('on-stalling'), null]);
    expect(store.getResourcesLibrary).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    await expect(loadLibraryForChips([null, { citations: [] }])).resolves.toBeNull();
    expect(store.getResourcesLibrary).not.toHaveBeenCalled();
  });

  it('shows no chips rather than failing, when the library cannot be read', async () => {
    store.empty();

    const library = await loadLibraryForChips([suggested('evidence')]);

    expect(library).toBeNull();
    expect(suggestionsByCall(suggested('evidence'), library)).toEqual([null]);
  });

  it('keeps a replay’s chips aligned with its calls', async () => {
    const library: ResourcesLibrary = await getResourcesLibrary();
    const provenance = {
      capabilityCalls: [
        { slug: 'search_knowledge_base', success: true, arguments: { query: 'x' } },
        { slug: SUGGEST_RESOURCE_SLUG, success: true, arguments: { id: 'evidence' } },
      ],
    };

    expect(suggestionsByCall(provenance, library).map((s) => s?.id ?? null)).toEqual([
      null,
      'evidence',
    ]);
  });
});
