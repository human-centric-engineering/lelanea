import type { Metadata } from 'next';
import Image from 'next/image';

import { AuthoredBlocks, CATEGORY_LABEL } from '@/components/app/content/authored-document';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { requireDocument } from '@/lib/app/content/sections';
import { CREATOR_PORTRAIT } from '@/lib/site/config';
import styles from '@/app/(public)/document-page.module.css';

export const metadata: Metadata = {
  // `absolute` opts out of the group template `%s - Lelañea`, which would
  // otherwise render this page's tab and search result as "Lelañea - Lelañea".
  title: { absolute: 'Lelañea' },
  description: 'Her philosophy, the lineage she draws on, and the person behind the work.',
  alternates: { canonical: '/lelanea' },
};

/**
 * `/lelanea` — the philosophy, the creator, and the lineage.
 *
 * Three authored documents on one page, in the order the prototype puts them:
 * `the_heart_behind_lelanea`, `about_the_creator`, `the_lineage_of_lelanea`.
 * Each is a section with its own `h2` taken from the document's own title, so
 * the page has one `h1` and an outline that nests — `AuthoredBlocks` is passed
 * `baseLevel={3}` for the two lower sections so their internal headings become
 * `h3`s beneath it rather than a second flat run of `h2`s.
 *
 * ## The prototype's lineage chips could not ship, and this is the finding
 *
 * The design ends this page with a row of twenty name chips — Jung, Porges,
 * Levine, Maté, Hawkins, and so on — and the task asks for them. Reconciling
 * against the authored file, two things came out:
 *
 * - **Four of the twenty are attested nowhere in `the_lineage_of_lelanea`**:
 *   Gabor Maté, David R. Hawkins, Amit Goswami and Byron Katie. The prototype's
 *   intro paragraph names "Maté on attachment" too. Those are the prototype's
 *   attributions, not hers, and this is the one page in the site whose subject
 *   is intellectual integrity about exactly that.
 * - **The sixteen that are attested exist only inside sentences.** "Carl Jung's
 *   work on individuation, symbolism, archetypes, projection, dreams, and
 *   shadow integration has profoundly influenced…" yields a chip only by
 *   someone retyping the name into this file — a second copy of an attribution
 *   that stops tracking the source the moment it is pasted.
 *
 * So the document is rendered whole instead. Its nine discipline headings —
 * Depth Psychology, Parts Work, Trauma, Somatics and Nervous System
 * Regulation, and the rest — do the glanceable work the chip row was doing, and
 * do it as real headings a screen reader can navigate. The named people arrive
 * with the sentences that say what each contributed, which is what
 * acknowledging a lineage means and what a bare chip cannot carry.
 *
 * ## The portrait renders when there is one
 *
 * There is no photograph in the tree. `CREATOR_PORTRAIT` is `null` and the
 * figure falls back to a tinted panel that says a portrait is coming, the same
 * shape `SITE_LINKS` uses for a URL that does not exist yet (D3): nothing
 * rather than a broken image, and filling the constant is the whole change.
 * The creator's video slot is a todo for Lelañea and is not stubbed here at
 * all — there is no design for it yet, and B31's "deliberate stub" needs
 * something to be a stub OF.
 *
 * @see .context/app/content.md — the pipeline, and why nothing here is retyped
 * @see .context/app/planning/design/lelanea.html — `#pg-lelanea`
 */
export default function LelaneaPage() {
  const philosophy = requireDocument('the_heart_behind_lelanea');
  const creator = requireDocument('about_the_creator');
  const lineage = requireDocument('the_lineage_of_lelanea');

  return (
    <div className={styles.page}>
      <section className={styles.opening}>
        {/* The category, not the prototype's "the heart behind lelañea": the
            document is titled "The Heart Behind Lelañea", so the prototype's
            eyebrow would print the page's own `h1` above it in a smaller face.
            The inner sections take no eyebrow at all for the same reason —
            all three documents share this category, so a repeated "about
            lelañea" would label nothing. */}
        <Eyebrow as="p">{CATEGORY_LABEL[philosophy.category]}</Eyebrow>
        <h1 className="brand-display mt-[18px] max-w-[20ch] text-[clamp(38px,4.4vw,60px)]">
          {philosophy.title}
        </h1>
        {philosophy.subtitle === null ? null : (
          <p className="text-muted-foreground mt-4 text-lg">{philosophy.subtitle}</p>
        )}

        <AuthoredBlocks
          blocks={philosophy.blocks}
          renderStyle={philosophy.renderStyle}
          className={`${styles.measure} ${styles.lede} mt-8`}
        />
      </section>

      <section className={`${styles.section} ${styles.rule}`}>
        <div className={styles.split}>
          <figure className={CREATOR_PORTRAIT === null ? styles.portraitPending : styles.portrait}>
            {CREATOR_PORTRAIT === null ? (
              <figcaption className="text-sm">
                A portrait of Lelañea Fulton will appear here.
              </figcaption>
            ) : (
              <Image
                src={CREATOR_PORTRAIT}
                alt="Lelañea Fulton"
                width={720}
                height={900}
                sizes="(max-width: 1180px) 100vw, 50vw"
              />
            )}
          </figure>

          <div>
            <h2 className="brand-display mb-5 text-[clamp(32px,3.6vw,44px)]">{creator.title}</h2>

            <AuthoredBlocks
              blocks={creator.blocks}
              renderStyle={creator.renderStyle}
              baseLevel={3}
              className={`${styles.measure} ${styles.lede}`}
            />
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.rule}`}>
        <h2 className="brand-display mb-6 text-[clamp(28px,3vw,36px)]">{lineage.title}</h2>

        <AuthoredBlocks
          blocks={lineage.blocks}
          renderStyle={lineage.renderStyle}
          baseLevel={3}
          className={styles.measure}
        />
      </section>
    </div>
  );
}
