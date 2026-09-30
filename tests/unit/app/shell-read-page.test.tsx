// @vitest-environment happy-dom

/**
 * `/app/read/[id]`: each read in the workspace, her words as the seed stores
 * them, and the shell's 404 for any other document (t-103).
 *
 * FORK NOTE — the titles asserted are Lelañea's documents, read from the real
 * seed so the page and the content cannot drift apart.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

import ReadPage, { generateMetadata } from '@/app/(lelanea)/app/read/[id]/page';
import { ONBOARDING_READS } from '@/lib/app/onboarding/first-run';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe('/app/read/[id]', () => {
  it.each([
    ['the_heart_behind_lelanea', 'The Heart Behind Lelañea'],
    ['the_mission', 'The Mission'],
    ['about_the_creator', 'About the Creator'],
    ['the_lineage_of_lelanea', 'The Lineage of Lelañea'],
  ])('renders %s whole, under its own title', async (id, title) => {
    expect(ONBOARDING_READS).toContain(id);
    render(await ReadPage(params(id)));
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('main').textContent?.length).toBeGreaterThan(500);
    await expect(generateMetadata(params(id))).resolves.toEqual({ title });
  });

  it.each(['the_initiation', 'disclaimer', 'terms_of_use', 'nothing'])(
    'is the shell’s 404 for %s',
    async (id) => {
      await expect(ReadPage(params(id))).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(generateMetadata(params(id))).resolves.toEqual({});
    }
  );
});
