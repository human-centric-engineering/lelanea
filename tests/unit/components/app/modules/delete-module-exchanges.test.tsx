// @vitest-environment happy-dom

/**
 * The offer to delete what the person said in one module, and its copy
 * (f-forget-session t-155).
 *
 * The client (`deleteModuleExchanges` in `notes-client.ts`) runs for real
 * against a stubbed global `fetch`, so what is proven is the exact request the
 * confirmation sends, not that a function was called.
 *
 * @see components/app/modules/delete-module-exchanges.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockRouter } from '@/tests/types/mocks';

const router = createMockRouter();
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/modules/values',
  useRouter: () => router,
}));

import {
  DeleteModuleExchanges,
  MODULE_DELETE_CONFIRM,
  MODULE_DELETE_COVERS,
  MODULE_DELETE_DONE,
  MODULE_DELETE_KEEPS,
  MODULE_DELETE_OFFER,
} from '@/components/app/modules/delete-module-exchanges';

interface Call {
  path: string;
  method: string;
  body: unknown;
}

const world = {
  calls: [] as Call[],
  /** Set to park the next response; cleared after one use. */
  nextResponse: null as Response | null,
};

const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
  world.calls.push({ path, method: init?.method ?? 'GET', body: init?.body });
  if (world.nextResponse) {
    const response = world.nextResponse;
    world.nextResponse = null;
    return response;
  }
  return new Response(JSON.stringify({ success: true, data: { exchanges: 2, messages: 5 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

function refusal(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message, details } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const offer = () => screen.queryByRole('button', { name: 'Delete what I said in this module' });
const confirm = () => screen.getByRole('button', { name: 'Delete what I said here' });
const group = () => screen.queryByRole('group', { name: 'Delete what you said in this module?' });

beforeEach(() => {
  world.calls = [];
  world.nextResponse = null;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the offer', () => {
  it('is made when the person said something in the module, and says what it is', () => {
    render(<DeleteModuleExchanges moduleSlug="values" exchanges={2} />);

    expect(offer()).toBeTruthy();
    expect(screen.getByText(MODULE_DELETE_OFFER)).toBeTruthy();
  });

  it('is not made when nothing of theirs is stamped with the module', () => {
    const { container } = render(<DeleteModuleExchanges moduleSlug="values" exchanges={0} />);

    expect(offer()).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('the confirmation', () => {
  it('asks first, says what goes, what it covers and what stays, and Cancel backs out without a call', async () => {
    render(<DeleteModuleExchanges moduleSlug="values" exchanges={2} />);

    await userEvent.click(offer()!);
    const asked = group()!;
    expect(asked.textContent).toContain(MODULE_DELETE_CONFIRM);
    // The dialog says plainly that only conversations since stamping began are covered.
    expect(asked.textContent).toContain(MODULE_DELETE_COVERS);
    expect(MODULE_DELETE_COVERS).toMatch(/only conversations since/);
    expect(asked.textContent).toContain(MODULE_DELETE_KEEPS);
    // No account tick: a module's worth is part of several sessions.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(world.calls).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(group()).toBeNull();
    expect(world.calls).toHaveLength(0);
  });

  it('sends one DELETE for the module, with no body, then re-reads the page and says it went', async () => {
    render(<DeleteModuleExchanges moduleSlug="inner-authority" exchanges={2} />);

    await userEvent.click(offer()!);
    await userEvent.click(confirm());

    expect(world.calls).toEqual([
      { path: '/api/v1/app/modules/inner-authority/exchanges', method: 'DELETE', body: undefined },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(MODULE_DELETE_DONE)).toBeTruthy();
  });

  it('keeps saying it went once the page re-reads with nothing left', async () => {
    const { rerender } = render(<DeleteModuleExchanges moduleSlug="values" exchanges={2} />);
    await userEvent.click(offer()!);
    await userEvent.click(confirm());

    rerender(<DeleteModuleExchanges moduleSlug="values" exchanges={0} />);

    expect(screen.getByText(MODULE_DELETE_DONE)).toBeTruthy();
    expect(offer()).toBeNull();
  });

  it('shows a still-answering refusal inside the confirmation, as not deleted, and stays open', async () => {
    world.nextResponse = refusal(
      409,
      'CONFLICT',
      'Lelañea is still answering that. Try again in a moment, once the reply has finished.',
      { reason: 'still_answering' }
    );
    render(<DeleteModuleExchanges moduleSlug="values" exchanges={2} />);

    await userEvent.click(offer()!);
    await userEvent.click(confirm());

    const asked = group()!;
    expect(asked.textContent).toContain('Not deleted.');
    expect(asked.textContent).toContain('Try again in a moment');
    expect(screen.queryByText(MODULE_DELETE_DONE)).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('re-reads the page when there turned out to be nothing left, and never says it went', async () => {
    world.nextResponse = refusal(
      404,
      'NOT_FOUND',
      'There is nothing you said in this module to delete.'
    );
    render(<DeleteModuleExchanges moduleSlug="values" exchanges={2} />);

    await userEvent.click(offer()!);
    await userEvent.click(confirm());

    expect(group()!.textContent).toContain('There is nothing you said in this module to delete.');
    expect(screen.queryByText(MODULE_DELETE_DONE)).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps saying why once the re-read finds nothing left in the module', async () => {
    world.nextResponse = refusal(
      404,
      'NOT_FOUND',
      'There is nothing you said in this module to delete.'
    );
    const { rerender } = render(<DeleteModuleExchanges moduleSlug="values" exchanges={2} />);
    await userEvent.click(offer()!);
    await userEvent.click(confirm());

    rerender(<DeleteModuleExchanges moduleSlug="values" exchanges={0} />);

    expect(screen.getByText('There is nothing you said in this module to delete.')).toBeTruthy();
    expect(screen.queryByText(MODULE_DELETE_DONE)).toBeNull();
    expect(offer()).toBeNull();
  });

  it('says a failed connection plainly', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<DeleteModuleExchanges moduleSlug="values" exchanges={2} />);

    await userEvent.click(offer()!);
    await userEvent.click(confirm());

    expect(group()!.textContent).toContain('Check your connection and try again.');
  });
});
