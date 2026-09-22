/**
 * What a facilitation seat turn is actually handed: her voice AND the taxonomy
 * (§08 t-54; f-slots t-72, security review round 1).
 *
 * ## Why this file exists at all
 *
 * A chat request carries exactly ONE `(contextType, contextId)` tuple, so a turn
 * gets one contributor's block and no other. That makes "add the taxonomy" a
 * change to this loader rather than a second registration — and it makes the
 * composition worth a test of its own, because the failure mode is silent: a
 * loader that returned only one half would still produce a well-formed block,
 * and the missing half is a model that cannot see the 50 slots it is supposed to
 * fill (which is how the `special_category` masking came to be unreachable).
 *
 * `tests/unit/lib/app/context-contributors.test.ts` asserts the REGISTRATION.
 * This asserts what the registered function returns.
 *
 * @see lib/app/voice/context-contributor.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const getFacilitationBindingByRole = vi.fn();
const slotVocabulary = vi.fn();
const retrieveVoiceExemplarsSafely = vi.fn();
const selectOverlay = vi.fn();
// `context-contributor` selects from an already-read set since t-88, so this
// is the export it actually calls. `selectOverlay` stays mocked because other
// callers use it and a partial mock would let the real one through.
const selectOverlayFrom = vi.fn();

vi.mock('@/lib/app/content/voice-overlay-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeVoiceOverlayStore()
);

vi.mock('@/lib/framework/facilitation/agents/binding-queries', () => ({
  getFacilitationBindingByRole,
}));
vi.mock('@/lib/app/slots/vocabulary', () => ({ slotVocabulary }));
vi.mock('@/lib/app/voice/exemplars', () => ({ retrieveVoiceExemplarsSafely }));
vi.mock('@/lib/app/voice/overlays', () => ({ selectOverlay, selectOverlayFrom }));

const { loadFacilitationVoiceContext, loadVoiceContext } =
  await import('@/lib/app/voice/context-contributor');
const { VOICE_AGENT_SLUG } = await import('@/lib/app/voice/fingerprint');

const VOCABULARY = 'What you can already record about this person:\n- life_wealth: Money.';
const OVERLAY = {
  heading: 'Her register for this moment:',
  lines: ['Meet them where they are.'],
  exemplarQuery: 'first meeting',
};

beforeEach(() => {
  vi.clearAllMocks();
  getFacilitationBindingByRole.mockResolvedValue({ agent: { slug: VOICE_AGENT_SLUG } });
  slotVocabulary.mockResolvedValue(VOCABULARY);
  selectOverlay.mockReturnValue(OVERLAY);
  selectOverlayFrom.mockReturnValue(OVERLAY);
  retrieveVoiceExemplarsSafely.mockResolvedValue([]);
});

describe('a turn on one of her seats', () => {
  it('carries her register and the taxonomy in one body', async () => {
    const body = await loadFacilitationVoiceContext('onboarding');

    // Both halves, over a non-empty population — each mock really does return
    // something, so neither half passing is an accident of an empty string.
    expect(body).toContain('Meet them where they are.');
    expect(body).toContain('- life_wealth: Money.');
  });

  it('puts her register first, so the taxonomy reads as a list and not as a voice', async () => {
    const body = await loadFacilitationVoiceContext('onboarding');

    expect(body.indexOf('Meet them where they are.')).toBeLessThan(
      body.indexOf('- life_wealth: Money.')
    );
  });

  it('reads the taxonomy once per turn, not once per slot', async () => {
    await loadFacilitationVoiceContext('onboarding');

    expect(slotVocabulary).toHaveBeenCalledTimes(1);
  });

  it('still carries her voice when there is no taxonomy to offer', async () => {
    // An unseeded database, or a failed read. Losing the vocabulary must not
    // lose her register with it — and must not leave a dangling blank section.
    slotVocabulary.mockResolvedValue('');

    const body = await loadFacilitationVoiceContext('onboarding');

    expect(body).toContain('Meet them where they are.');
    expect(body.endsWith('\n')).toBe(false);
    expect(body).not.toMatch(/\n\n\n/);
  });
});

describe('a seat that is not hers', () => {
  it('is handed nothing — neither her voice nor what she is looking for', async () => {
    // Daybreak has six facilitation seats and the context type covers all of
    // them. A seat bound to another agent must not be given her register, and
    // equally must not be given our taxonomy: what that agent is looking for is
    // its own business.
    getFacilitationBindingByRole.mockResolvedValue({ agent: { slug: 'someone-elses-agent' } });

    expect(await loadFacilitationVoiceContext('onboarding')).toBe('');
    expect(slotVocabulary).not.toHaveBeenCalled();
  });

  it('is handed nothing when no agent is bound at all', async () => {
    getFacilitationBindingByRole.mockResolvedValue(null);

    expect(await loadFacilitationVoiceContext('onboarding')).toBe('');
  });
});

describe('the admin voice path', () => {
  it('carries the taxonomy too, because it talks to an agent that can write', async () => {
    // The first cut deliberately withheld it here, to keep a 2,000-token block
    // out of what the voice comparison measures. That reasoning was wrong:
    // `comparison.ts` sends no `contextType`, so no contributor runs on the
    // golden-set path at all — while the admin orchestration chat, which DOES
    // pin `voice`, was left talking to an agent holding `fill_slot` with no
    // list in front of it. It minted there, and a mint is never masked. Found
    // by /code-review.
    const body = await loadVoiceContext('first-meeting');

    expect(body).toContain('Meet them where they are.');
    expect(body).toContain('- life_wealth: Money.');
  });
});
