import type * as React from 'react';

export interface LotusMarkProps {
  /** Rendered width of the bloom itself in px — comparable across both `water` modes. */
  size?: number;
  /**
   * Draw the sage water ripples beneath the bloom (frame 320:220).
   * Set `false` for marks under ~40px — the frame crops tight to the petals
   * so the bloom stays legible at avatar scale.
   */
  water?: boolean;
  style?: React.CSSProperties;
}

/** Static lotus glyph for avatars, favicons and inline marks. */
export function LotusMark(props: LotusMarkProps): JSX.Element;
