// @vitest-environment happy-dom

/**
 * The shell's landing view, while it is still a placeholder.
 *
 * `t-10` replaces this with the conversation pane and the workspace. Until
 * then it has one job: be honest about being empty. D6 says the panes are a
 * deliberate stub with one plain line, and the way that goes wrong is a mocked
 * conversation — an invented transcript, a fake turn count — which reads as a
 * working product to anyone looking at a screenshot.
 *
 * @see app/(lelanea)/app/page.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ShellHomePage from '@/app/(lelanea)/app/page';

describe('the shell landing view', () => {
  it('says what the space is for', () => {
    render(<ShellHomePage />);
    expect(screen.getByText('The conversation')).toBeTruthy();
  });

  it('says plainly that the conversation is not here yet', () => {
    render(<ShellHomePage />);
    expect(screen.getByText(/arrives in a later phase/)).toBeTruthy();
  });

  it('invents no number', () => {
    // The same rule t-11 puts on every placeholder view: no fake sessions, no
    // fake spend, no counts. A digit here is the tell.
    const { container } = render(<ShellHomePage />);
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('mocks up no conversation', () => {
    // No transcript, no composer, no send button masquerading as a real one.
    render(<ShellHomePage />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
