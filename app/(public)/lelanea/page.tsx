import type { Metadata } from 'next';
import Image from 'next/image';

import { AuthoredBlocks, CATEGORY_LABEL } from '@/components/app/content/authored-document';
import { CreatorLinks } from '@/components/app/site/channels';
import { Ripples } from '@/components/app/site/ripples';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { LotusMark } from '@/components/app/ui/lotus-mark';
import type { FoundationalDocumentDetail } from '@/lib/app/content/document-view';
import { requireDocument } from '@/lib/app/content/sections';
import { CREATOR_PORTRAIT, LIGHT_THROUGH_WATER } from '@/lib/site/config';
import styles from '@/app/(public)/document-page.module.css';

export const metadata: Metadata = {
  // `absolute` opts out of the group template `%s - Lelañea`, which would
  // otherwise render this page's tab and search result as "Lelañea - Lelañea".
  title: { absolute: 'Lelañea' },
  description: 'Her philosophy, the lineage she draws on, and the person behind the work.',
  alternates: { canonical: '/lelanea' },
};

/** Read at request time: her words are in the database (t-86). See the home page. */
export const dynamic = 'force-dynamic';

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
type Blocks = FoundationalDocumentDetail['blocks'];
type Block = Blocks[number];

/**
 * A document's blocks, cut at its headings (t-171): whatever precedes the first
 * heading, then one group per heading with the blocks beneath it. The lineage
 * is a run of short headed sections — each a field and the people in it — and
 * reads as a set of tiles, not as one long column.
 */
function byHeading(blocks: Blocks): { intro: Block[]; groups: Block[][] } {
  const intro: Block[] = [];
  const groups: Block[][] = [];
  for (const block of blocks) {
    if (block.type === 'heading') groups.push([block]);
    else (groups.at(-1) ?? intro).push(block);
  }
  return { intro, groups };
}

export default async function LelaneaPage() {
  const [philosophy, creator, lineage] = await Promise.all([
    requireDocument('the_heart_behind_lelanea'),
    requireDocument('about_the_creator'),
    requireDocument('the_lineage_of_lelanea'),
  ]);

  // The lineage's LAST section is its coda — "An Evolving Body of Work", which
  // closes on her "May it…" blessing — and it is set apart as the page's
  // ending rather than tiled with the fields she draws on. Taken by position,
  // not by title, so a retitled coda stays the coda.
  const { intro: lineageIntro, groups } = byHeading(lineage.blocks);
  const coda = groups.length > 1 ? groups.at(-1) : undefined;
  const fields = coda === undefined ? groups : groups.slice(0, -1);

  return (
    <div className={styles.page}>
      <section className={`${styles.opening} ${styles.withGuide}`}>
        <div>
          {/* The category, not the prototype's "the heart behind lelañea": the
            document is titled "The Heart Behind Lelañea", so the prototype's
            eyebrow would print the page's own `h1` above it in a smaller face.
            The inner sections take no eyebrow at all for the same reason —
            all three documents share this category, so a repeated "about
            lelañea" would label nothing. */}
          <Eyebrow as="p">{CATEGORY_LABEL[philosophy.category]}</Eyebrow>
          <h1
            id="heart"
            className="brand-display mt-[18px] max-w-[20ch] scroll-mt-[104px] text-[clamp(38px,4.4vw,60px)]"
          >
            {philosophy.title}
          </h1>
          {philosophy.subtitle === null ? null : (
            <p className="text-muted-foreground mt-4 text-lg">{philosophy.subtitle}</p>
          )}

          <AuthoredBlocks
            blocks={philosophy.blocks}
            renderStyle={philosophy.renderStyle}
            beats
            className={`${styles.prose} mt-10`}
          />
        </div>

        {/* A guide to a long page (t-171), in the empty half beside the
            opening: the three documents by their own titles, held in view on
            a desktop and absent below it, where the page is one column. */}
        <nav className={styles.guide} aria-label="On this page">
          <LotusMark size={44} water={false} />
          <p className="brand-eyebrow text-muted-foreground">on this page</p>
          <ol>
            <li>
              <a href="#heart">{philosophy.title}</a>
            </li>
            <li>
              <a href="#creator">{creator.title}</a>
            </li>
            <li>
              <a href="#lineage">{lineage.title}</a>
            </li>
          </ol>
        </nav>
      </section>

      <section className={`${styles.section} ${styles.rule}`}>
        <div className={styles.creator}>
          {/* Her portrait, her name and where to find her, held beside the
              biography on a desktop and gathered into one row above it once
              the page narrows (t-171). An arch rather than a full-height
              panel: it was the largest thing on the page and broke the read. */}
          <aside className={styles.creatorAside}>
            <figure
              className={CREATOR_PORTRAIT === null ? styles.portraitPending : styles.portrait}
            >
              {CREATOR_PORTRAIT === null ? (
                <>
                  {/* Decorative: the caption says what this is, and the mark
                      is the brand's, not a depiction of her. */}
                  <Image src={LIGHT_THROUGH_WATER} alt="" fill sizes="300px" />
                  <LotusMark size={72} water={false} />
                  <figcaption className="sr-only">
                    A portrait of Lelañea Fulton will appear here.
                  </figcaption>
                </>
              ) : (
                <Image
                  src={CREATOR_PORTRAIT}
                  alt="Lelañea Fulton"
                  fill
                  sizes="(max-width: 620px) 120px, (max-width: 1100px) 180px, 300px"
                />
              )}
            </figure>
            <div className={styles.creatorMeta}>
              <p className="brand-display text-[26px] text-[var(--color-heading)]">
                Lelañea Fulton
              </p>
              <CreatorLinks />
            </div>
          </aside>

          <div>
            <h2
              id="creator"
              className="brand-display mb-7 scroll-mt-[104px] text-[clamp(32px,3.6vw,44px)]"
            >
              {creator.title}
            </h2>

            <AuthoredBlocks
              blocks={creator.blocks}
              renderStyle={creator.renderStyle}
              baseLevel={3}
              beats
              className={`${styles.prose} ${styles.lede}`}
            />
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.rule}`}>
        <h2
          id="lineage"
          className="brand-display mb-7 scroll-mt-[104px] text-[clamp(32px,3.6vw,44px)]"
        >
          {lineage.title}
        </h2>

        <AuthoredBlocks
          blocks={lineageIntro}
          renderStyle={lineage.renderStyle}
          beats
          className={`${styles.prose} ${styles.lede}`}
        />

        <div className={styles.lineage}>
          {fields.map((group, index) => (
            <AuthoredBlocks
              key={index}
              blocks={group}
              renderStyle={lineage.renderStyle}
              baseLevel={3}
              className={styles.lineageTile}
            />
          ))}
        </div>

        {coda === undefined ? null : (
          <div className={styles.coda}>
            <AuthoredBlocks
              blocks={coda}
              renderStyle={lineage.renderStyle}
              baseLevel={3}
              beats
              className={styles.prose}
            />
            <Ripples className={styles.codaRipples} rings={4} />
          </div>
        )}
      </section>
    </div>
  );
}
