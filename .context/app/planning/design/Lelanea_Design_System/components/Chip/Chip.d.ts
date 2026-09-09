import type * as React from 'react';

export interface ChipProps {
  children?: React.ReactNode;
  /** Selected state — renders in heather amethyst. */
  selected?: boolean;
  /** `teal` marks an active teaching. Ignored when `selected`. */
  tone?: 'default' | 'teal';
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** Tag pill for themes and filters. */
export function Chip(props: ChipProps): JSX.Element;
