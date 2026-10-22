// @vitest-environment happy-dom

/**
 * The mission's ripple (t-171) draws one sentence of hers as a picture. Its
 * words are hers or it has no business on the page, so the load-bearing test
 * reads them against the authored mission rather than against a copy.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MissionRipple, RIPPLE_CENTRE, RIPPLE_RINGS } from '@/components/app/site/mission-ripple';
import { toDocumentDetail } from '@/lib/app/content/document-view';
import { seededDocumentRows } from '@/tests/helpers/app/foundational-documents';

function missionText(): string {
  const row = seededDocumentRows().find((candidate) => candidate.slug === 'the_mission');
  if (!row) throw new Error('the_mission is missing');
  return toDocumentDetail(row)
    .blocks.map((block) => (block.type === 'list' ? block.items.join(' ') : block.text))
    .join(' ')
    .toLowerCase();
}

describe('MissionRipple', () => {
  it('uses only words she wrote in the mission', () => {
    const text = missionText();

    // Population first: five rings and a centre, so this is not a pass on an
    // empty list.
    expect(RIPPLE_RINGS).toHaveLength(5);
    expect(text).toContain(RIPPLE_CENTRE);
    for (const word of RIPPLE_RINGS) {
      expect(text, `"${word}" is not in the_mission`).toContain(word);
    }
  });

  it('keeps her order, from the nearest circle outward', () => {
    const text = missionText();
    const positions = RIPPLE_RINGS.map((word) => text.indexOf(word));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('is one image to assistive technology, described in full', () => {
    render(<MissionRipple />);

    const figure = screen.getByRole('img', { name: /one awakened life, widening to families/ });
    expect(figure.getAttribute('aria-label')).toContain('cultures');
    // The visible labels are hidden from the accessibility tree, so the
    // description is not read a second time word by word.
    const hidden = [...figure.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent);
    expect(hidden.some((text) => text?.includes('communities'))).toBe(true);
    // Nothing visible inside the figure is outside a hidden layer.
    expect(figure.querySelectorAll(':scope > :not([aria-hidden="true"]):not(img)')).toHaveLength(0);
  });
});
