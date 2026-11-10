// @vitest-environment happy-dom

/**
 * Integration test — ConfigTab (f-ops-views t-2).
 *
 * The generic config form: renders a control per descriptor, coerces + submits the config,
 * blocks on client-side JSON errors, surfaces the server's field errors, and handles the
 * unregistered / no-parameters states.
 *
 * @see components/admin/framework/module-detail/config-tab.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FieldDescriptor } from '@/lib/framework/modules/config/schema-descriptors';
import type { ModuleConfigFormView } from '@/lib/framework/modules/view';
import { APIClientError } from '@/lib/api/client';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/framework/modules/config/client', () => ({ saveModuleConfig: vi.fn() }));

import { ConfigTab } from '@/components/admin/framework/module-detail/config-tab';
import { saveModuleConfig } from '@/lib/framework/modules/config/client';

const DESCRIPTORS: FieldDescriptor[] = [
  { key: 'apiKey', type: 'string', label: 'Api Key', required: true },
  { key: 'maxItems', type: 'number', label: 'Max Items', required: false, integer: true },
  { key: 'enabled', type: 'boolean', label: 'Enabled', required: false },
  { key: 'tier', type: 'enum', label: 'Tier', required: false, options: ['free', 'pro'] },
  { key: 'meta', type: 'json', label: 'Meta', required: false },
  {
    key: 'ratio',
    type: 'number',
    label: 'Ratio',
    required: false,
    integer: false,
    min: 0.5,
    max: 2,
  },
];

function form(over: Partial<ModuleConfigFormView> = {}): ModuleConfigFormView {
  return { registered: true, descriptors: DESCRIPTORS, values: {}, ...over };
}

describe('ConfigTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a control per descriptor and a save button', () => {
    render(<ConfigTab slug="demo" form={form()} />);
    expect(screen.getByText('Api Key')).toBeInTheDocument();
    expect(screen.getByText('Max Items')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Tier')).toBeInTheDocument();
    expect(screen.getByText('Meta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save config/i })).toBeInTheDocument();
  });

  it('coerces and submits the config (number → Number, boolean always included)', async () => {
    const user = userEvent.setup();
    vi.mocked(saveModuleConfig).mockResolvedValue({
      version: { id: 'v1', version: 1, changeSummary: null, createdBy: 'u', createdAt: 'x' },
    });

    render(<ConfigTab slug="demo" form={form()} />);
    await user.type(screen.getByLabelText(/api key/i), 'abc');
    await user.type(screen.getByLabelText(/max items/i), '5');
    await user.click(screen.getByRole('button', { name: /save config/i }));

    expect(saveModuleConfig).toHaveBeenCalledWith('demo', {
      config: { apiKey: 'abc', maxItems: 5, enabled: false },
      changeSummary: undefined,
    });
    expect(refresh).toHaveBeenCalled();
  });

  // `noValidate` turns off what the inputs declare, so the handler has to hold each limit.
  it.each([
    ['Ratio', '0.1', 'Ratio: must be at least 0.5'],
    ['Ratio', '3', 'Ratio: must be at most 2'],
    ['Max Items', '1.5', 'Max Items: must be a whole number'],
  ])('blocks %s = %s without saving', async (label, value, message) => {
    const user = userEvent.setup();
    render(<ConfigTab slug="demo" form={form()} />);

    const field = screen.getByLabelText(label);
    await user.type(field, value);
    await user.click(screen.getByRole('button', { name: /save config/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(field).toHaveFocus();
    expect(saveModuleConfig).not.toHaveBeenCalled();
  });

  it('accepts a number on its limit', async () => {
    const user = userEvent.setup();
    vi.mocked(saveModuleConfig).mockResolvedValue({
      version: { id: 'v1', version: 1, changeSummary: null, createdBy: 'u', createdAt: 'x' },
    });
    render(<ConfigTab slug="demo" form={form()} />);

    await user.type(screen.getByLabelText('Ratio'), '2');
    await user.click(screen.getByRole('button', { name: /save config/i }));

    expect(saveModuleConfig).toHaveBeenCalledWith(
      'demo',
      expect.objectContaining({ config: expect.objectContaining({ ratio: 2 }) })
    );
  });

  it('blocks submit on invalid JSON without calling the API', async () => {
    const user = userEvent.setup();
    render(<ConfigTab slug="demo" form={form()} />);
    // `{{` types a literal `{` (userEvent treats `{...}` as key syntax).
    await user.type(screen.getByLabelText(/meta/i), '{{not json');
    await user.click(screen.getByRole('button', { name: /save config/i }));

    expect(screen.getByText(/Meta: invalid JSON/i)).toBeInTheDocument();
    expect(saveModuleConfig).not.toHaveBeenCalled();
  });

  it('surfaces the server field errors on a validation failure', async () => {
    const user = userEvent.setup();
    vi.mocked(saveModuleConfig).mockRejectedValue(
      new APIClientError('Module config is invalid', 'VALIDATION_ERROR', 422, {
        config: ['apiKey: too short'],
      })
    );

    render(<ConfigTab slug="demo" form={form()} />);
    await user.type(screen.getByLabelText(/api key/i), 'x');
    await user.click(screen.getByRole('button', { name: /save config/i }));

    expect(await screen.findByText(/apiKey: too short/i)).toBeInTheDocument();
  });

  it('shows read-only values (no form) for an unregistered module', () => {
    render(
      <ConfigTab
        slug="demo"
        form={form({ registered: false, descriptors: [], values: { a: 1 } })}
      />
    );
    expect(screen.getByText(/no longer registered/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save config/i })).not.toBeInTheDocument();
  });

  it('shows a notice when a registered module has no parameters', () => {
    render(<ConfigTab slug="demo" form={form({ descriptors: [] })} />);
    expect(screen.getByText(/no configurable parameters/i)).toBeInTheDocument();
  });

  it('shows a load error (not the unregistered message) when the config failed to load', () => {
    render(<ConfigTab slug="demo" form={null} />);
    expect(screen.getByText(/couldn.t be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer registered/i)).not.toBeInTheDocument();
  });
});
