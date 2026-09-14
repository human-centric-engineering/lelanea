// @vitest-environment happy-dom

/**
 * The export control: what it fetches, what it hands the browser, and how it
 * answers the three ways the route can refuse.
 *
 * `fetch` is mocked at the boundary the row calls — a raw fetch, not
 * `apiClient`, because the body goes to a file as bytes and is never parsed.
 * The download is observed through `URL.createObjectURL` and the synthetic
 * anchor's `download` attribute — the two things a browser needs to save a
 * file — rather than through a click nothing can see.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  EXPORT_COPY,
  EXPORT_ROUTE,
  ExportDataRow,
  exportFilename,
  SIGN_IN_ROUTE,
} from '@/components/app/account/export-data-row';

const BODY = '{"success":true,"data":{"app":{"waitlist":[],"acknowledgements":[]}}}';

let fetchMock: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let clicked: HTMLAnchorElement[];

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clicked = [];
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  createObjectURL = vi.fn(() => 'blob:lelanea/my-data');
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign },
    configurable: true,
    writable: true,
  });
  // Capture the synthetic anchor at the moment it is clicked — it is never
  // attached to the document, so this is the only place to see it.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function row(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Export a copy/ });
}

describe('ExportDataRow', () => {
  it('is a button that says what it is for, and asks nothing until clicked', () => {
    render(<ExportDataRow />);
    expect(row().disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe(EXPORT_COPY.idle);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the only route that exports, with the session, and hands the body over as a dated file', async () => {
    fetchMock.mockResolvedValue(response(200, BODY));
    render(<ExportDataRow />);

    fireEvent.click(row());

    expect(fetchMock).toHaveBeenCalledWith(
      EXPORT_ROUTE,
      expect.objectContaining({ credentials: 'same-origin' })
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(EXPORT_COPY.done));

    // What the browser was given: the route's body, byte for byte, as a blob,
    // under a dated name — never parsed on the way through.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe(BODY);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.getAttribute('download')).toBe(exportFilename());
    expect(clicked[0]?.getAttribute('href')).toBe('blob:lelanea/my-data');
    // Revoked, but not on the next tick: Firefox and Safari start the read
    // asynchronously, and a URL gone by then fails a large download while the
    // row says "Saved".
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:lelanea/my-data');
  });

  it('is busy, and says so, while the bundle is being gathered', async () => {
    let settle: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (settle = resolve)));
    render(<ExportDataRow />);

    fireEvent.click(row());

    await waitFor(() => expect(row().disabled).toBe(true));
    expect(row().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(EXPORT_COPY.busy);
    settle(response(200, BODY));
    await waitFor(() => expect(row().disabled).toBe(false));
  });

  it('answers a rate-limit refusal as an alert in the row, and hands nothing over', async () => {
    // The whole reason this is a fetch and not a link: the route answers 429
    // as a bare JSON envelope, and a navigation to that put raw JSON over the
    // app. Here it is a line under the title — and the body is never read.
    fetchMock.mockResolvedValue(response(429, '{"success":false}', { 'retry-after': '42' }));
    render(<ExportDataRow />);

    fireEvent.click(row());

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(EXPORT_COPY.limited));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
    // And the control is usable again — "give it a minute, then try once more".
    expect(row().disabled).toBe(false);
  });

  it('sends an ended session to sign in and back here, rather than saying "try once more"', async () => {
    // A page left open until the session expires. Retrying can never succeed,
    // so the honest answer is the sign-in page with a way back (code review,
    // round 1).
    fetchMock.mockResolvedValue(response(401, '{"success":false}'));
    render(<ExportDataRow />);

    fireEvent.click(row());

    await waitFor(() => expect(assign).toHaveBeenCalledWith(SIGN_IN_ROUTE));
    // Through the clear-session route, so a cookie still in the jar is cleared
    // rather than bouncing `/login` back into the shell — and the return
    // survives.
    expect(SIGN_IN_ROUTE).toMatch(/^\/api\/auth\/clear-session\?returnUrl=%2Fapp%2Faccount$/);
    expect(screen.getByRole('status').textContent).toBe(EXPORT_COPY.busy);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('answers any other refusal, or a network failure, in the guide’s words', async () => {
    fetchMock.mockResolvedValueOnce(response(500, '{"success":false}'));
    const { unmount } = render(<ExportDataRow />);
    fireEvent.click(row());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(EXPORT_COPY.failed));
    unmount();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<ExportDataRow />);
    fireEvent.click(row());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(EXPORT_COPY.failed));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('announces through ONE always-mounted status region that is a sibling of the button', async () => {
    // A live region inside a <button> is flattened out of the accessibility
    // tree — a button's children are presentational — so the first shape was
    // never announced. The region has to exist before its text changes, and
    // it has to be outside the button, which describes itself by it.
    fetchMock.mockResolvedValue(response(429));
    render(<ExportDataRow />);
    const region = screen.getByRole('status');
    expect(row().contains(region)).toBe(false);
    expect(row().getAttribute('aria-describedby')).toBe(region.id);
    expect(row().textContent).not.toContain(EXPORT_COPY.idle);

    fireEvent.click(row());

    await waitFor(() => expect(region.textContent).toBe(EXPORT_COPY.limited));
    // The SAME element, not a replacement.
    expect(screen.getByRole('status')).toBe(region);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the file by the reader’s calendar date, not UTC', () => {
    // 23:30 local on the 14th is the 15th in UTC for anyone east of Greenwich
    // — and 08:00 on the 15th in Sydney is still the 14th in UTC. Local parts.
    const local = new Date(2026, 8, 14, 23, 30);
    expect(exportFilename(local)).toBe('lelanea-my-data-2026-09-14.json');
  });

  it('keeps to the register: no exclamation points, nothing that reads as blame', () => {
    for (const line of Object.values(EXPORT_COPY)) {
      expect(line).not.toContain('!');
      expect(line).not.toMatch(/\berror\b|\binvalid\b|\bfailed\b/i);
    }
  });
});
