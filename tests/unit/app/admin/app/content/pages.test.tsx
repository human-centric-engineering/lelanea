// @vitest-environment happy-dom

/**
 * The content admin pages (f-content-seeds t-91): the landing page lists the
 * four collections, and each collection page reads its view through the admin
 * API and hands it to its panel, or says which endpoint failed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const { panel } = vi.hoisted(() => ({
  panel: (name: string) =>
    function Panel(props: Record<string, unknown>) {
      return <div data-testid="panel" data-name={name} data-props={JSON.stringify(props)} />;
    },
}));
vi.mock('@/components/app/admin/content/documents-panel', () => ({
  DocumentsPanel: panel('documents'),
}));
vi.mock('@/components/app/admin/content/journey-panel', () => ({ JourneyPanel: panel('journey') }));
vi.mock('@/components/app/admin/content/questions-panel', () => ({
  QuestionsPanel: panel('questions'),
}));
vi.mock('@/components/app/admin/content/resources-panel', () => ({
  ResourcesPanel: panel('resources'),
}));

import ContentAdminPage from '@/app/admin/app/content/page';
import ContentCollectionPage, { generateMetadata } from '@/app/admin/app/content/[collection]/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { contentAdminPage, contentCollectionEndpoint } from '@/lib/app/content/admin/endpoint';

const params = (collection: string) => ({ params: Promise.resolve({ collection }) });

beforeEach(() => vi.clearAllMocks());

describe('the content landing page', () => {
  it('links to each of the four collections', () => {
    render(<ContentAdminPage />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(
      ['documents', 'journey', 'questions', 'resources'].map((c) => contentAdminPage(c as never))
    );
  });
});

describe('a collection page', () => {
  it.each(['documents', 'journey', 'questions', 'resources'])(
    '%s: reads its view through the API and hands it to its own panel',
    async (collection) => {
      const view = { seeded: true, marker: collection };
      vi.mocked(serverFetch).mockResolvedValue(new Response('{}', { status: 200 }));
      vi.mocked(parseApiResponse).mockResolvedValue({ success: true, data: view } as never);

      render(await ContentCollectionPage(params(collection)));

      expect(serverFetch).toHaveBeenCalledWith(contentCollectionEndpoint(collection as never));
      const rendered = screen.getByTestId('panel');
      expect(rendered.getAttribute('data-name')).toBe(collection);
      expect(JSON.parse(rendered.getAttribute('data-props') ?? '{}')).toEqual({
        initialView: view,
      });
    }
  );

  it.each([
    [
      'a non-2xx answer',
      () => vi.mocked(serverFetch).mockResolvedValue(new Response('', { status: 500 })),
    ],
    ['a thrown fetch', () => vi.mocked(serverFetch).mockRejectedValue(new Error('down'))],
    [
      'an error envelope',
      () => {
        vi.mocked(serverFetch).mockResolvedValue(new Response('{}', { status: 200 }));
        vi.mocked(parseApiResponse).mockResolvedValue({
          success: false,
          error: { message: 'x' },
        } as never);
      },
    ],
  ])('names the endpoint rather than rendering a panel on %s', async (_what, arrange) => {
    arrange();
    render(await ContentCollectionPage(params('questions')));
    expect(screen.queryByTestId('panel')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(contentCollectionEndpoint('questions'));
  });

  it('is a 404 for a collection that does not exist, and titles the ones that do', async () => {
    await expect(ContentCollectionPage(params('values'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(await generateMetadata(params('journey'))).toEqual({ title: 'Journey text' });
    expect(await generateMetadata(params('values'))).toEqual({ title: 'Content' });
  });
});
