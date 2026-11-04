// @vitest-environment happy-dom

/**
 * The agent's mark beside a reply: the flat lotus with no light over it
 * (t-183), so a conversation is not a column of hearts beating out of step.
 *
 * @see components/app/conversation/turns.tsx
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HerMark } from '@/components/app/conversation/turns';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';

describe('HerMark', () => {
  it('is the flat lotus, with nothing drawn over it', () => {
    const { container } = render(<HerMark />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/dot-lotus-mark.svg');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('is named by its title, the flower itself decoration', () => {
    const { container } = render(<HerMark />);
    expect(container.firstElementChild).toHaveAttribute('title', CONVERSATION_COPY.herMark);
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true');
  });
});
