/**
 * `/lelanea`'s "where to find her" list is derived from `SITE_LINKS` (t-171),
 * so a relabelled channel or a changed mark is one edit, not two.
 */

import { describe, expect, it } from 'vitest';

import { CREATOR_LINKS, SITE_CHANNELS, SITE_LINKS } from '@/lib/site/config';

describe('CREATOR_LINKS', () => {
  it('lists her site and three channels, in that order', () => {
    expect(CREATOR_LINKS.map((link) => link.label)).toEqual([
      'Integrating Consciousness',
      'Instagram',
      'YouTube',
      'Substack',
    ]);
  });

  it('takes every URL, mark and icon from the footer’s own entry', () => {
    for (const link of CREATOR_LINKS) {
      const source = SITE_LINKS.find((candidate) => candidate.label === link.label);
      expect(source, link.label).toBeDefined();
      expect(link.href).toBe(source?.href);
      expect(link.mark).toBe(source?.mark);
      expect(link.icon).toBe(source?.icon);
    }
  });

  it('keeps her site’s description and gives each channel its handle', () => {
    expect(CREATOR_LINKS.map((link) => link.detail)).toEqual([
      'Lelañea’s personal website',
      '@lelanea',
      '@lelaneafulton',
      'lelanea.substack.com',
    ]);
  });

  // Owner, 19 Nov 2026: she is not continuing the podcast on Spotify or Apple
  // Podcasts, so nothing on the site leads there.
  it('links to neither Spotify nor Apple Podcasts, anywhere', () => {
    const hrefs = [
      ...SITE_LINKS.map((link) => link.href),
      ...SITE_CHANNELS.flatMap((channel) => channel.links.map((link) => link.href)),
    ];
    expect(hrefs.filter((href) => /spotify\.com|podcasts\.apple\.com/.test(href ?? ''))).toEqual(
      []
    );
    const podcast = SITE_CHANNELS.find((channel) => channel.name === 'The podcast');
    expect(podcast?.links.map((link) => link.label)).toEqual(['YouTube']);
  });

  it('carries a mark or an icon on every link, never both', () => {
    for (const link of SITE_LINKS) {
      expect(Boolean(link.mark) !== Boolean(link.icon), link.label).toBe(true);
    }
  });
});
