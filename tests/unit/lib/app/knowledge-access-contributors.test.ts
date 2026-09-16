/**
 * The seam registers exactly one contributor, and it is the corpus rule.
 *
 * `tests/unit/lib/app/defaults.test.ts` asserts only that this seam's init
 * returns cleanly, because the resolver exports no way to read its registry back
 * and adding one would be an edit to a Sunrise-owned file for a test's
 * convenience. This file is the other half: it mocks the registry so WHICH
 * contributor is registered, under what key, and how many there are can all be
 * asserted directly.
 *
 * It matters because a contributor can only WIDEN a restricted agent's document
 * set. A second one registered here — by a later feature, or by a bad merge —
 * would silently add documents to every agent the first one already reaches, and
 * nothing else in the suite would notice.
 *
 * The behavioural half (that the registration actually reaches
 * `resolveAgentDocumentAccess`, and what it resolves to) is
 * `tests/unit/lib/app/voice/corpus-access.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/knowledge-access-contributors.ts`
 * ---------------------------------------------------------------------------
 * The registry is mocked; the SEAM is not. That is the point of the file — it
 * asserts what Lelañea's own seam registers — but it means the expectations
 * below are ours, not the platform's.
 *
 * **What a fork should expect.** Upstream that seam is empty: `initApp…()`
 * registers nothing, so `registered` is `[]` and every case here fails with
 * nothing to read. That failure is the seam being unfilled, not a defect.
 *
 * **What to do.** Pin YOUR contributors here rather than deleting the cases.
 * Keep the count assertion whatever you register, because it is the only thing
 * in the suite that catches a second contributor arriving by accident — and a
 * contributor can only WIDEN a restricted agent's document set, so an unnoticed
 * one silently adds documents to every agent the first already reaches. If your
 * fork deliberately registers none, assert `[]` explicitly instead of removing
 * the case: an empty registry asserted is evidence, and an absent test is not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const registered: Array<[string, unknown]> = [];

vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  registerAgentAccessContributor: vi.fn((key: string, contributor: unknown) => {
    registered.push([key, contributor]);
  }),
}));

import {
  CORPUS_ACCESS_CONTRIBUTOR,
  initAppKnowledgeAccessContributors,
} from '@/lib/app/knowledge-access-contributors';
import { contributeCorpusAccess } from '@/lib/app/voice/corpus-access';

beforeEach(() => {
  registered.length = 0;
});

describe('initAppKnowledgeAccessContributors', () => {
  it('registers one contributor, keyed for the corpus rule', () => {
    initAppKnowledgeAccessContributors();

    expect(registered.map(([key]) => key)).toEqual([CORPUS_ACCESS_CONTRIBUTOR]);
  });

  it('registers the corpus rule itself, not some other function', () => {
    initAppKnowledgeAccessContributors();

    // By identity: a key assertion alone passes if the key is right and the
    // function behind it is not.
    expect(registered[0]?.[1]).toBe(contributeCorpusAccess);
  });

  it('is namespaced, so it cannot collide with a framework or platform key', () => {
    // The registry is a Map keyed by string across all three tiers, and
    // re-registering a key REPLACES the prior contributor. An unprefixed
    // `corpus` would be a plausible name for Daybreak to use too, and the
    // collision would silently drop one tier's contribution.
    expect(CORPUS_ACCESS_CONTRIBUTOR).toMatch(/^lelanea:/);
  });
});
