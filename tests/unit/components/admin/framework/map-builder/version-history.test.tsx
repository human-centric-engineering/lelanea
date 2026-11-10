// @vitest-environment happy-dom

/**
 * VersionHistory (f-map-editor t-4) — the version-history dialog. Proves it lists the
 * versions the API returns (marking the live one), rolls back a prior version through
 * the parent callback and re-fetches, surfaces a rollback error, and renders the empty
 * state.
 *
 * @see components/admin/framework/map-builder/version-history.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { APIClientError } from '@/lib/api/client';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: api,
}));

import { VersionHistory } from '@/components/admin/framework/map-builder/version-history';

const VERSIONS = {
  versions: [
    {
      id: 'v2id',
      version: 2,
      changeSummary: 'Added gating',
      createdAt: '2026-07-01T09:30:00.000Z',
      createdBy: 'user-1',
    },
    {
      id: 'v1id',
      version: 1,
      changeSummary: null,
      createdAt: '2026-06-01T08:00:00.000Z',
      createdBy: 'user-1',
    },
  ],
  publishedVersionId: 'v2id',
  nextCursor: null,
};

function renderHistory(overrides: Partial<React.ComponentProps<typeof VersionHistory>> = {}) {
  const onRollback = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <VersionHistory
      slug="demo"
      open
      onOpenChange={onOpenChange}
      onRollback={onRollback}
      {...overrides}
    />
  );
  return { onRollback, onOpenChange };
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(VERSIONS);
});

describe('VersionHistory', () => {
  it('fetches and lists versions, marking the live one', async () => {
    renderHistory();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/v1/admin/framework/maps/demo/versions')
    );
    const liveRow = await screen.findByTestId('map-version-2');
    expect(liveRow).toHaveTextContent('live');
    // The live version cannot be rolled back to; a prior version can.
    expect(screen.queryByTestId('map-rollback-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('map-rollback-1')).toBeInTheDocument();
  });

  it('rolls back a prior version through the parent and re-fetches', async () => {
    const user = userEvent.setup();
    const { onRollback } = renderHistory();
    await screen.findByTestId('map-version-1');

    await user.click(screen.getByTestId('map-rollback-1'));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(onRollback).toHaveBeenCalledWith(1);
    // One initial load + one refresh after the rollback.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('surfaces a rollback failure inline', async () => {
    const user = userEvent.setup();
    renderHistory({
      onRollback: vi.fn().mockRejectedValue(new APIClientError('target invalid', 'X', 400)),
    });
    await screen.findByTestId('map-version-1');

    await user.click(screen.getByTestId('map-rollback-1'));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('target invalid');
  });

  it('does not claim a rollback failed when its answer was lost', async () => {
    const user = userEvent.setup();
    renderHistory({
      onRollback: vi.fn().mockRejectedValue(new APIClientError('Failed to fetch', 'NETWORK_ERROR')),
    });
    await screen.findByTestId('map-version-1');

    await user.click(screen.getByTestId('map-rollback-1'));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t confirm the rollback/i);
    expect(alert).not.toHaveTextContent(/failed to roll back/i);
    // Nothing is left armed to click again, and the list is re-read to show what is live.
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('renders the empty state when there are no versions', async () => {
    api.get.mockResolvedValueOnce({ versions: [], publishedVersionId: null, nextCursor: null });
    renderHistory();
    expect(await screen.findByText(/no published versions yet/i)).toBeInTheDocument();
  });
});
