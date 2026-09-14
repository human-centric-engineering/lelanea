// @vitest-environment happy-dom

/**
 * The gate, one step at a time: which step shows, what a click does, and what
 * the page becomes once all three stand.
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
  ACCOUNT_ROUTE,
  ACKNOWLEDGEMENTS_ROUTE,
  AGE_STEP_BODY,
  BeginView,
  DID_NOT_LAND,
  formatRecordDate,
  SHELL_ROUTE,
  STEP_COPY,
} from '@/components/app/views/begin-view';
import type { GateStatusJson, KindStatusJson } from '@/lib/app/gateway/kinds';

const AT = '2026-09-01T00:00:00.000Z';

function kind(name: KindStatusJson['kind'], satisfied: boolean): KindStatusJson {
  return {
    kind: name,
    requiredVersion: name === 'age_18' ? '18' : '1.1',
    documentId: name === 'age_18' ? null : name,
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

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BeginView shows ONE step — the first outstanding kind', () => {
  it('opens on the disclaimer, alone, with its control in view and no Begin', () => {
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    expect(screen.getByTestId('step-disclaimer')).toBeTruthy();
    expect(screen.getByText('the disclaimer, in full')).toBeTruthy();
    // The other two are NOT on the page: one thing at a time.
    expect(screen.queryByText('the terms, in full')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(button(STEP_COPY.disclaimer.action)).toBeTruthy();
    expect(screen.getByText(/one of three/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Begin' })).toBeNull();
  });

  it('lands on the third step for someone who did two last week', () => {
    render(<BeginView initialStatus={status('disclaimer', 'terms')} documents={DOCUMENTS} />);

    expect(screen.getByTestId('step-age_18')).toBeTruthy();
    expect(screen.getByText(/three of three/)).toBeTruthy();
    expect(screen.queryByTestId('document-pane')).toBeNull();
    expect(button(STEP_COPY.age_18.action)).toBeTruthy();
    // No document, so the step says what the confirmation is rather than
    // leaving a viewport of nothing above the button (owner, walk-through) —
    // and it is not a fixed-height frame.
    for (const paragraph of AGE_STEP_BODY) {
      expect(screen.getByText(paragraph)).toBeTruthy();
    }
    expect(screen.getByTestId('step-age_18').className).not.toContain('h-dvh');
  });

  it('gives a document step the fixed frame, so the control never leaves the viewport', () => {
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);
    expect(screen.getByTestId('step-disclaimer').className).toContain('h-dvh');
  });

  it('puts the document in its own scroll pane, so the control is never below the text', () => {
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);
    const pane = screen.getByTestId('document-pane');
    expect(pane.className).toContain('overflow-y-auto');
    expect(pane.className).toContain('min-h-0');
    expect(pane.textContent).toContain('the disclaimer, in full');
  });

  it('keeps to the register: sentence case, no exclamation points', () => {
    const { container } = render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);
    expect(container.textContent).not.toContain('!');
    for (const copy of Object.values(STEP_COPY)) {
      expect(copy.action).not.toMatch(/\b[A-Z][a-z]+ [A-Z]/);
    }
  });
});

describe('acknowledging moves the step on', () => {
  it('posts the kind and shows the NEXT step from the server’s answer', async () => {
    post.mockResolvedValue(status('disclaimer'));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    fireEvent.click(button(STEP_COPY.disclaimer.action));

    await waitFor(() => expect(screen.getByTestId('step-terms')).toBeTruthy());
    expect(post).toHaveBeenCalledWith(ACKNOWLEDGEMENTS_ROUTE, { body: { kind: 'disclaimer' } });
    expect(screen.getByText('the terms, in full')).toBeTruthy();
    expect(screen.queryByText('the disclaimer, in full')).toBeNull();
    expect(screen.getByText(/two of three/)).toBeTruthy();
  });

  it('opens the next document at the top — a fresh pane, not the last one scrolled', async () => {
    // React reuses a div in the same tree position and keeps its scrollTop, so
    // step two inherited wherever step one was scrolled to. The pane is keyed
    // by step; the assertion is on element identity, which is what the key
    // changes.
    post.mockResolvedValue(status('disclaimer'));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);
    const first = screen.getByTestId('document-pane');
    first.scrollTop = 400;

    fireEvent.click(button(STEP_COPY.disclaimer.action));

    await waitFor(() => expect(screen.getByTestId('step-terms')).toBeTruthy());
    const second = screen.getByTestId('document-pane');
    expect(second).not.toBe(first);
    expect(second.scrollTop).toBe(0);
  });

  it('shows what the SERVER says stands, not what was clicked', async () => {
    // The ledger answers with more than the click changed — a second tab, or
    // an earlier acknowledgement this paint did not know about. The view must
    // take the answer whole: here it skips straight to the age step.
    post.mockResolvedValue(status('disclaimer', 'terms'));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    fireEvent.click(button(STEP_COPY.disclaimer.action));

    await waitFor(() => expect(screen.getByTestId('step-age_18')).toBeTruthy());
  });

  it('becomes the record, with Begin, once the answer says every kind stands', async () => {
    post.mockResolvedValue(status('disclaimer', 'terms', 'age_18'));
    render(<BeginView initialStatus={status('disclaimer', 'terms')} documents={DOCUMENTS} />);

    fireEvent.click(button(STEP_COPY.age_18.action));

    const begin = await screen.findByRole('link', { name: 'Begin' });
    expect(begin.getAttribute('href')).toBe(SHELL_ROUTE);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so, in the guide’s words, when the post does not land — and stays on the step', async () => {
    post.mockRejectedValue(new Error('network'));
    render(<BeginView initialStatus={status('disclaimer')} documents={DOCUMENTS} />);

    fireEvent.click(button(STEP_COPY.terms.action));

    expect((await screen.findByRole('alert')).textContent).toBe(DID_NOT_LAND);
    expect(screen.getByTestId('step-terms')).toBeTruthy();
    expect(button(STEP_COPY.terms.action).disabled).toBe(false);
  });

  it('disables the action while the post is in flight', async () => {
    let settle: (value: GateStatusJson) => void = () => {};
    post.mockReturnValue(new Promise<GateStatusJson>((resolve) => (settle = resolve)));
    render(<BeginView initialStatus={status()} documents={DOCUMENTS} />);

    fireEvent.click(button(STEP_COPY.disclaimer.action));

    await waitFor(() => expect(button(STEP_COPY.disclaimer.action).disabled).toBe(true));
    settle(status('disclaimer'));
    await waitFor(() => expect(screen.getByTestId('step-terms')).toBeTruthy());
  });
});

describe('BeginView afterwards — the record', () => {
  it('renders every kind as a fact with its date, a way back to each text, and Return', () => {
    // Loaded already complete — someone who came back to read it, from the
    // account view. They began some time ago, so the way on is Return, not
    // Begin.
    render(
      <BeginView initialStatus={status('disclaimer', 'terms', 'age_18')} documents={DOCUMENTS} />
    );

    for (const name of ['disclaimer', 'terms', 'age_18'] as const) {
      const record = screen.getByTestId(`record-${name}`);
      expect(record.textContent).toContain(STEP_COPY[name].record);
      expect(record.querySelector('time')?.getAttribute('dateTime')).toBe(AT);
    }
    // No walls of text here either: the documents are a link away.
    expect(screen.queryByText('the disclaimer, in full')).toBeNull();
    const readAgain = screen.getAllByRole('link', { name: 'Read it again' });
    expect(readAgain.map((link) => link.getAttribute('href'))).toEqual(['/disclaimer', '/terms']);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Begin' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Return' }).getAttribute('href')).toBe(ACCOUNT_ROUTE);
  });

  it('formats the record date the same way wherever it renders', () => {
    // UTC, so server and browser agree — see the formatter's note.
    expect(formatRecordDate('2026-09-01T23:30:00.000Z')).toBe('1 September 2026');
  });
});
