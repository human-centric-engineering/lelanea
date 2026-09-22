/**
 * In-memory stand-ins for the journey, question and resource stores, holding
 * exactly the rows the seeds write (f-content-seeds t-87).
 *
 * The same idea as `tests/helpers/app/foundational-documents.ts`. Each fake is
 * built from the REAL file through the REAL seed builder and the REAL row
 * projection, so a page, route or turn test still sees her actual words. Only
 * the query is replaced. A test that wants to prove the database is what gets
 * read edits a row, and asserts that the change is what renders.
 *
 * Use them from `vi.mock` factories, which are hoisted, so import dynamically:
 *
 * ```ts
 * vi.mock('@/lib/app/content/journey-store', async () =>
 *   (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
 * );
 * import { fakeJourneyStore } from '@/tests/helpers/app/content-stores';
 * beforeEach(() => fakeJourneyStore().reset());
 * ```
 *
 * One instance of each per test file (Vitest gives each file its own module
 * registry), so the mock and the test's own import are the same object. The
 * resource fake's `selectResourcesFor` reads the journey fake, so a module
 * title edited there is the title the drawer's selection names.
 */

import { vi } from 'vitest';
import { ContentNotSeededError } from '@/lib/app/content/document-view';
import { buildJourneySeed } from '@/lib/app/content/journey-seed';
import {
  toJourneyStructure,
  type JourneyModuleRow,
  type JourneyRow,
  type JourneyTierRow,
} from '@/lib/app/content/journey-view';
import { buildQuestionSeed } from '@/lib/app/content/question-seed';
import {
  toQuestionSet,
  type DiscoveryQuestionRow,
  type QuestionSetRow,
} from '@/lib/app/content/question-view';
import { buildResourcesSeed } from '@/lib/app/content/resources-seed';
import {
  toFilm,
  toReading,
  toResourcesLibrary,
  type ResourceCollectionRow,
  type ResourceRow,
  type ResourceWordsRow,
} from '@/lib/app/content/resource-view';
import { selectResources } from '@/lib/app/content/resources';

// ============================================================================
// The journey
// ============================================================================

/** The rows seed 016 writes, at revision 1. */
export function seededJourneyRows(): {
  journey: JourneyRow;
  tiers: JourneyTierRow[];
  modules: JourneyModuleRow[];
} {
  const seed = buildJourneySeed();
  return {
    journey: seed.journey,
    tiers: seed.tiers.map((tier) => ({ ...tier, revision: 1 })),
    modules: seed.modules.map((entry) => ({ ...entry, revision: 1 })),
  };
}

export function createFakeJourneyStore() {
  let state: ReturnType<typeof seededJourneyRows> | null = seededJourneyRows();

  const current = () => {
    if (!state)
      throw new ContentNotSeededError('No journey in the database', '016-journey-structure.ts');
    return toJourneyStructure(state.journey, state.tiers, state.modules);
  };

  return {
    TIER_SNAPSHOT_FIELDS: [] as const,
    MODULE_SNAPSHOT_FIELDS: [] as const,
    getJourneyStructure: vi.fn(async () => current()),
    seedJourneyStructure: vi.fn(),

    // ---- Test controls. Not part of the real module. ----

    /** Back to exactly what the seed writes. Call from `beforeEach`. */
    reset(): void {
      state = seededJourneyRows();
    },
    /** An environment the seed never ran against. */
    empty(): void {
      state = null;
    },
    /** Change one module's row, as an admin edit would, and bump its revision. */
    editModule(id: string, patch: Partial<Omit<JourneyModuleRow, 'id'>>): void {
      if (!state) throw new Error('The fake journey store is empty');
      if (!state.modules.some((row) => row.id === id)) throw new Error(`No seeded module "${id}"`);
      state = {
        ...state,
        modules: state.modules.map((row) =>
          row.id === id ? { ...row, ...patch, revision: row.revision + 1 } : row
        ),
      };
    },
    /** Change one tier's row and bump its revision. */
    editTier(id: string, patch: Partial<Omit<JourneyTierRow, 'id'>>): void {
      if (!state) throw new Error('The fake journey store is empty');
      if (!state.tiers.some((row) => row.id === id)) throw new Error(`No seeded tier "${id}"`);
      state = {
        ...state,
        tiers: state.tiers.map((row) =>
          row.id === id ? { ...row, ...patch, revision: row.revision + 1 } : row
        ),
      };
    },
    /** Change the journey row. */
    editJourney(patch: Partial<JourneyRow>): void {
      if (!state) throw new Error('The fake journey store is empty');
      state = { ...state, journey: { ...state.journey, ...patch } };
    },
  };
}

export type FakeJourneyStore = ReturnType<typeof createFakeJourneyStore>;
let journeyInstance: FakeJourneyStore | null = null;

/** The file's one fake journey store. See the module docblock. */
export function fakeJourneyStore(): FakeJourneyStore {
  journeyInstance ??= createFakeJourneyStore();
  return journeyInstance;
}

// ============================================================================
// The discovery questions
// ============================================================================

/** The rows seed 017 writes, at revision 1. */
export function seededQuestionRows(): { set: QuestionSetRow; questions: DiscoveryQuestionRow[] } {
  const seed = buildQuestionSeed();
  return {
    set: { ...seed.set, revision: 1 },
    questions: seed.questions.map((question) => ({ ...question, revision: 1 })),
  };
}

export function createFakeQuestionStore() {
  let state: ReturnType<typeof seededQuestionRows> | null = seededQuestionRows();

  return {
    DISCOVERY_QUESTION_SET_ID: 'onboarding_discovery_questions',
    QUESTION_SET_SNAPSHOT_FIELDS: [] as const,
    QUESTION_SNAPSHOT_FIELDS: [] as const,
    getDiscoveryQuestions: vi.fn(async () => {
      if (!state) {
        throw new ContentNotSeededError(
          'No discovery questions in the database',
          '017-discovery-questions.ts'
        );
      }
      return toQuestionSet(state.set, state.questions);
    }),
    seedDiscoveryQuestions: vi.fn(),

    // ---- Test controls. ----

    reset(): void {
      state = seededQuestionRows();
    },
    empty(): void {
      state = null;
    },
    /** Change one question's row and bump its revision. */
    editQuestion(id: string, patch: Partial<Omit<DiscoveryQuestionRow, 'id'>>): void {
      if (!state) throw new Error('The fake question store is empty');
      if (!state.questions.some((row) => row.id === id))
        throw new Error(`No seeded question "${id}"`);
      state = {
        ...state,
        questions: state.questions.map((row) =>
          row.id === id ? { ...row, ...patch, revision: row.revision + 1 } : row
        ),
      };
    },
  };
}

export type FakeQuestionStore = ReturnType<typeof createFakeQuestionStore>;
let questionInstance: FakeQuestionStore | null = null;

/** The file's one fake question store. */
export function fakeQuestionStore(): FakeQuestionStore {
  questionInstance ??= createFakeQuestionStore();
  return questionInstance;
}

// ============================================================================
// The resource library
// ============================================================================

/** The rows seed 018 writes, at revision 1. */
export function seededResourceRows(): {
  collection: ResourceCollectionRow;
  resources: ResourceRow[];
  words: ResourceWordsRow[];
} {
  const seed = buildResourcesSeed();
  return {
    collection: seed.collection,
    resources: seed.resources.map((row) => ({ ...row, revision: 1 })),
    words: seed.words.map((row) => ({ ...row, revision: 1 })),
  };
}

export function createFakeResourceStore() {
  let state: ReturnType<typeof seededResourceRows> | null = seededResourceRows();

  const library = () => {
    if (!state) {
      throw new ContentNotSeededError('No resource library in the database', '018-resources.ts');
    }
    return toResourcesLibrary(state.collection, state.resources, state.words);
  };

  return {
    RESOURCE_SNAPSHOT_FIELDS: [] as const,
    WORDS_SNAPSHOT_FIELDS: [] as const,
    getResourcesLibrary: vi.fn(async () => library()),
    getResource: vi.fn(async (id: string) => {
      const row = state?.resources.find((candidate) => candidate.id === id);
      if (!row) return null;
      return row.kind === 'film' ? toFilm(row) : toReading(row);
    }),
    selectResourcesFor: vi.fn(async (key: string, options: { pin?: string } = {}) =>
      selectResources(
        library(),
        (await fakeJourneyStore().getJourneyStructure()).modules,
        key,
        options
      )
    ),
    seedResources: vi.fn(),

    // ---- Test controls. ----

    reset(): void {
      state = seededResourceRows();
    },
    empty(): void {
      state = null;
    },
    /**
     * Add a film or a reading, as an admin would. `position` defaults to the
     * end of its kind.
     */
    addResource(row: Omit<ResourceRow, 'revision' | 'position'> & { position?: number }): void {
      if (!state) throw new Error('The fake resource store is empty');
      const position =
        row.position ?? state.resources.filter((candidate) => candidate.kind === row.kind).length;
      state = { ...state, resources: [...state.resources, { ...row, position, revision: 1 }] };
    },
    /** Change one resource's row and bump its revision. */
    editResource(id: string, patch: Partial<Omit<ResourceRow, 'id'>>): void {
      if (!state) throw new Error('The fake resource store is empty');
      if (!state.resources.some((row) => row.id === id)) throw new Error(`No resource "${id}"`);
      state = {
        ...state,
        resources: state.resources.map((row) =>
          row.id === id ? { ...row, ...patch, revision: row.revision + 1 } : row
        ),
      };
    },
    /** Change one key's words and bump their revision. */
    editWords(key: string, patch: Partial<Omit<ResourceWordsRow, 'key'>>): void {
      if (!state) throw new Error('The fake resource store is empty');
      if (!state.words.some((row) => row.key === key)) throw new Error(`No words for "${key}"`);
      state = {
        ...state,
        words: state.words.map((row) =>
          row.key === key ? { ...row, ...patch, revision: row.revision + 1 } : row
        ),
      };
    },
  };
}

export type FakeResourceStore = ReturnType<typeof createFakeResourceStore>;
let resourceInstance: FakeResourceStore | null = null;

/** The file's one fake resource store. */
export function fakeResourceStore(): FakeResourceStore {
  resourceInstance ??= createFakeResourceStore();
  return resourceInstance;
}

/** A film row the fake accepts, for tests that need the library to hold one. */
export function filmRow(
  id: string,
  overrides: Partial<Omit<ResourceRow, 'id' | 'kind' | 'revision' | 'position'>> = {}
): Omit<ResourceRow, 'revision' | 'position'> {
  return {
    id,
    kind: 'film',
    title: `Film ${id}`,
    subtitle: `What ${id} is for`,
    relatesTo: null,
    duration: '6:12',
    readingTime: null,
    href: 'https://example.com/film',
    documentId: null,
    ...overrides,
  };
}

/** A reading row that is one of her documents. */
export function readingRow(
  id: string,
  overrides: Partial<Omit<ResourceRow, 'id' | 'kind' | 'revision' | 'position'>> = {}
): Omit<ResourceRow, 'revision' | 'position'> {
  return {
    id,
    kind: 'reading',
    title: `Reading ${id}`,
    subtitle: `What ${id} is for`,
    relatesTo: null,
    duration: null,
    readingTime: '8 min',
    href: null,
    documentId: 'the_heart_behind_lelanea',
    ...overrides,
  };
}
