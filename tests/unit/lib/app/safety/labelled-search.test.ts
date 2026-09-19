/**
 * Her search results say whose material each passage is (f-safety t-60).
 *
 * Asserted on what the MODEL reads, not on the capability's return value. The
 * result goes through the platform's real `extractCitations`, the step that
 * turns it into the tool message the chat handler sends back, and the test
 * reads the serialised message. A label the citation step dropped would pass a
 * test written against the envelope and never reach her.
 *
 * The platform's search and access resolver are mocked (no database, no
 * embedding). Everything between them and the tool message is real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  access: vi.fn(),
  agent: vi.fn(),
  documents: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiAgent: { findUnique: mocks.agent },
    aiKnowledgeDocument: { findMany: mocks.documents },
  },
}));
vi.mock('@/lib/orchestration/knowledge/search', () => ({
  searchKnowledgeWithEmbedding: mocks.search,
}));
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  resolveAgentDocumentAccess: mocks.access,
}));

import {
  LabelledSearchKnowledgeCapability,
  RESULT_ORIGINS,
} from '@/lib/app/safety/labelled-search';
import { SearchKnowledgeCapability } from '@/lib/orchestration/capabilities/built-in/search-knowledge';
import { extractCitations } from '@/lib/orchestration/chat/citations';

function hit(documentId: string, documentName: string, content: string) {
  return {
    chunk: {
      id: `chunk-${documentId}`,
      documentId,
      content,
      patternNumber: null,
      patternName: null,
      section: null,
    },
    documentName,
    documentContentHash: null,
    similarity: 0.9,
  };
}

const HERS = hit('doc-hers', 'The Mission', 'Remembering is not becoming.');
const PLATFORM = hit('doc-platform', 'Agentic Design Patterns', 'Reflection is a pattern where…');

const CONTEXT = { agentId: 'agent-her', userId: 'user-1' };

/** What the two document lookups find: her designated corpus, and the platform's. */
const corpus = { quotable: [] as string[], system: [] as string[] };

/** The tool message the chat handler would send her, parsed back. */
function toolMessage(result: unknown): Array<Record<string, unknown>> {
  const { augmentedResult } = extractCitations('search_knowledge_base', result, 1);
  const parsed: unknown = JSON.parse(JSON.stringify(augmentedResult));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('data' in parsed) ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    !('results' in parsed.data) ||
    !Array.isArray(parsed.data.results)
  ) {
    throw new Error('not a search envelope');
  }
  return parsed.data.results as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    mode: 'restricted',
    documentIds: ['doc-hers'],
    includeSystemScope: true,
  });
  mocks.search.mockResolvedValue({
    results: [HERS, PLATFORM],
    embedding: { model: 'm', provider: 'p', inputTokens: 1, costUsd: 0 },
  });
  mocks.agent.mockResolvedValue({ slug: 'lelanea-guide' });
  corpus.quotable = ['doc-hers'];
  corpus.system = ['doc-platform'];
  mocks.documents.mockImplementation(
    async ({ where }: { where: { scope: string; id?: { in: string[] } } }) => {
      const ids = where.scope === 'system' ? corpus.system : corpus.quotable;
      return ids.filter((id) => !where.id || where.id.in.includes(id)).map((id) => ({ id }));
    }
  );
});

describe('for her', () => {
  it('labels every passage by origin, in the message the model reads', async () => {
    const result = await new LabelledSearchKnowledgeCapability().execute(
      { query: 'remembering' },
      CONTEXT
    );
    const passages = toolMessage(result);

    expect(passages.map((p) => [p.documentName, p.content, p.origin, p.marker])).toEqual([
      ['The Mission', 'Remembering is not becoming.', RESULT_ORIGINS.hers, 1],
      ['Agentic Design Patterns', 'Reflection is a pattern where…', RESULT_ORIGINS.notHers, 2],
    ]);
  });

  it("labels only the platform's corpus not-hers, and only her designated corpus hers", async () => {
    corpus.quotable = [];
    const passages = toolMessage(
      await new LabelledSearchKnowledgeCapability().execute({ query: 'x' }, CONTEXT)
    );
    expect(passages.map((p) => p.origin)).toEqual([
      RESULT_ORIGINS.unverified,
      RESULT_ORIGINS.notHers,
    ]);
  });

  it('does not disown a document she reaches another way — it is unverified, not "not hers"', async () => {
    // An app document an operator granted her agent directly: in her access
    // set, not in her designated corpus, not the platform's.
    mocks.search.mockResolvedValue({
      results: [hit('doc-granted', 'Session notes', 'Something granted to her.')],
      embedding: { model: 'm', provider: 'p', inputTokens: 1, costUsd: 0 },
    });
    const passages = toolMessage(
      await new LabelledSearchKnowledgeCapability().execute({ query: 'x' }, CONTEXT)
    );
    expect(passages.map((p) => p.origin)).toEqual([RESULT_ORIGINS.unverified]);
  });

  it('marks every passage unverified when her material cannot be read, and still returns them', async () => {
    mocks.documents.mockRejectedValue(new Error('db down'));
    const passages = toolMessage(
      await new LabelledSearchKnowledgeCapability().execute({ query: 'x' }, CONTEXT)
    );
    expect(passages.map((p) => p.origin)).toEqual([
      RESULT_ORIGINS.unverified,
      RESULT_ORIGINS.unverified,
    ]);
  });
});

describe('for any other agent', () => {
  it("returns the platform's result unchanged", async () => {
    mocks.agent.mockResolvedValue({ slug: 'pattern-advisor' });
    const labelled = await new LabelledSearchKnowledgeCapability().execute({ query: 'x' }, CONTEXT);
    const plain = await new SearchKnowledgeCapability().execute({ query: 'x' }, CONTEXT);

    expect(labelled).toEqual(plain);
    expect(toolMessage(labelled).some((p) => 'origin' in p)).toBe(false);
    expect(mocks.documents).not.toHaveBeenCalled();
  });
});

describe('what it does not change', () => {
  it('is the same tool: slug, schema and description the model is offered', () => {
    const labelled = new LabelledSearchKnowledgeCapability();
    const plain = new SearchKnowledgeCapability();
    expect(labelled.slug).toBe('search_knowledge_base');
    expect(labelled.functionDefinition).toEqual(plain.functionDefinition);
    expect(labelled.processesPii).toBe(false);
  });

  it('passes a failed search through untouched', async () => {
    mocks.access.mockResolvedValue({
      mode: 'restricted',
      documentIds: [],
      includeSystemScope: true,
    });
    const result = await new LabelledSearchKnowledgeCapability().execute(
      { query: 'x', document_id: '00000000-0000-4000-8000-000000000000' },
      CONTEXT
    );
    expect(result.success).toBe(false);
    expect(mocks.agent).not.toHaveBeenCalled();
  });
});
