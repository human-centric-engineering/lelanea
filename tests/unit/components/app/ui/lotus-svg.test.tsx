// @vitest-environment happy-dom

/**
 * The SVG painter: every kind of shape in the draw list becomes the element
 * that paints it, with gradients referenced by ids that are unique per bloom,
 * and colours through whichever `paint` the caller supplies — live CSS for the
 * page, literals for the baked assets.
 *
 * @see components/app/ui/lotus-svg.tsx
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LotusShape } from '@/components/app/ui/lotus-draw';
import { lotusSvgElements } from '@/components/app/ui/lotus-svg';

const SHAPES: LotusShape[] = [
  {
    kind: 'band',
    points: [0, 0, 10, 0, 10, 10],
    from: [0, 0],
    to: [0, 10],
    stops: [
      { offset: 0, colour: '--a' },
      { offset: 0.5, colour: { mix: ['--a', 'white', 0.25] } },
      { offset: 1, colour: '--b' },
    ],
  },
  { kind: 'line', points: [0, 0, 5, 5], colour: '--c', width: 2, opacity: 0.7 },
  {
    kind: 'fill',
    points: [0, 0, 4, 0, 4, 4],
    colour: '--d',
    opacity: 0.5,
    stroke: '--e',
    strokeWidth: 1,
  },
  { kind: 'ring', cx: 1, cy: 2, rx: 3, ry: 4, colour: '--f', width: 1, opacity: 0.3 },
  { kind: 'glow', cx: 0, cy: 0, rx: 9, ry: 6, colour: '--g', opacity: 0.8 },
];

function paint(prefix: string, colour?: Parameters<typeof lotusSvgElements>[2]) {
  return render(<svg>{lotusSvgElements(SHAPES, prefix, colour)}</svg>);
}

describe('lotusSvgElements', () => {
  it('paints a band as a gradient-filled path, stroked with its own fill', () => {
    paint('p');
    const gradient = document.querySelector('linearGradient');
    expect(gradient?.id).toBe('p-0');
    expect(gradient).toHaveAttribute('gradientUnits', 'userSpaceOnUse');
    expect(
      [...document.querySelectorAll('linearGradient stop')].map((s) => s.getAttribute('offset'))
    ).toEqual(['0%', '50%', '100%']);
    const band = document.querySelector('path[fill="url(#p-0)"]');
    expect(band).toHaveAttribute('stroke', 'url(#p-0)');
    expect(band).toHaveAttribute('d', 'M0 0L10 0L10 10Z');
  });

  it('reads colours as live CSS by default', () => {
    paint('p');
    const stops = [...document.querySelectorAll('linearGradient stop')].map((s) =>
      s.getAttribute('stop-color')
    );
    expect(stops).toEqual(['var(--a)', 'color-mix(in oklab, var(--a), white 25%)', 'var(--b)']);
  });

  it('paints lines open, fills closed, rings and glows as ellipses', () => {
    paint('p');
    expect(document.querySelector('path[fill="none"]')).toHaveAttribute('d', 'M0 0L5 5');
    expect(document.querySelector('path[fill="var(--d)"]')).toHaveAttribute('d', 'M0 0L4 0L4 4Z');
    const [ring, glow] = [...document.querySelectorAll('ellipse')];
    expect(ring).toHaveAttribute('stroke', 'var(--f)');
    expect(ring).toHaveAttribute('fill', 'none');
    expect(glow).toHaveAttribute('fill', 'url(#p-4)');
    expect(document.querySelector('radialGradient#p-4 stop:last-child')).toHaveAttribute(
      'stop-opacity',
      '0'
    );
  });

  it('keeps two blooms’ gradients apart by prefix', () => {
    render(
      <>
        <svg>{lotusSvgElements(SHAPES, 'one')}</svg>
        <svg>{lotusSvgElements(SHAPES, 'two')}</svg>
      </>
    );
    const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('takes a caller’s colour reader, as the baked assets do', () => {
    paint('p', (c) => (typeof c === 'string' ? `literal${c}` : 'literal-mix'));
    expect(document.querySelector('linearGradient stop')).toHaveAttribute(
      'stop-color',
      'literal--a'
    );
    expect(document.querySelector('ellipse')).toHaveAttribute('stroke', 'literal--f');
  });
});
