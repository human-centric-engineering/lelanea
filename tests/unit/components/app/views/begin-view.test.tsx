// @vitest-environment happy-dom

/**
 * The gate's controls: what each shows before and after, what a click does,
 * and what the page becomes once all three stand.
 *
 * `apiClient` is mocked at the boundary the view actually calls, and the
 * status it answers with is what the view must display — the view replaces
 * its state with the server's answer rather than flipping a flag, and the
 * double-answer case below is what proves it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: { post } }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentPropsWithoutRef<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  ACKNOWLEDGEMENTS_ROUTE,
  BeginView,
  CONTROL_COPY,
  DID_NOT_LAND,
  formatRecordDate,
  SHELL_ROUTE,
} from '@/components/app/views/begin-view';
import type { GateStatusJson, KindStatusJson } from '@/lib/app/gateway/kinds';

const AT = '2026-09-01T00:00:00.000Z';

function kind(
  name: KindStatusJson['kind'],
  satisfied: boolean,
  documentId: string | null = name === 'age_18' ? null : name
): KindStatusJson {
  return {
    kind: name,
    requiredVersion: name === 'age_18' ? '18' : '1.1',
    documentId,
    satisfied,
    acknowledgedAt: satisfied ? AT : null,
  };
}

function status(...satisfied: KindStatusJson['kind'][]): GateStatusJson {
  const kinds = (['disclaimer', 'terms', 'age_18'] as const).map((name) =>
    kind(name, satisfied.includes(name))
  );
  const outstanding = kinds.filter((entry) => !entry.satisfied).map((entry) => entry.kind);
  return { complete: outstanding.length === 0, kinds, outstanding };
}

const DOCUMENTS = {
  disclaimer: <p>the disclaimer, in full</p>,
  terms: <p>the terms, in full</p>,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BeginView, before anything stands', () => {
  it('renders both documents and one action per kind, and no Begin', () => {
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    expect(screen.getByText('the disclaimer, in full')).toBeTruthy();
    expect(screen.getByText('the terms, in full')).toBeTruthy();
    for (const copy of Object.values(CONTROL_COPY)) {
      expect(screen.getByRole('button', { name: copy.action })).toBeTruthy();
      expect(screen.getByText(copy.statement)).toBeTruthy();
    }
    expect(screen.queryByRole('link', { name: 'Begin' })).toBeNull();
    expect(screen.getByText(/Begin once all three stand/)).toBeTruthy();
  });

  it('keeps to the register: sentence case, no exclamation points', () => {
    const { container } = render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);
    expect(container.textContent).not.toContain('!');
    for (const copy of Object.values(CONTROL_COPY)) {
      expect(copy.action).toMatch(/^[A-Z][^A-Z]*$|^I /);
    }
  });
});

describe('acknowledging', () => {
  it('posts the kind and replaces the status with the server’s answer', async () => {
    post.mockResolvedValue(status('disclaimer'));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    fireEvent.click(screen.getByRole('button', { name: CONTROL_COPY.disclaimer.action }));

    await waitFor(() => expect(screen.getByTestId('record-disclaimer')).toBeTruthy());
    expect(post).toHaveBeenCalledWith(ACKNOWLEDGEMENTS_ROUTE, { body: { kind: 'disclaimer' } });
    // The record line: the copy, and the date from the server.
    expect(screen.getByTestId('record-disclaimer').textContent).toContain(
      CONTROL_COPY.disclaimer.record
    );
    expect(screen.getByTestId('record-disclaimer').textContent).toContain(formatRecordDate(AT));
    // The other two are still actions.
    expect(screen.getByRole('button', { name: CONTROL_COPY.terms.action })).toBeTruthy();
    expect(screen.getByRole('button', { name: CONTROL_COPY.age_18.action })).toBeTruthy();
  });

  it('shows what the SERVER says stands, not what was clicked', async () => {
    // The ledger answers with more than the click changed — a second tab, or
    // an earlier acknowledgement this paint did not know about. The view must
    // take the answer whole.
    post.mockResolvedValue(status('disclaimer', 'terms'));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    fireEvent.click(screen.getByRole('button', { name: CONTROL_COPY.disclaimer.action }));

    await waitFor(() => expect(screen.getByTestId('record-terms')).toBeTruthy());
  });

  it('opens Begin once the answer says every kind stands', async () => {
    post.mockResolvedValue(status('disclaimer', 'terms', 'age_18'));
    render(<BeginView initialStatus={status('disclaimer', 'terms')} documents={DOCUMENTS} />);

    fireEvent.click(screen.getByRole('button', { name: CONTROL_COPY.age_18.action }));

    const begin = await screen.findByRole('link', { name: 'Begin' });
    expect(begin.getAttribute('href')).toBe(SHELL_ROUTE);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so, in the guide’s words, when the post does not land — and keeps the action', async () => {
    post.mockRejectedValue(new Error('network'));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    fireEvent.click(screen.getByRole('button', { name: CONTROL_COPY.terms.action }));

    expect((await screen.findByRole('alert')).textContent).toBe(DID_NOT_LAND);
    expect(screen.getByRole('button', { name: CONTROL_COPY.terms.action })).toBeTruthy();
    expect(screen.queryByTestId('record-terms')).toBeNull();
  });

  it('disables every action while one is in flight', async () => {
    let settle: (value: GateStatusJson) => void = () => {};
    post.mockReturnValue(new Promise<GateStatusJson>((resolve) => (settle = resolve)));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    fireEvent.click(screen.getByRole('button', { name: CONTROL_COPY.disclaimer.action }));

    await waitFor(() => {
      for (const button of screen.getAllByRole('button')) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
      }
    });
    settle(status('disclaimer'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONTROL_COPY.terms.action }).disabled).toBe(false)
    );
  });
});

describe('BeginView afterwards — the record', () => {
  it('renders every kind as a fact with its date, and Begin', () => {
    render(
      <BeginView initialStatus={status('disclaimer', 'terms', 'age_18')} documents={DOCUMENTS} />
    );

    for (const name of ['disclaimer', 'terms', 'age_18'] as const) {
      const record = screen.getByTestId(`record-${name}`);
      expect(record.textContent).toContain(CONTROL_COPY[name].record);
      expect(record.querySelector('time')?.getAttribute('dateTime')).toBe(AT);
    }
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Begin' })).toBeTruthy();
  });

  it('formats the record date the same way wherever it renders', () => {
    // UTC, so server and browser agree — see the formatter's note.
    expect(formatRecordDate('2026-09-01T23:30:00.000Z')).toBe('1 September 2026');
  });
});
