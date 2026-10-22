import styles from '@/components/app/site/data-promises.module.css';

export type PromiseGlyph = 'see' | 'delete' | 'export';

/**
 * `/data`'s three promises as panels that stack as the reader scrolls (t-171).
 *
 * Each panel pins near the top of the screen and pauses there while the next
 * slides up over it, so the three are read one at a time and end as a neat
 * stack — a deliberate pace for the page's most important claims, done with
 * `position: sticky` alone. No script, nothing to switch off: with reduced
 * motion the panels still stack, because stacking is position, not animation.
 *
 * The crisis passage further down the page is deliberately NOT given any of
 * this. Safety text is never hidden, faded or moved by scrolling.
 */
export function DataPromises({
  items,
}: {
  items: ReadonlyArray<{ title: string; body: string; glyph: PromiseGlyph }>;
}) {
  return (
    <ol className={styles.promises}>
      {items.map((item, index) => (
        <li key={item.title} className={styles.promise}>
          <span className={styles.number} aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className={styles.text}>
            <h2 className="brand-display text-[clamp(30px,3.4vw,46px)] text-[var(--color-heading)]">
              {item.title}
            </h2>
            <p>{item.body}</p>
          </div>
          <Glyph glyph={item.glyph} />
        </li>
      ))}
    </ol>
  );
}

/** A large, quiet line drawing for each promise. Decorative. */
function Glyph({ glyph }: { glyph: PromiseGlyph }) {
  return (
    <svg
      className={styles.glyph}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[glyph]}
    </svg>
  );
}

const GLYPHS: Record<PromiseGlyph, React.ReactNode> = {
  // An open eye: everything held is in view.
  see: (
    <>
      <path d="M12 60c13-21 30-32 48-32s35 11 48 32c-13 21-30 32-48 32S25 81 12 60Z" />
      <circle cx="60" cy="60" r="17" />
      <circle cx="60" cy="60" r="6" />
      <path d="M60 14v6M60 100v6M28 24l4 5M92 24l-4 5" />
    </>
  ),
  // Rings on water, the outermost already fading: a part let go.
  delete: (
    <>
      <ellipse cx="60" cy="64" rx="12" ry="5" />
      <ellipse cx="60" cy="64" rx="28" ry="11" />
      <ellipse cx="60" cy="64" rx="46" ry="18" strokeDasharray="3 7" />
      <path d="M60 18v26M52 36l8 8 8-8" />
    </>
  ),
  // A page settling into open hands: your copy, kept.
  export: (
    <>
      <path d="M42 16h28l14 14v38H42Z" />
      <path d="M70 16v14h14M50 40h24M50 50h24M50 60h14" />
      <path d="M18 76c8 0 14 4 20 10h16c4 0 6 6 0 6H40M102 76c-8 0-14 4-20 10H66c-4 0-6 6 0 6h14" />
      <path d="M18 76v26M102 76v26" />
    </>
  ),
};
