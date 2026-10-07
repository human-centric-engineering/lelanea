/**
 * `search_person_memory`'s mapping of a journey hit (f-journey-record t-149):
 * a synopsis reads as a kept account, an own entry as the person's own
 * journal words, and either is cut when it runs long. `searchMemory` itself
 * is mocked here — what it returns, and under what rule, is
 * `tests/unit/lib/app/memory/journey-index.test.ts`'s job; this file only
 * proves the capability maps a `JourneyEntryHit` correctly.
 *
 * @see lib/app/memory/search-capability.ts
 */

import { describe, it, expect, vi } from 'vitest';

import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';
import type { MemoryHit } from '@/lib/app/memory/memory-index';

const { searchMemory } = vi.hoisted(() => ({ searchMemory: vi.fn() }));
vi.mock('@/lib/app/memory/memory-index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/memory/memory-index')>();
  return { ...actual, searchMemory };
});
// `execute` also reads the turn's own message id (`turnMessageId`) to exclude
// it from the search; this capability's call shape for that, not what it
// resolves to, so a turn is never found and nothing is excluded.
vi.mock('@/lib/db/client', () => ({
  prisma: { appTurn: { findUnique: vi.fn(async () => null) } },
}));

const {
  SearchPersonMemoryCapability,
  whoseAccount,
  whoseEntry,
  spokenDate,
  MAX_REMEMBERED_ENTRY_CHARS,
} = await import('@/lib/app/memory/search-capability');

const ME = 'user-me';
const SEAT = 'facilitation';

function context(): CapabilityContext {
  return {
    userId: ME,
    agentId: 'agent-guide',
    conversationId: `conv-${ME}-${SEAT}`,
    costLogMetadata: { turnId: 'turn-1', seat: 'facilitator' },
  };
}

function journeyHit(overrides: Partial<MemoryHit> = {}): MemoryHit {
  return {
    sourceKind: 'own_entry',
    sourceId: 'entry-1',
    text: 'Walked by the lake and thought about my father.',
    occurredAt: new Date('2026-10-01T09:00:00Z'),
    distance: 0.1,
    ...overrides,
  } as MemoryHit;
}

describe('a kept account (t-149)', () => {
  it('labels a synopsis hit as a kept account, with the sentence that says it may not be their exact words', async () => {
    searchMemory.mockResolvedValue([journeyHit({ sourceKind: 'synopsis', text: 'The account.' })]);
    const tool = new SearchPersonMemoryCapability();

    const result = await tool.execute({ query: 'lake' }, context());

    const when = spokenDate(new Date('2026-10-01T09:00:00Z'));
    expect(result.data?.results).toEqual([
      { kind: 'kept_account', words: 'The account.', when, whose: whoseAccount(when) },
    ]);
  });
});

describe('their own words in the journey (t-149)', () => {
  it('labels an own-entry hit as their own journal words, with the sentence that says to quote it only as theirs', async () => {
    searchMemory.mockResolvedValue([
      journeyHit({ sourceKind: 'own_entry', text: 'Woke at three, thinking of him.' }),
    ]);
    const tool = new SearchPersonMemoryCapability();

    const result = await tool.execute({ query: 'woke' }, context());

    const when = spokenDate(new Date('2026-10-01T09:00:00Z'));
    expect(result.data?.results).toEqual([
      {
        kind: 'their_entry',
        words: 'Woke at three, thinking of him.',
        when,
        whose: whoseEntry(when),
      },
    ]);
  });
});

describe('a long entry is cut, never dropped', () => {
  it('cuts the words at MAX_REMEMBERED_ENTRY_CHARS and marks the cut, for both an own entry and a kept account', async () => {
    const long = 'x'.repeat(MAX_REMEMBERED_ENTRY_CHARS + 500);
    searchMemory.mockResolvedValue([
      journeyHit({ sourceKind: 'own_entry', sourceId: 'long-entry', text: long }),
      journeyHit({ sourceKind: 'synopsis', sourceId: 'long-account', text: long }),
    ]);
    const tool = new SearchPersonMemoryCapability();

    const result = await tool.execute({ query: 'x' }, context());
    const [entry, account] = result.data?.results ?? [];

    expect(entry?.words.length).toBeLessThan(long.length);
    expect(entry?.words.startsWith('x'.repeat(MAX_REMEMBERED_ENTRY_CHARS))).toBe(true);
    expect(entry?.words.endsWith('…')).toBe(true);
    expect(account?.words.length).toBeLessThan(long.length);
    expect(account?.words.endsWith('…')).toBe(true);
  });

  it('leaves text at or under the limit untouched', async () => {
    const exact = 'y'.repeat(MAX_REMEMBERED_ENTRY_CHARS);
    searchMemory.mockResolvedValue([journeyHit({ text: exact })]);
    const tool = new SearchPersonMemoryCapability();

    const result = await tool.execute({ query: 'y' }, context());

    expect(result.data?.results[0]?.words).toBe(exact);
  });
});
