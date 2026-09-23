/**
 * Parity: `/api/v1/app/content/documents/:id` returns exactly the record the web
 * pages render from (f-content-seeds t-86).
 *
 * The pages call the document service directly rather than fetching their own
 * API — the owner's API-first ruling ("the API is the contract; composition
 * belongs to the client"). What makes that safe for a native client is this
 * test. For every document:
 *
 * - the API's `document` is deep-equal to what `requireDocument` — the call
 *   every page and both emails make — returns for the same row;
 * - it carries the same `version`, and an ETag computed over exactly that record;
 * - every section key a web surface selects by is in the API response, so
 *   nothing a page shows is absent from the API;
 * - a change to the row changes both, together.
 *
 * Both sides read the same fake store (the rows the real seed writes, through the
 * real projection), so a divergence can only come from the route or the page
 * path adding, dropping or reshaping something on the way.
 *
 * @see app/api/v1/app/content/documents/[id]/route.ts
 * @see lib/app/content/sections.ts — `requireDocument`
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);

import type { NextRequest } from 'next/server';
import { GET as getDocument } from '@/app/api/v1/app/content/documents/[id]/route';
import { GET as getIndex } from '@/app/api/v1/app/content/documents/route';
import { computeETag } from '@/lib/api/etag';
import { getFoundationalCollectionMeta } from '@/lib/app/content/document-store';
import { SECTION_KEYS } from '@/lib/app/content/seed-input/foundational-seed';
import { requireDocument } from '@/lib/app/content/sections';
import {
  fakeDocumentStore,
  rewriteSection,
  seededDocumentRows,
} from '@/tests/helpers/app/foundational-documents';

const store = fakeDocumentStore();
const DOCUMENT_IDS = seededDocumentRows().map((row) => row.id);

beforeEach(() => store.reset());

async function fromApi(id: string) {
  const response = await getDocument(
    {
      headers: new Headers(),
      url: `http://localhost:3000/api/v1/app/content/documents/${id}`,
    } as unknown as NextRequest,
    { params: Promise.resolve({ id }) }
  );
  // JSON is the wire. Parse it, so the comparison is against what a native
  // client receives, not against an object that never left the process.
  const body = (await response.json()) as {
    data: { collection: unknown; document: { version: string; sections: string[] } };
  };
  return { etag: response.headers.get('ETag'), ...body.data };
}

/** What a page renders from, as it would reach a client over the wire. */
async function fromPage(id: string) {
  return JSON.parse(JSON.stringify(await requireDocument(id))) as unknown;
}

describe('API and page parity, per document', () => {
  it('covers all seven documents', () => {
    expect(DOCUMENT_IDS).toHaveLength(7);
  });

  it.each(DOCUMENT_IDS)(
    '%s: the API returns exactly the record the page renders from',
    async (id) => {
      const api = await fromApi(id);

      expect(api.document).toEqual(await fromPage(id));
    }
  );

  it.each(DOCUMENT_IDS)(
    '%s: with its version, and an ETag over exactly that record',
    async (id) => {
      const api = await fromApi(id);
      const page = await requireDocument(id);

      expect(api.document.version).toBe(page.version);
      expect(api.etag).toBe(
        computeETag({ collection: await getFoundationalCollectionMeta(), document: page })
      );
    }
  );

  it.each(Object.entries(SECTION_KEYS))(
    '%s: every section key a web surface selects by is in the API response',
    async (id, ranges) => {
      const api = await fromApi(id);

      for (const range of ranges) expect(api.document.sections).toContain(range.key);
    }
  );

  it('moves together when the row changes: new record on both sides, new ETag', async () => {
    const before = await fromApi('disclaimer');

    store.editBlocks('disclaimer', (blocks) =>
      rewriteSection(blocks, 'crisis', () => 'An edited crisis paragraph.')
    );
    store.editRow('disclaimer', { version: '1.2' });

    const after = await fromApi('disclaimer');

    expect(after.etag).not.toBe(before.etag);
    expect(after.document.version).toBe('1.2');
    expect(after.document).toEqual(await fromPage('disclaimer'));
    expect(JSON.stringify(after.document)).toContain('An edited crisis paragraph.');
  });
});

describe('the index agrees with the documents', () => {
  it("lists each document's version and keys exactly as its own record does", async () => {
    const response = await getIndex({
      headers: new Headers(),
      url: 'http://localhost:3000/api/v1/app/content/documents',
    } as unknown as NextRequest);
    const { data } = (await response.json()) as {
      data: { documents: { id: string; version: string; revision: number; sections: string[] }[] };
    };

    expect(data.documents.map((document) => document.id)).toEqual(DOCUMENT_IDS);
    for (const summary of data.documents) {
      const page = await requireDocument(summary.id);
      expect(summary).toMatchObject({
        version: page.version,
        revision: page.revision,
        sections: [...page.sections],
      });
    }
  });
});
