/**
 * `ensureJourneyStarted` — starting a person's journey when they pass the gate
 * (§15, t-102).
 *
 * Every framework call is mocked: this proves the order, the arguments and the
 * guards. That the engine really accepts the `enter` on the real published map
 * is `npm run smoke:app-onboarding`, against the dev database.
 *
 * @see lib/app/journey/start.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getJourney: vi.fn(),
  getNodeStates: vi.fn(),
  createJourney: vi.fn(),
  applyJourneyTransition: vi.fn(),
  getPublishedMapVersion: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/journey/queries', () => ({
  getJourney: mocks.getJourney,
  getNodeStates: mocks.getNodeStates,
}));
vi.mock('@/lib/framework/facilitation/journey/create', () => ({
  createJourney: mocks.createJourney,
}));
vi.mock('@/lib/framework/guidance/guidance', () => ({
  applyJourneyTransition: mocks.applyJourneyTransition,
}));
vi.mock('@/lib/framework/facilitation/map/version-service', () => ({
  getPublishedMapVersion: mocks.getPublishedMapVersion,
}));

import { ensureJourneyStarted } from '@/lib/app/journey/start';
import { JOURNEY_MAP_SLUG, ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';

const USER = 'user_1';
const JOURNEY = { id: 'journey_1', userId: USER, graphSlug: JOURNEY_MAP_SLUG, contextKey: '' };
const ENTERED = { ok: true, nodeState: { nodeKey: ONBOARDING_NODE_KEY }, event: {} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJourney.mockResolvedValue(null);
  mocks.getNodeStates.mockResolvedValue([]);
  mocks.createJourney.mockResolvedValue(JOURNEY);
  mocks.applyJourneyTransition.mockResolvedValue(ENTERED);
  mocks.getPublishedMapVersion.mockResolvedValue(2);
});

describe('ensureJourneyStarted', () => {
  it('creates the journey on the published map and enters onboarding, as the person', async () => {
    await expect(ensureJourneyStarted(USER)).resolves.toBe('started');

    const viewer = { userId: USER };
    const key = { userId: USER, graphSlug: JOURNEY_MAP_SLUG };
    expect(mocks.createJourney).toHaveBeenCalledWith(viewer, key);
    expect(mocks.applyJourneyTransition).toHaveBeenCalledWith(viewer, key, {
      nodeKey: 'onboarding',
      kind: 'enter',
    });
    // Created before it is entered: the transition needs the row.
    expect(mocks.createJourney.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applyJourneyTransition.mock.invocationCallOrder[0]
    );
  });

  it('starts it on the slug it checked is published, which is the slug the seed publishes', async () => {
    await ensureJourneyStarted(USER);

    const checked = mocks.getPublishedMapVersion.mock.calls[0]?.[0];
    const created = mocks.createJourney.mock.calls[0]?.[1].graphSlug;
    expect(checked).toBe(created);
    // The constant the seed publishes under — pinned on that side by
    // tests/unit/prisma/seeds/app-lelanea/journey-map.test.ts. A second slug
    // here would start journeys on a map nobody publishes: silently inert.
    expect(created).toBe(JOURNEY_MAP_SLUG);
  });

  it('writes nothing when the journey has been entered before', async () => {
    mocks.getJourney.mockResolvedValue(JOURNEY);
    mocks.getNodeStates.mockResolvedValue([{ nodeKey: 'values', status: 'active' }]);

    await expect(ensureJourneyStarted(USER)).resolves.toBe('already');

    expect(mocks.getNodeStates).toHaveBeenCalledWith(
      { userId: USER },
      { journeyId: JOURNEY.id, subject: USER }
    );
    // Not re-entered: someone in Values must not be moved back to onboarding,
    // and every accepted enter appends an event.
    expect(mocks.createJourney).not.toHaveBeenCalled();
    expect(mocks.applyJourneyTransition).not.toHaveBeenCalled();
  });

  it('enters onboarding on a journey that exists but was never entered, without re-creating it', async () => {
    mocks.getJourney.mockResolvedValue(JOURNEY);

    await expect(ensureJourneyStarted(USER)).resolves.toBe('started');

    expect(mocks.createJourney).not.toHaveBeenCalled();
    expect(mocks.applyJourneyTransition).toHaveBeenCalledTimes(1);
  });

  it('creates no journey while the map is unpublished', async () => {
    mocks.getPublishedMapVersion.mockResolvedValue(null);

    await expect(ensureJourneyStarted(USER)).resolves.toBe('unpublished');

    expect(mocks.getPublishedMapVersion).toHaveBeenCalledWith(JOURNEY_MAP_SLUG);
    expect(mocks.createJourney).not.toHaveBeenCalled();
    expect(mocks.applyJourneyTransition).not.toHaveBeenCalled();
  });

  it('answers failed when the engine refuses the enter', async () => {
    mocks.applyJourneyTransition.mockResolvedValue({
      ok: false,
      rejection: { code: 'not_available', message: 'Node "onboarding" is not available to enter.' },
    });

    await expect(ensureJourneyStarted(USER)).resolves.toBe('failed');
  });

  it('answers failed when the journey vanished before the enter', async () => {
    mocks.applyJourneyTransition.mockResolvedValue(null);

    await expect(ensureJourneyStarted(USER)).resolves.toBe('failed');
  });

  it('never throws: a framework error is answered as failed', async () => {
    mocks.createJourney.mockRejectedValue(new Error('connection reset'));

    await expect(ensureJourneyStarted(USER)).resolves.toBe('failed');
    expect(mocks.applyJourneyTransition).not.toHaveBeenCalled();
  });
});
