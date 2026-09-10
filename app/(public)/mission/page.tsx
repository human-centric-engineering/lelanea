import type { Metadata } from 'next';

import { AuthoredBlocks, CATEGORY_LABEL } from '@/components/app/content/authored-document';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { requireDocument } from '@/lib/app/content/sections';
import styles from '@/app/(public)/document-page.module.css';

export const metadata: Metadata = {
  title: 'The mission',
  description: 'Why this exists, who it is for, and what it is trying to change.',
  alternates: { canonical: '/mission' },
};

/**
 * `/mission` — the mission statement, as she wrote it.
 *
 * ## The words are the document's; the page supplies only the frame
 *
 * The prototype writes its own headline here — "The journey inward should never
 * be reserved for the privileged." — and splits the copy into a hero, a quote
 * band and a "the vision" section with sub-headings of its own. Every one of
 * those sentences is a re-cut of `the_mission`: the headline is the authored
 * opening with "Coach Lelañea Fulton believes that" trimmed off the front.
 *
 * The owner ruled (t-6) that the authored documents win outright where the two
 * differ. So the prototype contributes the layout, the eyebrow and the rules;
 * it contributes no prose. Not one sentence on this page is typed into this
 * file, and `tests/unit/app/public/authored-provenance.test.ts` is what keeps
 * that true — it reads every file under `app/(public)/` and
 * `components/app/site/` as text and fails if a six-word run of any authored
 * paragraph turns up in one.
 *
 * That costs the prototype's punchier `h1`, and the trade is deliberate: a
 * headline retyped from her prose is a second copy of her words that no longer
 * tracks the source, which is the whole failure `.context/app/content.md`
 * exists to prevent. The document's own title carries the page instead.
 *
 * ## One column, because the document is one argument
 *
 * `the_mission` runs fourteen paragraphs from "the journey inward should never
 * be reserved for the privileged" to what she hopes it does if it reaches
 * millions. The prototype's two-column split cuts that argument in half and
 * asks the reader to restart at the top of the second column. Rendered whole it
 * reads in the order it was written, which for a mission statement is the point.
 *
 * @see .context/app/content.md — the pipeline, and why nothing here is retyped
 * @see .context/app/planning/design/lelanea.html — `#pg-mission`
 */
export default function MissionPage() {
  const mission = requireDocument('the_mission');

  return (
    <div className={styles.page}>
      <section className={styles.opening}>
        {/* The category, not the prototype's "the mission" — the document is
            titled "The Mission", so the prototype's eyebrow would print the
            same three words directly above it in a smaller face. */}
        <Eyebrow as="p">{CATEGORY_LABEL[mission.category]}</Eyebrow>
        <h1 className="brand-display mt-[18px] mb-8 max-w-[20ch] text-[clamp(34px,3.9vw,48px)]">
          {mission.title}
        </h1>

        <AuthoredBlocks
          blocks={mission.blocks}
          renderStyle={mission.renderStyle}
          className={`${styles.measure} ${styles.lede}`}
        />
      </section>
    </div>
  );
}
