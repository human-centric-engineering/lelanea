import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTENT_COLLECTIONS, contentAdminPage } from '@/lib/app/content/admin/endpoint';
import { COLLECTION_COPY } from '@/components/app/admin/content/copy';

export const metadata: Metadata = {
  title: 'Content',
  description: 'Her documents, the journey, the discovery questions and the resources',
};

/**
 * The content section's landing page (f-content-seeds t-91): one card per
 * collection. Everything here is her material, stored in the database and
 * edited without a deploy; `content/` only seeded it.
 */
export default function ContentAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Content</h2>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Her words, as every page, email and client reads them. An edit here is live on the next
          request. Each collection can be exported in the shape its seed file has, and a file
          brought back with a preview first.
        </p>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {CONTENT_COLLECTIONS.map((collection) => (
          <li key={collection}>
            <Link
              href={contentAdminPage(collection)}
              className="hover:bg-muted block rounded-md border p-4 transition-colors"
            >
              <p className="font-medium">{COLLECTION_COPY[collection].title}</p>
              <p className="text-muted-foreground text-sm">
                {COLLECTION_COPY[collection].description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
