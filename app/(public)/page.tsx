import type { Metadata } from 'next';

import { Card } from '@/components/app/ui/card';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { LotusMark } from '@/components/app/ui/lotus-mark';
import { WaitlistForm } from '@/components/app/site/waitlist-form';
import { getJourneyStructure } from '@/lib/app/content';
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

/** §6.4's three "what this is" cards, in the prototype's order and words. */
const WHAT_THIS_IS = [
  {
    title: 'An invitation',
    body:
      'This is not simply an app. It is an invitation to explore the relationship you have with ' +
      'yourself, your consciousness, and the intelligence that has always existed beneath the ' +
      'noise of the human experience.',
  },
  {
    title: 'A guide who walks beside you',
    body:
      'Her role is not to tell you who you are. It is to walk beside you as you begin to ' +
      'remember. She offers perspectives, practices, questions, ancient wisdom, and modern ' +
      'understanding. There is nothing you are required to believe.',
  },
  {
    title: 'Coaching, not healthcare',
    body:
      'Lelañea was created with deep respect for both contemplative wisdom and modern ' +
      'healthcare. It is intended to complement — never to replace — the work of licensed ' +
      'professionals.',
  },
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
            Lelañea was created as an invitation into conscious living.
          </h1>
          <p className={styles.lede}>
            Its purpose is not simply to help individuals improve themselves, but to support them in
            remembering who they are beneath conditioning, inherited beliefs, unconscious patterns,
            and the countless identities accumulated throughout life.
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
          Transformation is not viewed as becoming someone new. It is the continual remembrance of
          who we have always been.
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
              {card.body}
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
