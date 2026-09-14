// @vitest-environment happy-dom

/**
 * The export control: what it fetches, what it hands the browser, and how it
 * answers the two ways the route can refuse.
 *
 * `apiClient` is mocked at the boundary the row calls. The download is
 * observed through `URL.createObjectURL` and the synthetic anchor's `download`
 * attribute — the two things a browser needs to save a file — rather than
 * through a click nothing can see.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, get } };
});
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  EXPORT_COPY,
  EXPORT_ROUTE,
  ExportDataRow,
  exportFilename,
} from '@/components/app/account/export-data-row';
import { APIClientError } from '@/lib/api/client';

const BUNDLE = { meta: { app: [] }, app: { waitlist: [], acknowledgements: [] } };

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clicked: HTMLAnchorElement[];

beforeEach(() => {
  vi.clearAllMocks();
  clicked = [];
  createObjectURL = vi.fn(() => 'blob:lelanea/my-data');
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
  // Capture the synthetic anchor at the moment it is clicked — it is never
  // attached to the document, so this is the only place to see it.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function row(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Export a copy/ });
}

describe('ExportDataRow', () => {
  it('is a button that says what it is for, and asks nothing until clicked', () => {
    render(<ExportDataRow />);
    expect(row().disabled).toBe(false);
    expect(screen.getByText(EXPORT_COPY.idle)).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches the bundle from the only route that exports, and hands it over as a dated file', async () => {
    get.mockResolvedValue(BUNDLE);
    render(<ExportDataRow />);

    fireEvent.click(row());

    expect(get).toHaveBeenCalledWith(EXPORT_ROUTE);
    await waitFor(() => expect(screen.getByText(EXPORT_COPY.done)).toBeTruthy());

    // What the browser was given: a JSON blob of the bundle, under a dated name.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(JSON.stringify(BUNDLE, null, 2));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.getAttribute('download')).toBe(exportFilename());
    expect(clicked[0]?.getAttribute('href')).toBe('blob:lelanea/my-data');
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:lelanea/my-data'));
  });

  it('is busy, and says so, while the bundle is being gathered', async () => {
    let settle: (value: unknown) => void = () => {};
    get.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    render(<ExportDataRow />);

    fireEvent.click(row());

    await waitFor(() => expect(row().disabled).toBe(true));
    expect(row().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText(EXPORT_COPY.busy)).toBeTruthy();
    settle(BUNDLE);
    await waitFor(() => expect(row().disabled).toBe(false));
  });

  it('answers a rate-limit refusal in a sentence, in the row, and hands nothing over', async () => {
    // The whole reason this is a fetch and not a link: the route answers 429
    // as a bare JSON envelope, and a navigation to that put raw JSON over the
    // app. Here it is a line under the title.
    get.mockRejectedValue(new APIClientError('Too many requests', 'RATE_LIMIT_EXCEEDED', 429));
    render(<ExportDataRow />);

    fireEvent.click(row());

    expect((await screen.findByRole('alert')).textContent).toBe(EXPORT_COPY.limited);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
    // And the control is usable again — "give it a minute, then try once more".
    expect(row().disabled).toBe(false);
  });

  it('answers any other failure in the guide’s words', async () => {
    get.mockRejectedValue(new APIClientError('boom', 'INTERNAL_ERROR', 500));
    render(<ExportDataRow />);

    fireEvent.click(row());

    expect((await screen.findByRole('alert')).textContent).toBe(EXPORT_COPY.failed);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('names the file by date, so two copies do not overwrite each other', () => {
    expect(exportFilename(new Date('2026-09-14T15:00:00.000Z'))).toBe(
      'lelanea-my-data-2026-09-14.json'
    );
  });

  it('keeps to the register: no exclamation points, nothing that reads as blame', () => {
    for (const line of Object.values(EXPORT_COPY)) {
      expect(line).not.toContain('!');
      expect(line).not.toMatch(/\berror\b|\binvalid\b|\bfailed\b/i);
    }
  });
});
