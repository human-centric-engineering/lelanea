// @vitest-environment happy-dom

/**
 * MapsTable (f-map-editor t-1) — the map list + create dialog.
 *
 * Proves: a row per map with its status badge; both empty states (nothing yet vs.
 * nothing matches the search); the search filter; and the create flow (name mirrors
 * into a slug, Create POSTs `{ slug, name }` and routes into the new map's editor).
 *
 * @see components/admin/framework/maps-table.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { APIClientError } from '@/lib/api/client';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: api,
}));

import { MapsTable, type MapListItem } from '@/components/admin/framework/maps-table';

function map(over: Partial<MapListItem> = {}): MapListItem {
  return {
    id: `map-${over.slug ?? 'x'}`,
    slug: 'demo',
    name: 'Demo Map',
    description: null,
    publishedVersionId: null,
    draftDefinition: null,
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  api.post.mockReset().mockResolvedValue({});
  router.push.mockReset();
});

describe('MapsTable rows', () => {
  it('links each row to its collective heat view (f-engagement-analytics t-1b)', () => {
    render(<MapsTable initialMaps={[map({ slug: 'onboarding', name: 'Onboarding' })]} />);
    const heat = screen.getByRole('link', { name: /heat/i });
    expect(heat).toHaveAttribute('href', '/admin/framework/maps/onboarding/heat');
  });

  it('renders a row per map with the right status badge', () => {
    render(
      <MapsTable
        initialMaps={[
          map({ slug: 'a', name: 'Alpha', publishedVersionId: 'v1' }),
          map({
            slug: 'b',
            name: 'Beta',
            publishedVersionId: 'v1',
            draftDefinition: { nodes: [], edges: [] },
          }),
          map({
            slug: 'c',
            name: 'Gamma',
            publishedVersionId: null,
            draftDefinition: { nodes: [], edges: [] },
          }),
          map({ slug: 'd', name: 'Delta' }),
        ]}
      />
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Published · draft')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('links each map to its editor', () => {
    render(<MapsTable initialMaps={[map({ slug: 'onboarding', name: 'Onboarding' })]} />);
    expect(screen.getByRole('link', { name: 'Onboarding' })).toHaveAttribute(
      'href',
      '/admin/framework/maps/onboarding'
    );
  });

  it('shows the no-maps empty state', () => {
    render(<MapsTable initialMaps={[]} />);
    expect(screen.getByText(/No facilitation maps yet/)).toBeInTheDocument();
  });

  it('filters by the search query', async () => {
    const user = userEvent.setup();
    render(
      <MapsTable
        initialMaps={[map({ slug: 'alpha', name: 'Alpha' }), map({ slug: 'beta', name: 'Beta' })]}
      />
    );
    await user.type(screen.getByRole('searchbox', { name: 'Search maps' }), 'alph');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });
});

describe('MapsTable create', () => {
  it('creates a map and routes to its editor', async () => {
    const user = userEvent.setup();
    render(<MapsTable initialMaps={[]} />);

    await user.click(screen.getByRole('button', { name: /New map/ }));
    await user.type(screen.getByLabelText('Name'), 'Onboarding Journey');
    await user.click(screen.getByRole('button', { name: 'Create map' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/framework/maps', {
      body: { slug: 'onboarding-journey', name: 'Onboarding Journey' },
    });
    expect(router.push).toHaveBeenCalledWith('/admin/framework/maps/onboarding-journey');
  });

  it('blocks submit when the name is empty', async () => {
    const user = userEvent.setup();
    render(<MapsTable initialMaps={[]} />);
    await user.click(screen.getByRole('button', { name: /New map/ }));
    await user.click(screen.getByRole('button', { name: 'Create map' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/name and a slug are both required/i);
  });

  it('honours a directly-edited slug and an optional description', async () => {
    const user = userEvent.setup();
    render(<MapsTable initialMaps={[]} />);

    await user.click(screen.getByRole('button', { name: /New map/ }));
    await user.type(screen.getByLabelText('Name'), 'Onboarding');
    // Editing the slug decouples it from the name mirror. (The label carries a
    // FieldHelp trigger, so locate the input by its placeholder.)
    const slug = screen.getByPlaceholderText('onboarding-journey');
    await user.clear(slug);
    await user.type(slug, 'custom-slug');
    await user.type(screen.getByLabelText(/Description/), 'What it does');
    await user.click(screen.getByRole('button', { name: 'Create map' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/framework/maps', {
      body: { slug: 'custom-slug', name: 'Onboarding', description: 'What it does' },
    });
  });

  it('resets the form when the dialog is cancelled and reopened', async () => {
    const user = userEvent.setup();
    render(<MapsTable initialMaps={[]} />);

    await user.click(screen.getByRole('button', { name: /New map/ }));
    await user.type(screen.getByLabelText('Name'), 'Scratch');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: /New map/ }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('can still close after a create, if the navigation stalls', async () => {
    api.post.mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<MapsTable initialMaps={[]} />);

    await user.click(screen.getByRole('button', { name: /New map/ }));
    await user.type(screen.getByLabelText('Name'), 'Fresh');
    await user.click(screen.getByRole('button', { name: 'Create map' }));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces a create failure without routing away', async () => {
    api.post.mockRejectedValueOnce(new APIClientError('slug already in use', 'X', 409));
    const user = userEvent.setup();
    render(<MapsTable initialMaps={[]} />);

    await user.click(screen.getByRole('button', { name: /New map/ }));
    await user.type(screen.getByLabelText('Name'), 'Dup');
    await user.click(screen.getByRole('button', { name: 'Create map' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('slug already in use');
    expect(router.push).not.toHaveBeenCalled();
  });
});
