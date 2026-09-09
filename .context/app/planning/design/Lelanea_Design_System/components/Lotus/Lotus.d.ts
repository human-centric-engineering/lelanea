export interface LotusProps {
  /** Rendered width of the bloom itself in px — matches `LotusMark`'s `size`. */
  size?: number;
  /** Drive the open state externally. Omit to let the component manage it. */
  open?: boolean;
  /** Open automatically on mount (ignored when `open` is supplied). */
  autoOpen?: boolean;
  /** Ambient 4s breath once opened. */
  idle?: boolean;
  /** Draw the sage water ripples beneath the bloom; they expand as it opens. */
  water?: boolean;
  /** Delay in ms before the bloom starts opening. */
  delay?: number;
  /** Fires once the opening animation has finished. */
  onOpened?: () => void;
}

/** The Lelanea lotus: three tiers of broad pointed petals that fan open on launch. */
export function Lotus(props: LotusProps): JSX.Element;
