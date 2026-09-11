import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { WaitlistTable } from '@/components/app/admin/waitlist-table';
import { WAITLIST_ADMIN_ENDPOINT } from '@/lib/app/waitlist/endpoint';
import { WAITLIST_ADMIN_PAGE_SIZE } from '@/lib/validations/app-waitlist';
import { parsePaginationMeta } from '@/lib/validations/common';
import type { WaitlistAdminEntry } from '@/lib/app/waitlist/admin';
import type { PaginationMeta } from '@/types/api';

export const metadata: Metadata = {
  title: 'Waitlist',
  description: 'Who asked to be told when a place opens, and what they said',
};

/** What the table renders before its first client-side fetch. */
const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: WAITLIST_ADMIN_PAGE_SIZE,
  total: 0,
  totalPages: 0,
};

/**
 * The first page, server-rendered.
 *
 * Through the API rather than straight to Prisma, which is the platform's
 * convention for an admin page (`app/admin/users`, `app/admin/logs`) and is the
 * API-first rule in CLAUDE.md: every capability has to be reachable over HTTP,
 * and a page that queried the database directly would be the one caller that
 * proved nothing about the route.
 *
 * A failed fetch renders the empty table rather than throwing — the same shape
 * the platform's admin pages take. The table says "Nobody has joined the
 * waitlist yet", which is the one wrong thing this page can say, so the
 * distinction is carried by `loadError`: the page says so above the table.
 */
async function getFirstPage(): Promise<{
  entries: WaitlistAdminEntry[];
  meta: PaginationMeta;
  loadError: boolean;
}> {
  try {
    const response = await serverFetch(
      `${WAITLIST_ADMIN_ENDPOINT}?page=1&limit=${WAITLIST_ADMIN_PAGE_SIZE}`
    );
    if (!response.ok) return { entries: [], meta: EMPTY_META, loadError: true };

    const parsed = await parseApiResponse<WaitlistAdminEntry[]>(response);
    if (!parsed.success) return { entries: [], meta: EMPTY_META, loadError: true };

    // `parsePaginationMeta`, not a cast. `meta` is a response body — external
    // data by CLAUDE.md's definition even when this app served it — and the
    // validated helper exists so a route that changed its envelope produces a
    // sane fallback here instead of a `meta.limit` of `undefined` reaching the
    // table's arithmetic.
    return {
      entries: parsed.data,
      meta: parsePaginationMeta(parsed.meta) ?? {
        ...EMPTY_META,
        total: parsed.data.length,
        totalPages: 1,
      },
      loadError: false,
    };
  } catch {
    return { entries: [], meta: EMPTY_META, loadError: true };
  }
}

/**
 * The waitlist, for Lelañea and whoever runs the platform (§03 t-8).
 *
 * `/admin/**` is the `admin` surface (`lib/app/surface.ts`), which the brand
 * theme deliberately does not reach — so this page keeps Sunrise's admin chrome
 * and carries no Lelañea styling of its own.
 */
export default async function WaitlistAdminPage() {
  const { entries, meta, loadError } = await getFirstPage();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Waitlist</h2>
        <p className="text-muted-foreground text-sm">
          Everyone who asked to be told when a place opens, newest first, with what they said while
          asking. Export takes the list away as a CSV.
        </p>
      </div>

      {loadError && (
        <p role="alert" className="text-destructive text-sm">
          The list did not load. Reload the page — if it keeps failing, the waitlist endpoint is the
          thing to check, not the table.
        </p>
      )}

      <WaitlistTable initialEntries={entries} initialMeta={meta} />
    </div>
  );
}
