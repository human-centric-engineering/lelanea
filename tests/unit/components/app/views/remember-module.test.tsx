// @vitest-environment happy-dom

/**
 * The write half of "Workspace goes to the last module visited". The read
 * half is `shell-nav.test.tsx`; the two share the key through
 * `LAST_MODULE_STORAGE_KEY`, and this is what proves something writes it.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RememberModule } from '@/components/app/views/remember-module';
import { LAST_MODULE_STORAGE_KEY } from '@/lib/app/journey/paths';

beforeEach(() => window.localStorage.clear());

describe('RememberModule', () => {
  it('renders nothing and writes the slug under the key the nav reads', () => {
    const { container } = render(<RememberModule slug="boundaries" />);

    expect(container).toBeEmptyDOMElement();
    expect(window.localStorage.getItem(LAST_MODULE_STORAGE_KEY)).toBe(JSON.stringify('boundaries'));
  });

  it('follows the reader from one module to the next', () => {
    const { rerender } = render(<RememberModule slug="values" />);
    rerender(<RememberModule slug="oneness" />);

    expect(window.localStorage.getItem(LAST_MODULE_STORAGE_KEY)).toBe(JSON.stringify('oneness'));
  });
});
