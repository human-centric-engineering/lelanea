import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import {
  CONTENT_ADMIN_PAGE,
  CONTENT_COLLECTIONS,
  contentCollectionEndpoint,
  type ContentCollection,
} from '@/lib/app/content/admin/endpoint';
import { COLLECTION_COPY } from '@/components/app/admin/content/copy';
import { DocumentsPanel } from '@/components/app/admin/content/documents-panel';
import { JourneyPanel } from '@/components/app/admin/content/journey-panel';
import { QuestionsPanel } from '@/components/app/admin/content/questions-panel';
import { ResourcesPanel } from '@/components/app/admin/content/resources-panel';
import type { DocumentsAdminView } from '@/lib/app/content/admin/documents';
import type { JourneyAdminView } from '@/lib/app/content/admin/journey';
import type { QuestionsAdminView } from '@/lib/app/content/admin/questions';
import type { ResourcesAdminView } from '@/lib/app/content/admin/resources';

type Params = Promise<{ collection: string }>;

function asCollection(segment: string): ContentCollection | null {
  return CONTENT_COLLECTIONS.find((collection) => collection === segment) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const collection = asCollection((await params).collection);
  return { title: collection ? COLLECTION_COPY[collection].title : 'Content' };
}

async function getView<T>(collection: ContentCollection): Promise<T | null> {
  try {
    const response = await serverFetch(contentCollectionEndpoint(collection));
    if (!response.ok) return null;
    const parsed = await parseApiResponse<T>(response);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * One content collection, edited (f-content-seeds t-91).
 *
 * Through the admin API rather than straight to Prisma, as every
 * `app/admin/app/*` page is. A failed load names the endpoint rather than
 * showing the panel's "not seeded" state, which would send an operator to
 * re-run a seed that has already run.
 */
export default async function ContentCollectionPage({ params }: { params: Params }) {
  const collection = asCollection((await params).collection);
  if (!collection) notFound();
  const copy = COLLECTION_COPY[collection];

  const panel = await (async () => {
    switch (collection) {
      case 'documents': {
        const view = await getView<DocumentsAdminView>(collection);
        return view && <DocumentsPanel initialView={view} />;
      }
      case 'journey': {
        const view = await getView<JourneyAdminView>(collection);
        return view && <JourneyPanel initialView={view} />;
      }
      case 'questions': {
        const view = await getView<QuestionsAdminView>(collection);
        return view && <QuestionsPanel initialView={view} />;
      }
      case 'resources': {
        const view = await getView<ResourcesAdminView>(collection);
        return view && <ResourcesPanel initialView={view} />;
      }
    }
  })();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href={CONTENT_ADMIN_PAGE} className="hover:underline">
            Content
          </Link>{' '}
          /
        </p>
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="text-muted-foreground max-w-3xl text-sm">{copy.description}</p>
      </div>
      {panel ?? (
        <p role="alert" className="text-destructive text-sm">
          This collection did not load. Reload the page; if it keeps failing, the endpoint{' '}
          <code>{contentCollectionEndpoint(collection)}</code> is the thing to check.
        </p>
      )}
    </div>
  );
}
