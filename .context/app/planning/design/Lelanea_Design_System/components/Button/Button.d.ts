import type * as React from 'react';

export interface ButtonProps {
  children?: React.ReactNode;
  /** Visual weight. `primary` is the burnt-orange CTA — one per screen. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to the container width. */
  block?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** Pill button in the Lelanea palette. Press scales to 0.98; hover deepens, never brightens. */
export function Button(props: ButtonProps): JSX.Element;
