// @vitest-environment happy-dom

/**
 * The shell's clean view renders nothing, and that is the assertion.
 *
 * t-9 gave `/app` a placeholder saying the conversation arrives later. t-10
 * moved that copy into `ConversationPane`, which the layout renders for every
 * route in the group — so a page that still returned it would put a second copy
 * *underneath* the pane already saying it, and the two would drift.
 *
 * The honest-content rules t-9 put here (no invented number, no mocked-up
 * conversation) moved with the copy, to `conversation-pane.test.tsx`.
 *
 * @see app/(lelanea)/app/page.tsx
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ShellHomePage from '@/app/(lelanea)/app/page';

describe('the shell clean view', () => {
  it('renders nothing, leaving the pane to be the view', () => {
    const { container } = render(<ShellHomePage />);
    expect(container.firstChild).toBeNull();
  });

  it('still exists as a route, because everything lands here', () => {
    // `auth-landing.ts` sends every signed-in visitor to `/app`, and `wsOpen`
    // tests against it. Deleting the page to "tidy up" would 404 the landing.
    expect(typeof ShellHomePage).toBe('function');
  });
});
