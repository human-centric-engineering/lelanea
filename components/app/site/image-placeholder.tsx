import { cn } from '@/lib/utils';
import styles from '@/components/app/site/atmosphere.module.css';

/**
 * A reserved place for a photograph that does not exist yet (t-171).
 *
 * The owner asked for spaces where pictures would help, each with a title
 * saying what belongs there. The ground is a soft, out-of-focus wash in the
 * lotus colours, after the blurred, refracted photography on her own site, so
 * the page already reads with the image's weight before the image arrives.
 *
 * The title is visible on purpose: B31's "deliberate stub" says what it is, and
 * a blank coloured panel would read as finished. Swap the component for a
 * `next/image` with the same aspect ratio when the photograph lands.
 */
export function ImagePlaceholder({
  title,
  ratio,
  className,
}: {
  /** What the photograph should be, e.g. "Light through water". */
  title: string;
  /** A CSS aspect ratio, e.g. "21 / 9". Omit to let the caller's CSS set it. */
  ratio?: string;
  className?: string;
}) {
  return (
    <figure
      className={cn(styles.placeholder, className)}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      <figcaption className={styles.placeholderCaption}>
        <span className="brand-eyebrow">image</span>
        <span>{title}</span>
      </figcaption>
    </figure>
  );
}
