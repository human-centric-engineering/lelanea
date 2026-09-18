/**
 * The seam registers exactly two contributors, both her voice block: one keyed
 * on a situation (`voice`), one on a facilitation seat (`facilitation`).
 *
 * `tests/unit/lib/app/defaults.test.ts` pins this seam against the shared
 * registry, which tells you WHICH TYPE was added. This file is the other half:
 * it mocks the registrar, so how many registrations there are and which function
 * is behind each can be asserted directly — the same division the
 * knowledge-access seam's test makes, for the same reason.
 *
 * It matters because the registry is keyed by `contextType` across all three
 * tiers and **re-registering a type REPLACES the prior loader**. A second
 * registration here — by a later feature, or by a bad merge — would silently
 * take a type away from whoever registered it first, and nothing else in the
 * suite would notice: the symptom is a chat turn quietly carrying a different
 * block, with no error anywhere.
 *
 * The behavioural half (that the registration actually reaches `buildContext`,
 * and what the block says) is
 * `tests/unit/lib/app/voice/context-contributor.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/context-contributors.ts`
 * ---------------------------------------------------------------------------
 * The registrar is mocked; the SEAM is not. That is the point of the file — it
 * asserts what Lelañea's own seam registers — but it means the expectations
 * below are ours, not the platform's.
 *
 * **What a fork should expect.** Upstream that seam is empty: `initApp…()`
 * registers nothing, so `registered` is `[]` and every case here fails with
 * nothing to read. That failure is the seam being unfilled, not a defect.
 *
 * **What to do.** Pin YOUR contributors here rather than deleting the cases, and
 * keep the count assertion whatever you register — it is the only thing in the
 * suite that catches a second registration arriving by accident. If your fork
 * deliberately registers none, assert `[]` explicitly instead of removing the
 * case: an empty registry asserted is evidence, and an absent test is not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const registered: Array<[string, unknown]> = [];

vi.mock('@/lib/orchestration/chat/context-builder', () => ({
  registerContextContributor: vi.fn((type: string, loader: unknown) => {
    registered.push([type, loader]);
  }),
}));

import { initAppContextContributors } from '@/lib/app/context-contributors';
import {
  FACILITATION_CONTEXT_TYPE,
  VOICE_CONTEXT_TYPE,
  loadFacilitationVoiceContext,
  loadVoiceContext,
} from '@/lib/app/voice/context-contributor';

beforeEach(() => {
  registered.length = 0;
});

describe('initAppContextContributors', () => {
  it('registers two contributors: voice, and the facilitation seats (§08 t-54)', () => {
    initAppContextContributors();

    expect(registered.map(([type]) => type)).toEqual([
      VOICE_CONTEXT_TYPE,
      FACILITATION_CONTEXT_TYPE,
    ]);
  });

  it('registers the voice loaders themselves, not some other function', () => {
    initAppContextContributors();

    // By identity: a type assertion alone passes if the type is right and the
    // function behind it is not.
    expect(registered[0]?.[1]).toBe(loadVoiceContext);
    expect(registered[1]?.[1]).toBe(loadFacilitationVoiceContext);
  });

  it('does not claim a type another tier already owns', () => {
    // Sunrise's built-in `pattern` case takes precedence over any contributor,
    // so registering it would be dead code that reads as a live registration.
    // Daybreak's `module` is the live one that MATTERS: re-registering it here
    // would replace the framework's loader from the leaf, which is the same
    // mistake as filling one of Daybreak's `lib/app/*` bridges — it works until
    // the next sync, and then it does not.
    initAppContextContributors();

    expect(registered.map(([type]) => type)).not.toContain('pattern');
    expect(registered.map(([type]) => type)).not.toContain('module');
  });

  it('registers a type a route can actually pin, so it survives the wire', () => {
    // A `contextType` is client-facing: it travels on the chat request and is
    // validated as `z.string().max(50)`. A key with a space, a colon or a
    // hundred characters would be authored here and unreachable in practice, and
    // the failure is silent — every turn falls back to "no context loader".
    expect(VOICE_CONTEXT_TYPE).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(VOICE_CONTEXT_TYPE.length).toBeLessThanOrEqual(50);
  });
});
