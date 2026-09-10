// @vitest-environment happy-dom

/**
 * `/privacy` — Sunrise's template, kept and labelled (D8, divergence row 10).
 *
 * This page is upstream's, and t-6 added exactly two things to it: a `noindex`
 * and a notice saying the policy is interim. Both are the kind of edit that a
 * Daybreak sync silently reverts — the conflict resolution "take upstream" is
 * always available and always looks reasonable — and the result would be
 * lelanea.com serving "This is a placeholder privacy policy" as its privacy
 * policy, indexed, with nothing saying otherwise.
 *
 * So these cases exist to fail on that merge. They are the ledger row's teeth.
 *
 * The starter's own body is deliberately not asserted: it is upstream's to
 * change, and pinning it here would make every sync a test failure for no
 * reason. Only the two additions are pinned.
 *
 * FORK NOTE: reads no `lib/app/*` seam. A fork that has written its own privacy
 * policy should delete this file along with the notice — see row 10's deletion
 * trigger, which says the same thing.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import PrivacyPage, { metadata } from '@/app/(public)/privacy/page';

describe('/privacy while the policy is still the starter template', () => {
  it('says plainly that it is interim', () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/this is an interim policy/i)).toBeTruthy();
  });

  it('points at the two pages that ARE accurate today', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('link', { name: 'Your data' }).getAttribute('href')).toBe('/data');
    expect(screen.getByRole('link', { name: 'the disclosures' }).getAttribute('href')).toBe(
      '/disclaimer'
    );
  });

  it('is withheld from search', () => {
    // Without this, a search for lelanea.com's privacy policy returns a page
    // reading "Replace this content with your actual privacy policy".
    expect(metadata.robots).toEqual({ index: false });
  });

  it('still renders the template body it is labelling', () => {
    // The notice describes something ("the template below"), so the something
    // has to be there. If a sync ever removed the body and left the notice, the
    // page would announce an interim policy and then show nothing.
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(3);
  });
});
