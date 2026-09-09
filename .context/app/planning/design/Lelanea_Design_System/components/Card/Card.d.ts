import type * as React from 'react';

export interface CardProps {
  /** Small lowercase tracked-out label above the title. */
  eyebrow?: React.ReactNode;
  /** Serif headline. */
  title?: React.ReactNode;
  /** Body copy. */
  children?: React.ReactNode;
  /** Muted footer line, e.g. "4 min · saved". */
  meta?: React.ReactNode;
  /** Use the dark-mode surface. */
  dark?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** Elevated surface card. Optional lowercase eyebrow, serif title, body copy and meta line. */
export function Card(props: CardProps): JSX.Element;
