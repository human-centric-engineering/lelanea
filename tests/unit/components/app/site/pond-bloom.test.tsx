// @vitest-environment happy-dom

/**
 * The closing bloom (t-171, t-182): the dotted lotus, waiting to be seen.
 *
 * @see components/app/site/pond-bloom.tsx
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/app/ui/dot-lotus', () => ({
  DotLotus: (props: { size: number; startInView?: boolean }) => (
    <div
      data-testid="dot-lotus"
      data-size={props.size}
      data-start-in-view={String(props.startInView)}
    />
  ),
}));

import { PondBloom } from '@/components/app/site/pond-bloom';

describe('PondBloom', () => {
  it('draws the lotus in light, unfolding only once it is seen', () => {
    const { getByTestId } = render(<PondBloom />);
    const flower = getByTestId('dot-lotus');
    expect(flower).toHaveAttribute('data-start-in-view', 'true');
    expect(flower).toHaveAttribute('data-size', '340');
  });

  it('takes the size it is given', () => {
    const { getByTestId } = render(<PondBloom size={280} />);
    expect(getByTestId('dot-lotus')).toHaveAttribute('data-size', '280');
  });
});
