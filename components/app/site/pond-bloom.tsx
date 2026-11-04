'use client';

import { DotLotus } from '@/components/app/ui/dot-lotus';

/**
 * The lotus that closes the home page (t-171), drawn in points of light on its
 * own pond (t-182): nothing until the reader arrives, then it unfolds — and
 * again each time they return to it.
 *
 * The hero's bloom opens on load, at the top of the page; this one would open
 * unseen a long scroll away, so it waits to be seen (`startInView`). The pond's
 * rings are the flower's own now, sent out by each heartbeat. `DotLotus`
 * handles reduced motion itself: the open flower, still.
 */
export function PondBloom({ size = 360 }: { size?: number }) {
  return <DotLotus size={size} startInView />;
}
