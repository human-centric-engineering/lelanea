/**
 * Everything readable stays readable when she cannot answer (§08 t-55;
 * product description §8.1).
 *
 * The authored-content routes and the journey map are what a person reads
 * between conversations. They must answer normally in both of the conditions
 * that stop her: the model unreachable, and an operator's pause. Each case sets
 * the condition up for real first — the flag store answers "paused", the
 * provider layer throws on every lookup — and asserts it holds, so a 200 below
 * is a 200 *under* it, not a 200 in a world where nothing was wrong.
 *
 * The journey map runs the real projection over the real module registry
 * (filled by `initLeafApp()`), with only the framework's published-map DB read
 * mocked, as `tests/unit/lib/app/journey/map.test.ts` does. The content routes
 * run as shipped. What no unit test can show — the same routes answering from a
 * running server with her model pointed at an unreachable endpoint — is in
 * `scripts/app/smoke-turn.ts`.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/leaf-bootstrap` seam
 * ---------------------------------------------------------------------------
 * `initLeafApp()` registers Lelañea's modules so the journey map projects for
 * real. A fork with a different journey, or none, changes what that route
 * answers here; pin its own routes and statuses in `ALL_OK`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const world = vi.hoisted(() => ({ paused: false }));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
const { getPublishedMap } = vi.hoisted(() => ({ getPublishedMap: vi.fn() }));
vi.mock('@/lib/framework/facilitation/map/version-service', () => ({ getPublishedMap }));
vi.mock('@/lib/orchestration/llm/provider-manager', async (importOriginal) => {
  const unreachable = (): Promise<never> =>
    Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9 — the model is unreachable'));
  return {
    ...(await importOriginal<typeof import('@/lib/orchestration/llm/provider-manager')>()),
    getProvider: vi.fn(unreachable),
    getProviderWithFallbacks: vi.fn(unreachable),
  };
});
vi.mock('@/lib/db/client', () => ({
  prisma: {
    appWaitlistEntry: { findMany: vi.fn(async () => []) },
    featureFlag: { findUnique: vi.fn(async () => ({ enabled: world.paused })) },
  },
}));

import { GET as documentsIndex } from '@/app/api/v1/app/content/documents/route';
import { GET as documentById } from '@/app/api/v1/app/content/documents/[id]/route';
import { GET as journeyStructure } from '@/app/api/v1/app/content/journey-structure/route';
import { GET as discoveryQuestions } from '@/app/api/v1/app/content/discovery-questions/route';
import { GET as resourcesLibrary } from '@/app/api/v1/app/content/resources/route';
import { GET as resourcesForKey } from '@/app/api/v1/app/content/resources/[key]/route';
import { GET as journeyMap } from '@/app/api/v1/app/journey/map/route';
import { auth } from '@/lib/auth/config';
import { isGenerationPaused } from '@/lib/app/agent/availability';
import { getProvider } from '@/lib/orchestration/llm/provider-manager';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { JOURNEY_MAP_SLUG, buildJourneyMapDefinition } from '@/lib/app/journey/map-definition';
import { __resetModuleRegistryForTests } from '@/lib/framework/modules/registry';
import { __resetErasureCleanupHooksForTests } from '@/lib/privacy/erasure-hooks';

// A real request rather than a `{ headers, url }` stand-in: the resources
// selection route reads `nextUrl.searchParams` for its `?pin=`, and a
// stand-in without `nextUrl` would fail it for a reason nothing here is about.
function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

function memberSession() {
  const now = new Date();
  return {
    session: {
      id: 'session_test',
      userId: 'user_test',
      token: 'token',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: 'user_test',
      name: 'Test Member',
      email: 'member@example.com',
      emailVerified: true,
      image: null,
      role: 'USER' as const,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Every read route, called as a member would call it. */
async function readEverything(): Promise<Record<string, number>> {
  const responses = {
    'content/documents': await documentsIndex(request('/api/v1/app/content/documents')),
    'content/documents/:id': await documentById(
      request('/api/v1/app/content/documents/the_mission'),
      { params: Promise.resolve({ id: 'the_mission' }) }
    ),
    'content/journey-structure': await journeyStructure(
      request('/api/v1/app/content/journey-structure')
    ),
    'content/discovery-questions': await discoveryQuestions(
      request('/api/v1/app/content/discovery-questions')
    ),
    'content/resources': await resourcesLibrary(request('/api/v1/app/content/resources')),
    'content/resources/:key': await resourcesForKey(
      request('/api/v1/app/content/resources/values'),
      { params: Promise.resolve({ key: 'values' }) }
    ),
    'journey/map': await journeyMap(request('/api/v1/app/journey/map')),
  };
  return Object.fromEntries(
    Object.entries(responses).map(([route, response]) => [route, response.status])
  );
}

const ALL_OK = {
  'content/documents': 200,
  'content/documents/:id': 200,
  'content/journey-structure': 200,
  'content/discovery-questions': 200,
  'content/resources': 200,
  'content/resources/:key': 200,
  'journey/map': 200,
};

beforeEach(async () => {
  vi.clearAllMocks();
  world.paused = false;
  vi.mocked(auth.api.getSession).mockResolvedValue(memberSession());
  __resetModuleRegistryForTests();
  __resetErasureCleanupHooksForTests();
  await initLeafApp();
  getPublishedMap.mockResolvedValue({
    slug: JOURNEY_MAP_SLUG,
    version: 1,
    definition: buildJourneyMapDefinition(),
  });
});

describe('with her model unreachable', () => {
  it('every read route answers 200', async () => {
    // The condition, established: asking for her provider fails.
    await expect(getProvider('openai')).rejects.toThrow(/unreachable/);

    await expect(readEverything()).resolves.toEqual(ALL_OK);
  });
});

describe('with generation paused', () => {
  it('every read route answers 200', async () => {
    world.paused = true;
    // The condition, established: the switch reads as on.
    await expect(isGenerationPaused()).resolves.toBe(true);

    await expect(readEverything()).resolves.toEqual(ALL_OK);
  });
});
