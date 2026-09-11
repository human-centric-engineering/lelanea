import { render, type RenderResult } from '@testing-library/react';

import { ShellLayoutProvider } from '@/components/app/shell/use-shell-layout';

/**
 * Render a shell component inside the layout provider, at a stated viewport.
 *
 * **Name the width you mean.** `happy-dom` defaults `window.innerWidth` to
 * 1024, which the provider classifies as `medium` — and medium is below the
 * 1100px auto-slim threshold, so a test inheriting that default would silently
 * run against a *collapsed* nav on a *tablet*, and every assertion about
 * labels, tooltips or the pane switch would be measuring a layout the author
 * never chose.
 *
 * The parameter therefore defaults to `large` rather than being required —
 * `renderInShell(ui)` is a 1400px test, not a 1024px one, which is the sane
 * fallback and is what the call sites that omit it are relying on. An earlier
 * version of this comment said the width "has to be stated" and that requiring
 * it was "the point", which was true of a draft signature and not of this one:
 * `.context/app/shell.md` repeated the claim in good faith and a docs audit
 * caught both. State a width whenever the case is ABOUT a width; inherit
 * `large` when it is not.
 */
export const WIDTHS = {
  /** Above 1240: both panes side by side, nav at the reader's preference. */
  large: 1400,
  /**
   * 901–1240: the conversation parks as a slide-over, and the nav is slim.
   *
   * 1000, not 1100. The auto-slim threshold is `w < 1100`, so 1100 itself does
   * NOT slim — a fixture named `medium` that leaves the nav expanded, while its
   * own comment says the nav slims here, is a trap for whoever writes the next
   * case. One test already worked around it with a bare literal and a note.
   */
  medium: 1000,
  /** ≤900: nav is a drawer, the panes are a carousel. */
  small: 800,
} as const;

export type WidthName = keyof typeof WIDTHS;

/** Set the viewport before render, so the provider's first pass sees it. */
export function setViewport(width: WidthName | number) {
  const px = typeof width === 'number' ? width : WIDTHS[width];
  Object.defineProperty(window, 'innerWidth', { value: px, writable: true, configurable: true });
  return px;
}

export function renderInShell(
  ui: React.ReactElement,
  width: WidthName | number = 'large'
): RenderResult {
  setViewport(width);
  const result = render(<ShellLayoutProvider>{ui}</ShellLayoutProvider>);
  return {
    ...result,
    /*
     * Re-wrap on rerender, or the provider is dropped and every consumer throws.
     *
     * This is the only way to test a client-side NAVIGATION: the route changes
     * while the provider instance lives on, which is exactly the case that hid
     * a real defect — state left over from the route you came from.
     * Re-rendering into a fresh provider resets that state and proves nothing.
     */
    rerender: (next: React.ReactNode) =>
      result.rerender(<ShellLayoutProvider>{next}</ShellLayoutProvider>),
  };
}
