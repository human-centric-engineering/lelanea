// @vitest-environment happy-dom

/**
 * The email chrome — the one property a screenshot cannot hold: that its
 * colours ARE the brand tokens, not a copy that drifted.
 *
 * Reads `app/brand-theme.css` from the tree on purpose: the palette is written
 * out in the component because email has no `var()`, so the only thing tying
 * it to the theme is this test. It reads the repo root, and is not an
 * always-run test — its trigger is the component, which imports nothing from
 * the CSS; a theme change alone would not select it. That gap is accepted and
 * named here rather than papered over: the theme's own tests will not notice
 * an email, and this one will not notice the theme until the next email edit.
 *
 * @see components/app/emails/lelanea-email.tsx
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render } from '@react-email/render';
import { Text } from '@react-email/components';
import { describe, expect, it } from 'vitest';

import { EMAIL_PALETTE, LelaneaEmail } from '@/components/app/emails/lelanea-email';

const css = readFileSync(path.join(process.cwd(), 'app', 'brand-theme.css'), 'utf8');

/** The first (light) declaration of a token in the theme. */
function lightToken(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`app/brand-theme.css declares no --color-${name}`);
  return match[1].trim();
}

describe('LelaneaEmail — the palette is the theme', () => {
  it.each([
    ['background', 'background'],
    ['card', 'popover'],
    ['heading', 'heading'],
    ['foreground', 'foreground'],
    ['muted', 'muted-foreground'],
    ['primary', 'primary'],
    ['primaryForeground', 'primary-foreground'],
    ['divider', 'divider'],
  ] as const)('%s is --color-%s', (key, token) => {
    expect(EMAIL_PALETTE[key]).toBe(lightToken(token));
  });
});

describe('LelaneaEmail — the frame', () => {
  async function frame() {
    return render(
      <LelaneaEmail preview="A preview." baseUrl="https://example.com" reason="Because.">
        <Text>the words</Text>
      </LelaneaEmail>
    );
  }

  it('paints the ground on a classed element, so the dark-mode rule can reach it', async () => {
    // React Email mirrors Body's inline background onto a wrapping <td> that
    // carries no class; a rule on <body> alone left a light ground painted over
    // a dark one. The ground lives on our own Section and the rule targets it.
    const html = await frame();
    expect(html).toMatch(/class="[^"]*lelanea-ground/);
    expect(html).toContain('.lelanea-ground { background-color:');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('<meta name="color-scheme" content="light dark"');
  });

  it('carries the lotus as a PNG from the app origin, with empty alt', async () => {
    const html = await frame();
    expect(html).toContain('src="https://example.com/lotus-mark.png"');
    expect(html).toMatch(/<img[^>]*alt=""[^>]*lotus-mark\.png|<img[^>]*lotus-mark\.png[^>]*alt=""/);
  });

  it('puts the preview, the words and the reason where they belong', async () => {
    const html = await frame();
    expect(html).toContain('A preview.');
    expect(html).toContain('the words');
    expect(html).toContain('Because.');
  });
});
