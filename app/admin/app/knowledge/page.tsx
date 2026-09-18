import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { KnowledgeWorkspace } from '@/components/app/admin/knowledge-workspace';
import { DESIGNATION_ADMIN_ENDPOINT } from '@/lib/app/voice/endpoint';
import { DESIGNATION_ADMIN_PAGE_SIZE } from '@/lib/validations/app-knowledge-designation';
import { parsePaginationMeta } from '@/lib/validations/common';
import type { DesignatedDocument } from '@/lib/app/voice/designation-admin';
import type { PaginationMeta } from '@/types/api';

export const metadata: Metadata = {
  title: 'Training material',
  description: 'What each document is for, and whether the agent may quote it',
};

/** What the table renders before its first client-side fetch. */
const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: DESIGNATION_ADMIN_PAGE_SIZE,
  total: 0,
  totalPages: 0,
};

/**
 * The first page, server-rendered.
 *
 * Through the API rather than straight to Prisma, which is the platform's
 * convention for an admin page and is the API-first rule in `CLAUDE.md`: every
 * capability has to be reachable over HTTP, and a page that queried the database
 * directly would be the one caller that proved nothing about the route.
 *
 * A failed fetch renders the empty table rather than throwing, and passes the
 * flag down so the table drops its empty-state CLAIM rather than asserting
 * "no documents yet" under the page's own error banner (`HB9`).
 */
async function getFirstPage(): Promise<{
  documents: DesignatedDocument[];
  meta: PaginationMeta;
  loadError: boolean;
}> {
  try {
    const response = await serverFetch(
      `${DESIGNATION_ADMIN_ENDPOINT}?page=1&limit=${DESIGNATION_ADMIN_PAGE_SIZE}`
    );
    if (!response.ok) return { documents: [], meta: EMPTY_META, loadError: true };

    const parsed = await parseApiResponse<DesignatedDocument[]>(response);
    if (!parsed.success) return { documents: [], meta: EMPTY_META, loadError: true };

    return {
      documents: parsed.data,
      meta: parsePaginationMeta(parsed.meta) ?? {
        ...EMPTY_META,
        total: parsed.data.length,
        totalPages: 1,
      },
      loadError: false,
    };
  } catch {
    return { documents: [], meta: EMPTY_META, loadError: true };
  }
}

/**
 * Her training material: adding it, and saying what it is for (§05 t-25, t-44).
 *
 * One page, two acts. The uploader at the top is Sunrise's own, imported rather
 * than copied; the table under it records what each document is FOR. The
 * distinction it exists to capture is between something she knows — which the
 * agent may retrieve and quote — and something that only shows how she sounds,
 * which must never be quoted back at anyone as though it were an answer.
 *
 * Until t-44 the second act lived here and the first did not, so the empty state
 * had to send her to AI Orchestration → Knowledge — a tier of the admin she has
 * no other reason to visit.
 *
 * `/admin/**` is the `admin` surface (`lib/app/surface.ts`), which the brand
 * theme deliberately does not reach — so this page keeps Sunrise's admin chrome
 * and carries no Lelañea styling of its own.
 */
export default async function KnowledgeDesignationPage() {
  const { documents, meta, loadError } = await getFirstPage();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Training material</h2>
        <p className="text-muted-foreground text-sm">
          Add a document, then say what it is for. A document marked <strong>Voice</strong> shows
          how the AI should sound rather than what it knows: the AI may learn its register but can
          never retrieve it or quote it. Anything with no purpose yet reaches nothing at all. The
          platform&rsquo;s own pre-loaded reference material is not listed — every agent can already
          search it, so designating it would change nothing.
        </p>
      </div>

      {loadError && (
        <p role="alert" className="text-destructive text-sm">
          The list did not load. Reload the page — if it keeps failing, the designations endpoint is
          the thing to check, not the table.
        </p>
      )}

      <KnowledgeWorkspace
        initialDocuments={documents}
        initialMeta={meta}
        initialLoadFailed={loadError}
      />
    </div>
  );
}
