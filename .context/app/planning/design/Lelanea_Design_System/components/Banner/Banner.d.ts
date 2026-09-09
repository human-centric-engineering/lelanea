import type * as React from 'react';

export interface BannerProps {
  tone?: 'success' | 'error' | 'warning' | 'info';
  /** Short lead phrase set in medium weight, e.g. "Saved." */
  lead?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** System state banner. Quiet by design — a dot, a lead phrase, then the detail. */
export function Banner(props: BannerProps): JSX.Element;
