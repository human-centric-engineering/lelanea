// @vitest-environment happy-dom

/**
 * `useConsentBannerClearance` — how far the cookie banner reaches up the
 * viewport, so a control pinned to the bottom can sit above it (t-117).
 *
 * The consent state is Sunrise's public `ConsentContext`, provided directly. The banner is a stand-in
 * element carrying the one piece of the real banner's markup the hook relies on
 * (`CONSENT_BANNER_SELECTOR`), and the last test pins that against the real
 * banner's source.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, renderHook } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_BANNER_SELECTOR,
  useConsentBannerClearance,
} from '@/components/app/ui/consent-clearance';
import { ConsentContext, type ConsentContextValue } from '@/lib/consent';

/** Whether a banner is owed: consent initialised and no choice made. */
const owed = { current: true };

function Consent({ children }: { children: React.ReactNode }) {
  const value = {
    isInitialized: true,
    hasConsented: !owed.current,
  } as ConsentContextValue;
  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

const renderClearance = () => renderHook(() => useConsentBannerClearance(), { wrapper: Consent });

/** ResizeObserver callbacks, so a test can resize the banner. */
let resized: (() => void)[] = [];

function addBanner(height: number): HTMLElement {
  const banner = document.createElement('div');
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.getBoundingClientRect = () => ({ height }) as DOMRect;
  document.body.appendChild(banner);
  return banner;
}

beforeEach(() => {
  owed.current = true;
  resized = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('useConsentBannerClearance', () => {
  it('is the banner’s height while it shows', () => {
    addBanner(131.4);
    const { result } = renderClearance();
    expect(result.current).toBe(132);
  });

  it('waits for a banner that is owed but not yet drawn', async () => {
    const { result } = renderClearance();
    expect(result.current).toBe(0);
    await act(async () => {
      addBanner(96);
      await Promise.resolve();
    });
    expect(result.current).toBe(96);
  });

  it('follows the banner as it resizes, as it does when its row stacks', () => {
    const banner = addBanner(96);
    const { result } = renderClearance();
    banner.getBoundingClientRect = () => ({ height: 220 }) as DOMRect;
    act(() => resized.forEach((callback) => callback()));
    expect(result.current).toBe(220);
  });

  it('is nothing once consent is given', () => {
    addBanner(96);
    const { result, rerender } = renderClearance();
    owed.current = false;
    rerender();
    expect(result.current).toBe(0);
  });

  it('is nothing when no banner is owed', () => {
    owed.current = false;
    addBanner(96);
    const { result } = renderClearance();
    expect(result.current).toBe(0);
  });
});

describe('outside a consent provider', () => {
  it('is nothing, rather than throwing', () => {
    addBanner(96);
    const { result } = renderHook(() => useConsentBannerClearance());
    expect(result.current).toBe(0);
  });
});

describe('the selector', () => {
  it('names what the real banner renders', () => {
    // Read as text: the banner is Sunrise's, and a change to its role or name
    // would leave the gate's button under it again with nothing failing.
    const source = readFileSync(
      join(process.cwd(), 'components/cookie-consent/cookie-banner.tsx'),
      'utf8'
    );
    expect(CONSENT_BANNER_SELECTOR).toBe('[role="dialog"][aria-label="Cookie consent"]');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-label="Cookie consent"');
  });
});
