// @vitest-environment happy-dom

/**
 * One radius across the shell's chrome — and the two things that are exempt.
 *
 * This exists because they drifted. Every icon-only control, every nav item and
 * every rail button draws the same thing — a highlight behind a glyph — and each
 * carried its own radius: `rounded-xl` in the nav, `rounded-[10px]` on the icon
 * buttons, `rounded-[14px]` in the footer, `rounded-[11px]` on a map row.
 * Individually each looked deliberate; together they read as a shell that could
 * not decide, which is what the owner saw and what `ICON_RADIUS` answers.
 *
 * A scan rather than a per-component assertion: the failure mode is a NEW
 * control arriving with its own number, and only a sweep of the directory
 * catches that.
 *
 * @see components/app/shell/chrome.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ICON_RADIUS } from '@/components/app/shell/chrome';

const SHELL_DIR = join(process.cwd(), 'components/app/shell');

/**
 * Radii that are allowed to be written as a literal, with the reason each is
 * not an icon highlight.
 */
const EXEMPT = new Set([
  'rounded-full', // the avatar disc, the send disc, and the map's status dots
  'rounded-[20px]', // the composer card
  'rounded-[18px]', // the resources panel's words card
  'rounded-[16px]', // the resources panel's video card — the prototype's `.videocard`
  'rounded-[14px]', // the resources panel's reading row — the prototype's `.readrow`
  'rounded-[9px]', // the tooltip bubble, which lives in components/app/ui
  'rounded-t-sm', // the ≤900px pane switch's sliding underline — a rule, not a box
]);

/** Every icon highlight, including the ≤900px footer's wider keys, is ONE value. */

/**
 * Comments are stripped before scanning, and that is not tidiness.
 *
 * These files explain themselves at length, and the prose says things like
 * "rounded-square" and quotes the literals it replaced. A scan that reads those
 * reports the documentation as the defect — which it did on the first run,
 * flagging a sentence describing the very rule it was enforcing.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function shellSources(): { file: string; source: string }[] {
  return readdirSync(SHELL_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => ({ file: f, source: readFileSync(join(SHELL_DIR, f), 'utf8') }));
}

describe('the shell draws one corner', () => {
  it('writes no icon-highlight radius as a literal', () => {
    const stray: string[] = [];
    for (const { file, source } of shellSources()) {
      if (file === 'chrome.ts') continue; // where the two constants are declared
      for (const [, cls] of withoutComments(source).matchAll(
        /(rounded-(?:\[[^\]]+\]|[a-z0-9-]+))/g
      )) {
        if (!EXEMPT.has(cls)) stray.push(`${file}: ${cls}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it('holds the corner at the 5px the owner set', () => {
    // Three passes landed here: 12px (the design's own `.lnav-item`), then 10,
    // then 8, each still reading as too soft against the real thing. Pinned by
    // VALUE rather than "is tighter than 12px", because the failure worth
    // catching is somebody nudging it back toward a default that looks fine in
    // isolation — which is exactly how the four radii this replaced began.
    expect(ICON_RADIUS).toBe('rounded-[5px]');
  });

  it('leaves the genuinely round things round', () => {
    // A disc is the thing itself; a highlight is chrome drawn behind something
    // else. Only the second is what `ICON_RADIUS` names, and rounding the
    // avatar or the send button into a square would be the constant applied
    // past its own meaning.
    // The avatar disc moved out of `shell-nav.tsx` into Sunrise's `<Avatar>`,
    // which draws its own circle — so the assertion follows it there rather
    // than looking for a literal the shell no longer writes.
    const avatar = readFileSync(join(process.cwd(), 'components/ui/avatar.tsx'), 'utf8');
    const pane = readFileSync(join(SHELL_DIR, 'conversation-pane.tsx'), 'utf8');

    expect(avatar).toContain('rounded-full'); // the account avatar
    expect(pane).toContain('rounded-full'); // the filled send disc
  });
});
