// @vitest-environment happy-dom

/**
 * Integration test — SettingsTab (f-ops-views t-3).
 *
 * The module lifecycle form + danger zone: pre-fills from the settings, coerces + PATCHes
 * the row (UTC window bounds → ISO), blocks an incoherent window client-side, surfaces the
 * server's field errors, and gates delete on registration (unregistered → two-step confirm →
 * DELETE → back to the list; registered → an explanatory note, no delete).
 *
 * @see components/admin/framework/module-detail/settings-tab.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ModuleSettingsView } from '@/lib/framework/modules/view';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { patch: vi.fn(), delete: vi.fn() } };
});

import { SettingsTab } from '@/components/admin/framework/module-detail/settings-tab';
import { apiClient, APIClientError } from '@/lib/api/client';

function settings(over: Partial<ModuleSettingsView> = {}): ModuleSettingsView {
  return {
    id: 'mod-1',
    slug: 'onboarding',
    name: 'Onboarding',
    status: 'active',
    audience: 'all',
    featureFlagName: null,
    availableFrom: null,
    availableUntil: null,
    isRegistered: false,
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...over,
  };
}

const PATCH_URL = '/api/v1/admin/framework/modules/onboarding';

describe('SettingsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pre-fills the form from the settings', () => {
    render(<SettingsTab settings={settings({ featureFlagName: 'beta-flag' })} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Onboarding');
    expect(screen.getByLabelText('Audience')).toHaveValue('all');
    expect(screen.getByLabelText('Feature flag')).toHaveValue('beta-flag');
  });

  it('submits the current values (empty flag/window → null)', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue(undefined);

    render(<SettingsTab settings={settings()} />);
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(apiClient.patch).toHaveBeenCalledWith(PATCH_URL, {
      body: {
        name: 'Onboarding',
        status: 'active',
        audience: 'all',
        featureFlagName: null,
        availableFrom: null,
        availableUntil: null,
      },
    });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('coerces a UTC window bound to an ISO string', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue(undefined);

    render(<SettingsTab settings={settings()} />);
    fireEvent.change(screen.getByLabelText(/available from/i), {
      target: { value: '2026-03-01T10:00' },
    });
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(apiClient.patch).toHaveBeenCalledWith(
      PATCH_URL,
      expect.objectContaining({
        body: expect.objectContaining({ availableFrom: '2026-03-01T10:00:00.000Z' }),
      })
    );
  });

  it('preserves an untouched sub-minute window bound instead of truncating it', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue(undefined);

    // A bound with non-zero seconds (set via seed / API); the minute-precision control can't
    // represent :45, so an untouched save must send the ORIGINAL ISO, not a truncated one.
    render(<SettingsTab settings={settings({ availableFrom: '2026-07-01T12:30:45.000Z' })} />);
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(apiClient.patch).toHaveBeenCalledWith(
      PATCH_URL,
      expect.objectContaining({
        body: expect.objectContaining({ availableFrom: '2026-07-01T12:30:45.000Z' }),
      })
    );
  });

  it('blocks an incoherent window client-side without calling the API', async () => {
    const user = userEvent.setup();
    render(<SettingsTab settings={settings()} />);

    fireEvent.change(screen.getByLabelText(/available from/i), {
      target: { value: '2026-06-01T10:00' },
    });
    fireEvent.change(screen.getByLabelText(/available until/i), {
      target: { value: '2026-01-01T10:00' },
    });
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(screen.getByText(/end must be on or after the start/i)).toBeInTheDocument();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('edits the string fields and submits the trimmed values', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue(undefined);

    render(<SettingsTab settings={settings()} />);
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, '  Renamed  ');
    const audience = screen.getByLabelText('Audience');
    await user.clear(audience);
    await user.type(audience, 'invite');
    await user.type(screen.getByLabelText('Feature flag'), 'beta-flag');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(apiClient.patch).toHaveBeenCalledWith(
      PATCH_URL,
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'Renamed',
          audience: 'invite',
          featureFlagName: 'beta-flag',
        }),
      })
    );
  });

  it('shows the fallback, not the browser, when the server never answered', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockRejectedValue(
      new APIClientError('Failed to fetch', 'NETWORK_ERROR')
    );

    render(<SettingsTab settings={settings()} />);
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save settings');
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  });

  // `noValidate` turns the inputs' `required` off, so the handler has to hold it.
  it('blocks a blank name without saving, and focuses it', async () => {
    const user = userEvent.setup();
    render(<SettingsTab settings={settings()} />);

    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('blocks a half-typed date, which would otherwise read as cleared', async () => {
    const user = userEvent.setup();
    render(<SettingsTab settings={settings()} />);

    const from = screen.getByLabelText(/available from/i);
    Object.defineProperty(from, 'validity', { value: { badInput: true }, configurable: true });
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Available from: enter a complete date and time.'
    );
    expect(from).toHaveFocus();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('blocks a blank audience without saving', async () => {
    const user = userEvent.setup();
    render(<SettingsTab settings={settings()} />);

    await user.clear(screen.getByLabelText('Audience'));
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Audience is required.');
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('shows an error and stays put when the delete fails', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockRejectedValue(
      new APIClientError('A registered module cannot be deleted', 'CONFLICT', 409)
    );

    render(<SettingsTab settings={settings({ isRegistered: false })} />);
    await user.click(screen.getByRole('button', { name: /delete module/i }));
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

    expect(await screen.findByText(/cannot be deleted/i)).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('cancels a pending delete confirmation', async () => {
    const user = userEvent.setup();
    render(<SettingsTab settings={settings({ isRegistered: false })} />);
    await user.click(screen.getByRole('button', { name: /delete module/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('button', { name: /confirm delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete module/i })).toBeInTheDocument();
  });

  it('surfaces the server field errors on a validation failure', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockRejectedValue(
      new APIClientError('Availability window is invalid', 'VALIDATION_ERROR', 422, {
        availableUntil: ['Must be on or after the availability start'],
      })
    );

    render(<SettingsTab settings={settings()} />);
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByText(/on or after the availability start/i)).toBeInTheDocument();
  });

  it('deletes an unregistered module through a two-step confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);

    render(<SettingsTab settings={settings({ isRegistered: false })} />);
    await user.click(screen.getByRole('button', { name: /delete module/i }));
    // Confirm step appears; the API isn't hit until confirmed.
    expect(apiClient.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

    expect(apiClient.delete).toHaveBeenCalledWith(PATCH_URL);
    expect(nav.push).toHaveBeenCalledWith('/admin/framework/modules');
  });

  it('hides delete for a registered module and explains why', () => {
    render(<SettingsTab settings={settings({ isRegistered: true })} />);
    expect(screen.queryByRole('button', { name: /delete module/i })).not.toBeInTheDocument();
    expect(screen.getByText(/still registered/i)).toBeInTheDocument();
  });
});
