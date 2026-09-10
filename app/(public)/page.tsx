import { Fragment } from 'react';
import type { Metadata } from 'next';

import { InlineText } from '@/components/app/content/authored-document';
import { Card } from '@/components/app/ui/card';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { LotusMark } from '@/components/app/ui/lotus-mark';
import { WaitlistForm } from '@/components/app/site/waitlist-form';
import { getJourneyStructure } from '@/lib/app/content';
import { paragraphAt, paragraphRange, requireDocument } from '@/lib/app/content/sections';
import styles from '@/app/(public)/home.module.css';

export const metadata: Metadata = {
  // The group layout's template appends " - Lelañea", which would read
  // "Lelañea - Lelañea" on the one page whose title is the name. `absolute`
  // opts this page out of the template rather than the whole group.
  title: { absolute: 'Lelañea — an invitation into conscious living' },
  description:
    'Transcendental coaching, at your own pace. Lelañea supports you in remembering who you ' +
    'are beneath conditioning, inherited beliefs, and the identities accumulated through life.',
  alternates: { canonical: '/' },
};

/**
 * §6.4's three "what this is" cards.
 *
 * ## The titles are the prototype's; the bodies are hers
 *
 * t-5 shipped all three bodies as string literals here, and every one of them
 * turned out to be a re-cut of an authored passage — the first two from
 * `the_initiation`, the third from the disclaimer's "Our Commitment". The
 * provenance test added with t-6 is what surfaced that; nothing else in the
 * tree could have.
 *
 * They are now the passages themselves, which is the owner's t-6 ruling and is
 * also simply better copy. Two things the prototype's version had lost come
 * back: the "magnificent intelligence" that its paraphrase trimmed to
 * "intelligence", and the cadence — `the_initiation` carries
 * `renderStyle: 'cadence'` and a note saying "render each as its own line or
 * beat; do not merge them into flowing prose", and merging them into flowing
 * prose is exactly what the three literals did.
 *
 * The card TITLES stay literals. They are the prototype's own labels, they
 * appear in no document, and a label is not prose.
 *
 * ## Ranges, and why the indices are safe to write down
 *
 * `the_initiation` has no headings, so `paragraphRange` is the only handle. The
 * ranges are pinned by their first and last beat in
 * `tests/unit/lib/app/content/sections.test.ts`, so a beat inserted upstream of
 * one fails the suite instead of shifting a card to start mid-sentence.
 */
const WHAT_THIS_IS = [
  { title: 'An invitation', source: 'the_initiation', from: 7, to: 10 },
  { title: 'A guide who walks beside you', source: 'the_initiation', from: 51, to: 60 },
  // 72–73, not 65–66: `paragraphRange` counts PARAGRAPHS, and the disclaimer
  // has two list blocks whose items flatten into the sequence. Block index and
  // paragraph index agree in `the_initiation`, which has neither headings nor
  // lists, and diverge by seven here.
  { title: 'Coaching, not healthcare', source: 'disclaimer', from: 72, to: 74 },
] as const;

/**
 * The home page.
 *
 * ## The journey tiers are read, never written here
 *
 * The tier names and the modules inside them come from
 * `getJourneyStructure()` — the same authored content `GET
 * /api/v1/app/content/journey-structure` serves, which is literally what that
 * route calls. The task names the endpoint; a server component fetching its own
 * HTTP route would need an absolute URL, cost a second round trip, and buy
 * nothing, so this reads the source the endpoint reads. What the task was
 * guarding against — the seventeen modules retyped into a page and drifting the
 * first time one is renamed — is guarded either way.
 *
 * The onboarding tier is skipped, as the prototype skips it: it is how you get
 * in, not part of the path being described. It is excluded by id rather than by
 * ordinal — see the filter.
 */
export default function HomePage() {
  const { tiers, modules } = getJourneyStructure();

  // The hero and the quote band are the two ends of `the_heart_behind_lelanea`,
  // read rather than retyped. t-5 shipped all four of these sentences as string
  // literals in this file; t-6 made "the authored documents win outright" the
  // rule for the whole public site, and a rule the front page breaks is not a
  // rule. `authored-provenance.test.ts` is what holds it.
  const philosophy = requireDocument('the_heart_behind_lelanea');
  const openingLine = paragraphAt(philosophy, 0);
  const openingPurpose = paragraphAt(philosophy, 1);
  // Two paragraphs, not one sentence: she authored the closing thought as two
  // beats and the band sets them as one line, so they are joined with a space
  // here rather than merged in the source.
  const closingBeats = [paragraphAt(philosophy, -2), paragraphAt(philosophy, -1)];

  const moduleTitle = new Map(modules.map((m) => [m.id, m.title]));
  // By IDENTITY, not by ordinal. `order > 0` was the first shape and it leans
  // on onboarding being exactly 0, which the schema does not promise — it only
  // requires nonnegative. Renumbering the tiers 1–5 would publish onboarding on
  // the marketing page, and a future tier authored at 0 would vanish from it.
  const pathTiers = tiers
    .filter((tier) => tier.id !== 'onboarding')
    .toSorted((a, b) => a.order - b.order);

  return (
    <div className="mx-auto max-w-[1180px] px-[clamp(20px,5vw,72px)]">
      <section className={styles.hero}>
        <div>
          <Eyebrow as="p">transcendental coaching, at your own pace</Eyebrow>
          <h1 className="brand-display">
            <InlineText text={openingLine} />
          </h1>
          <p className={styles.lede}>
            <InlineText text={openingPurpose} />
          </p>

          <WaitlistForm />
        </div>

        <div className={styles.bloom}>
          {/* Decorative: the page's name is its `h1` a column away, so
              announcing the flower would only repeat it. */}
          <div className={styles.bloomArt}>
            <LotusMark size={300} water />
          </div>
        </div>
      </section>

      <section className={styles.band} style={{ marginTop: 'clamp(56px,7vw,88px)' }}>
        <p className="brand-quote">
          {closingBeats.map((beat, index) => (
            <Fragment key={index}>
              {index === 0 ? null : ' '}
              <InlineText text={beat} />
            </Fragment>
          ))}
        </p>
        <Eyebrow as="p" className="mt-5">
          lelañea fulton
        </Eyebrow>
      </section>

      <section className={styles.section}>
        {/* An `h2`, not a `p`. `Card` renders its title as a `<div>` — a card
            title is not necessarily a document heading — so with this as a
            paragraph the whole section was absent from the outline and the
            page read h1 → (nothing) → h2, skipping all three cards for anyone
            navigating by heading. The type is identical either way. */}
        <Eyebrow as="h2">what this is</Eyebrow>
        <div className={styles.cards}>
          {WHAT_THIS_IS.map((card) => (
            <Card key={card.title} title={card.title}>
              {paragraphRange(requireDocument(card.source), card.from, card.to).map(
                (beat, index) => (
                  // One `<p>` per beat, which IS the cadence note honoured —
                  // "render each as its own line or beat". `mb-2` on all but
                  // the last keeps them reading as beats of one thought rather
                  // than as separate paragraphs.
                  <p key={index} className="mb-2 last:mb-0">
                    <InlineText text={beat} />
                  </p>
                )
              )}
            </Card>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.rule}`}>
        <Eyebrow as="p">the journey</Eyebrow>
        <h2 className="brand-display my-[14px] mb-[26px] max-w-[20ch] text-[clamp(32px,3.4vw,40px)]">
          A guided path from inner foundations to expanded consciousness
        </h2>

        {/* A description list, not a stack of divs: each row is a term (the
            tier) and its definition (the modules in it), which is what the
            markup should say. */}
        <dl>
          {pathTiers.map((tier) => (
            <div key={tier.id} className={styles.tierRow}>
              <dt className="brand-eyebrow">{tier.label}</dt>
              <dd>
                {tier.modules
                  .map((id) => moduleTitle.get(id))
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
          ))}
        </dl>
        <div className={styles.rule} />
      </section>
    </div>
  );
}
