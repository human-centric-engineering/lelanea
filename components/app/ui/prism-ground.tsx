import type { CSSProperties } from 'react';

import styles from '@/components/app/ui/prism-ground.module.css';

/**
 * The light a consumer page sits in: the prism ground.
 *
 * A fixed, full-viewport layer behind the page — a wash of three glows, two
 * folds where the light bends, five slow rays, the veil (a calm band where words
 * run) and two sparks. Every colour is a token from `app/brand-theme.css`; this
 * file holds only the geometry, which is the prism prototype's
 * (`.context/app/planning/design/prism/`).
 *
 * ## Where it is mounted, and why there
 *
 * Once per consumer frame, at the top of it: `app/(public)/layout.tsx` and
 * `app/(gate)/app/begin/page.tsx` as `site`, the shell's
 * `app/(lelanea)/app/layout.tsx` as `app`. Never under `/admin`, which keeps
 * Sunrise's flat palette. A frame mounts it rather than the root layout because
 * the two variants differ, and because each frame is also where the page's own
 * ground stops being opaque so the light can show.
 *
 * ## Decoration only
 *
 * `aria-hidden` and `pointer-events: none`: it carries nothing a reader needs,
 * and nothing may land on it. The rays drift and the sparks glint; under
 * `prefers-reduced-motion` both hold still, and the light stays.
 */
export type PrismVariant = 'site' | 'app';

/** Custom properties the module reads per layer. */
type LayerStyle = CSSProperties & Record<`--${string}`, string>;

const FOLDS: readonly LayerStyle[] = [
  { '--r': '-20deg', '--y': '-6vh' },
  { '--r': '24deg', '--y': '30vh' },
];

/** Angle, offset, thickness, blur and drift period of each ray. */
const RAYS: readonly LayerStyle[] = [
  { '--r': '-24deg', '--y': '-18vh', '--h': '150px', '--b': '10px', '--t': '52s' },
  { '--r': '-31deg', '--y': '6vh', '--h': '70px', '--b': '4px', '--t': '40s' },
  { '--r': '16deg', '--y': '-30vh', '--h': '110px', '--b': '8px', '--t': '60s' },
  { '--r': '-12deg', '--y': '26vh', '--h': '46px', '--b': '3px', '--t': '44s' },
  { '--r': '34deg', '--y': '22vh', '--h': '130px', '--b': '12px', '--t': '56s' },
];

const SPARKS: readonly LayerStyle[] = [
  { '--x': '94%', '--y': '14%', '--delay': '0s' },
  { '--x': '5%', '--y': '70%', '--delay': '3s' },
];

export function PrismGround({ variant }: { variant: PrismVariant }) {
  return (
    <div aria-hidden="true" data-prism={variant} className={styles.ground}>
      <span className={styles.wash} />
      {FOLDS.map((style, index) => (
        <span key={`fold-${index}`} className={styles.fold} style={style} />
      ))}
      {RAYS.map((style, index) => (
        <span key={`ray-${index}`} className={styles.ray} style={style} />
      ))}
      <span className={styles.veil} />
      {SPARKS.map((style, index) => (
        <span key={`spark-${index}`} className={styles.spark} style={style} />
      ))}
    </div>
  );
}
