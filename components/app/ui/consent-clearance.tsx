'use client';

import * as React from 'react';

import { ConsentContext } from '@/lib/consent';

/**
 * The cookie banner's accessible name — how it is found to be measured. The
 * banner is Sunrise's (`components/cookie-consent/cookie-banner.tsx`), and
 * this is the one part of its markup we rely on.
 */
export const CONSENT_BANNER_SELECTOR = '[role="dialog"][aria-label="Cookie consent"]';

/**
 * How far the cookie banner reaches up from the bottom of the viewport, in
 * pixels: `0` when there is no banner.
 *
 * ## Why this exists
 *
 * Sunrise's banner is `fixed bottom-0 z-50` over the whole page, so anything
 * pinned to the bottom of the viewport sits behind it until it is dismissed.
 * On the gate that was the one button on the page (t-117). No Sunrise seam
 * says how tall the banner is, and its height depends on the width (its row
 * stacks on a phone). So it is measured.
 *
 * Whether a banner is owed is `useShouldShowConsentBanner()`'s rule
 * (initialised, and no choice made yet), read from Sunrise's public
 * `ConsentContext` directly rather than through the hook, because the hook
 * throws outside a provider and a missing provider must not take the gate
 * down with it: no provider, no banner, no clearance.
 *
 * It is owed before it is drawn (the banner waits `BANNER_DELAY_MS`), so the
 * element is watched for until it appears, then measured as it resizes. Once
 * a choice is made nothing is owed and the clearance returns to `0`.
 */
export function useConsentBannerClearance(): number {
  const consent = React.useContext(ConsentContext);
  const owed = consent !== undefined && consent.isInitialized && !consent.hasConsented;
  const [height, setHeight] = React.useState(0);

  React.useEffect(() => {
    if (!owed) {
      setHeight(0);
      return;
    }

    let resize: ResizeObserver | null = null;
    const measure = (banner: Element): void => {
      setHeight(Math.ceil(banner.getBoundingClientRect().height));
    };
    const attach = (): boolean => {
      const banner = document.querySelector(CONSENT_BANNER_SELECTOR);
      if (!banner) return false;
      measure(banner);
      resize = new ResizeObserver(() => measure(banner));
      resize.observe(banner);
      return true;
    };

    if (attach()) return () => resize?.disconnect();

    // Not drawn yet: wait for it.
    const appear = new MutationObserver(() => {
      if (attach()) appear.disconnect();
    });
    appear.observe(document.body, { childList: true, subtree: true });
    return () => {
      appear.disconnect();
      resize?.disconnect();
    };
  }, [owed]);

  return owed ? height : 0;
}
