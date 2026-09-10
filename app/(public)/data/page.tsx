import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthoredBlocks, InlineText } from '@/components/app/content/authored-document';
import { Card } from '@/components/app/ui/card';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import {
  requireDocument,
  selectSection,
  selectSectionHeading,
  selectSectionText,
} from '@/lib/app/content/sections';
import { CRISIS_ANCHOR } from '@/lib/site/config';
import styles from '@/app/(public)/document-page.module.css';

export const metadata: Metadata = {
  title: 'Your data',
  description:
    'An honest account of what Lelañea is, what it is not, and how your words are handled.',
  alternates: { canonical: '/data' },
};

/**
 * The three data-rights cards.
 *
 * These are the PROTOTYPE's copy, not Lelañea Fulton's — no authored document
 * describes what the app holds or what you can do with it — so unlike every
 * other string on this page they are a `const` here, exactly as the home page's
 * "what this is" cards are. The prototype's fourth card became the GDPR
 * footing below them — see `GDPR_RIGHTS`.
 *
 * ## The deletion card promises something that does not exist yet
 *
 * "A single message, a session, a module's worth" is per-message erasure, which
 * is f-memory in phase 3. Today the platform can export a subject's whole
 * record (`GET /api/v1/users/me/export`) and erase an account (`eraseUser()`),
 * and nothing finer.
 *
 * This was raised at build and the owner ruled (t-6) that the prototype's claims
 * ship as written: it is a forward-looking marketing page and the capability is
 * planned and owned. The cost accepted is the one `B31` names — a promise that
 * reads as done, whose gap surfaces later as a defect in something else — so it
 * is recorded as a decision on f-public rather than left in a comment, and
 * f-memory is where it comes due.
 */
const DATA_RIGHTS = [
  {
    title: 'See what is held',
    body:
      'Your chat history, the profile built from it, and which messages each conclusion came ' +
      'from, with the date and a confidence level.',
  },
  {
    title: 'Delete any part of it',
    body:
      "A single message, a session, a module's worth, or your whole account. Deleting a message " +
      'also removes anything derived from it.',
  },
  {
    title: 'Export a full copy',
    body:
      'A readable file containing everything held about you, available whether or not you have ' +
      'an active subscription.',
  },
] as const;

/**
 * The five GDPR rights, as a footing to the three cards rather than a fourth.
 *
 * The prototype makes this a fourth card and it does not work, for two reasons
 * that turned out to be the same reason.
 *
 * Visually, four cards do not fit: at the page's 1180px the grid takes three
 * across and the fourth drops to a row of its own, sitting alone at a third of
 * the width under three that are full. That is a layout that only looks
 * deliberate at exactly two viewport widths.
 *
 * But the fix is not to force four abreast. The first three are things you can
 * DO — see what is held, delete part of it, export it — each with a sentence
 * describing the mechanism. "GDPR rights" is not one of those; it is the legal
 * standing underneath all three, and a list of five nouns. Set as a peer it
 * reads as a fourth feature, which is both a category error and why its card
 * was visibly shorter and emptier than the others.
 *
 * So it sits below them, under a hairline rule, as the footing it is. The claim
 * is the prototype's own — the same five rights, and the same assertion that
 * all of them are supported — re-set as a labelled list rather than as a
 * sentence inside a card.
 */
const GDPR_RIGHTS = [
  'Access',
  'Rectification',
  'Erasure',
  'Portability',
  'Restriction of processing',
] as const;

/**
 * The disclaimer sections this page renders, by their authored headings.
 *
 * Named constants rather than string literals at four call sites, so a renamed
 * heading is one edit and `sections.test.ts` has something to pin. A miss
 * throws — see `lib/app/content/sections.ts` for why an empty "it is not"
 * column is the one failure mode this page must not have.
 */
const PURPOSE = 'The Purpose of Lelañea';
const IS_NOT = 'What Lelañea Is Not';
const CRISIS = 'Crisis Situations';
const COACHING = 'Coaching Is Different from Therapy';

/**
 * The shape of an "it is not" item, as authored: "Lelañea is **not** a …".
 *
 * A pattern rather than a count, because a count silently takes the wrong seven
 * if an eighth is added — and this section's tail is already a paragraph that
 * is not an item. What it must NOT be is a loose "contains not", which would
 * swallow the qualifier below the list ("…are presented for educational
 * purposes and are **not** offered as…").
 */
const IS_NOT_ITEM = /^Lelañea is \*\*not\*\* /;

/**
 * The cross beside each "it is not" line.
 *
 * `aria-hidden`, because it repeats what the sentence says in words — every one
 * of these lines begins "Lelañea is not". A screen reader announcing "cross,
 * Lelañea is not a medical application" says the negation twice, and WCAG 1.4.1
 * is satisfied by the text rather than by the colour either way.
 */
function CrossIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-[var(--color-status-red-ink)]"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * `/data` — what it is, what it is not, and what happens to what you say.
 *
 * ## Why this page is assembled rather than rendered whole
 *
 * `/disclaimer` renders the disclaimer document top to bottom. This page is the
 * designed version of the same disclosures: the reader who needs them most is
 * the one who came looking for therapy and has not decided to read a legal
 * document, so the three that matter — what it is, what it is not, and what to
 * do in a crisis — are lifted into the site's own chrome where they are seen.
 *
 * They are LIFTED, not retyped. `selectSection` takes the blocks under an
 * authored heading and throws if the heading is not there, so this page cannot
 * silently drift from the document it is quoting, and cannot silently render an
 * empty "it is not" column either. That guarantee is the whole reason the
 * mechanism exists rather than a `const` of seven strings beside the layout.
 *
 * ## The prototype's re-cut lists did not survive reconciliation
 *
 * The design ships two hand-written arrays. `ISNOT_LIST`'s seven items match
 * the seven authored "Lelañea is **not** a…" paragraphs one for one and are
 * taken from them directly. `IS_LIST`'s five are a re-cut of a single authored
 * sentence — "designed to support self-awareness, conscious living, values
 * clarification, reflective inquiry, meditation, personal growth, and
 * transcendental coaching…" chopped into five bullets. Under the owner's t-6
 * ruling the authored sentence wins, so the left column is her paragraph rather
 * than the prototype's five fragments of it.
 *
 * The task's own mechanics say these come from "the disclaimer document's
 * lists". They do not: the disclaimer's only two `list` blocks are the
 * "nothing within this application should be interpreted as" list and the
 * crisis triggers. Both columns here are paragraph runs, which is why
 * `selectSectionText` flattens either shape.
 *
 * @see .context/app/content.md — the pipeline, and why nothing here is retyped
 * @see .context/app/planning/design/lelanea.html — `#pg-data`
 */
export default function DataPage() {
  const disclaimer = requireDocument('disclaimer');

  // "The Purpose of Lelañea" closes on a NEGATION — "Lelañea is not intended to
  // provide healthcare, mental healthcare, psychotherapy, or crisis
  // intervention." Rendered whole in the left column, that sentence sat under a
  // green tick and the words "it is designed to support", which is the opposite
  // of what it says.
  //
  // She wrote it as the section's turn towards what follows, so it is rendered
  // where it turns: beneath both columns, leading into the crossed list and the
  // crisis box. The split is positional and `sections.test.ts` pins which
  // sentence is last, so a re-authored section fails there rather than quietly
  // putting a negation back under the tick.
  const purposeSection = selectSection(disclaimer, PURPOSE);
  const purpose = purposeSection.slice(0, -1);
  const purposeTurn = purposeSection.slice(-1);

  const crisis = selectSection(disclaimer, CRISIS, { includeHeading: true });
  const coaching = selectSection(disclaimer, COACHING);
  // Read back from the document rather than rendering `COACHING`. The constant
  // is the selector; displaying it would be the second copy this module exists
  // to prevent, which this file already says about the crisis box below.
  // `selectSectionHeading` is how a heading reaches a column that sits BESIDE
  // the prose rather than above it.
  const coachingHeading = selectSectionHeading(disclaimer, COACHING);

  // The "What Lelañea Is Not" section is EIGHT paragraphs, not seven: the seven
  // "Lelañea is **not** a…" lines, then a qualifying paragraph about concepts
  // the app references without endorsing. Rendering the whole section as list
  // rows — which was the first version — put that qualifier in the column with
  // a red cross beside it, reading as an eighth thing Lelañea is not.
  //
  // So the shape is the split, and `sections.test.ts` pins both halves at 7 and
  // 1. The prototype's own array has exactly the seven, which is the agreement
  // that says this split is the authored intent and not a convenience.
  const isNotSection = selectSectionText(disclaimer, IS_NOT);
  const isNot = isNotSection.filter((line) => IS_NOT_ITEM.test(line));
  const isNotNote = isNotSection.filter((line) => !IS_NOT_ITEM.test(line));

  return (
    <div className={styles.page}>
      <section className={styles.opening}>
        <Eyebrow as="p">your data</Eyebrow>
        <h1 className="brand-display mt-[18px] mb-6 max-w-[20ch] text-[clamp(36px,4.2vw,58px)]">
          Your work stays yours.
        </h1>
        <p className={`${styles.measure} text-[18px] leading-[1.72]`}>
          You can see everything the app holds, take a copy of it at any time, and delete any part
          of it.
        </p>

        <div className={styles.cards}>
          {DATA_RIGHTS.map((right) => (
            <Card key={right.title} title={right.title}>
              {right.body}
            </Card>
          ))}
        </div>

        {/* A `p`, not a heading: the page's next heading is the `h2` on "what
            it is, what it is not", and a heading here would be an `h3` under
            an `h1` with no `h2` between them. `Eyebrow` renders identical type
            either way. */}
        <div className={styles.rightsStrip}>
          <Eyebrow as="p">your rights under gdpr</Eyebrow>
          <ul className={styles.rightsList}>
            {GDPR_RIGHTS.map((right) => (
              <li key={right}>{right}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-[15px]">All supported.</p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.rule}`}>
        <Eyebrow as="h2">what it is, what it is not</Eyebrow>

        <div className={`${styles.split} mt-8`}>
          <div>
            {/* Not a heading: "it is designed to support" labels a column, and
                the section's own `h2` is the eyebrow above. A third heading
                level here would put two half-columns into the outline as
                siblings of the section that contains them. */}
            <p className="brand-eyebrow mb-2 text-[var(--color-status-green-ink)]">
              it is designed to support
            </p>
            <AuthoredBlocks
              blocks={purpose}
              renderStyle={disclaimer.renderStyle}
              className={styles.measure}
            />
          </div>

          <div>
            <p className="brand-eyebrow mb-2 text-[var(--color-status-red-ink)]">it is not</p>
            {/* A real list, because it is one — seven items the reader is meant
                to scan, not seven paragraphs. The authored file writes them as
                paragraphs; `selectSectionText` is what lets the markup say what
                the content means without either copy drifting. */}
            <ul>
              {isNot.map((line) => (
                <li key={line} className={styles.listRow}>
                  <CrossIcon />
                  <span>
                    <InlineText text={line} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* What both columns turn towards: the purpose section's closing
            negation, then the crossed list's own qualifying paragraph. Neither
            belongs inside a column — the first contradicts its label, the
            second qualifies a list rather than being an item in it. */}
        <div className={`${styles.measure} mt-8`}>
          <AuthoredBlocks
            blocks={purposeTurn}
            renderStyle={disclaimer.renderStyle}
            className="text-[17px] leading-[1.7]"
          />
          <div className="text-muted-foreground mt-3 text-[15px]">
            {isNotNote.map((line, index) => (
              <p key={index} className="mb-3 last:mb-0">
                <InlineText text={line} />
              </p>
            ))}
          </div>
        </div>

        {/*
          The crisis disclosure, rendered WITH its authored heading rather than
          with `{CRISIS}` — the constant above is the selector, and displaying
          it would put the words on screen from this file instead of from the
          document (see `selectSection`).

          Not the `Banner` component, though it is the house shape for exactly
          this palette. `Banner` gives `error` `role="alert"`, which is right
          for something that appears in response to what a reader just did and
          wrong for a permanent section of a page — it would interrupt whatever
          a screen reader was saying on arrival. It is also `text-sm`, and this
          is the paragraph on the site that most needs to be read.
        */}
        <section
          // The footer links here from every page in the site, so this is a
          // navigation target and not just a box. Without the fragment a reader
          // following "what to do in a crisis" lands at the top of `/data` and
          // has to scroll past the data-rights cards and both columns to find
          // the thing they clicked for.
          //
          // 104px, the value `waitlist-form.tsx` already justified as "78px of
          // bar plus room to breathe". `scroll-mt-24` (96px) was the first
          // guess and it is too small: below 880px the header wraps its links
          // onto a second row and stands 100px or more, so the box's top edge —
          // and on a narrower wrap, the heading itself — landed behind the bar.
          id={CRISIS_ANCHOR}
          className="mt-10 scroll-mt-[104px] rounded-[18px] border border-[var(--color-status-red)] bg-[var(--color-status-red-bg)] p-6"
        >
          <AuthoredBlocks
            blocks={crisis}
            renderStyle={disclaimer.renderStyle}
            baseLevel={3}
            className={styles.measure}
          />
        </section>
      </section>

      <section className={`${styles.section} ${styles.rule}`}>
        <div className={styles.split}>
          <div>
            <Eyebrow as="p">coaching and therapy</Eyebrow>
            <h2 className="brand-display mt-[14px] text-[clamp(28px,3.1vw,38px)]">
              {coachingHeading}
            </h2>
          </div>
          <AuthoredBlocks
            blocks={coaching}
            renderStyle={disclaimer.renderStyle}
            className={`${styles.measure} ${styles.lede}`}
          />
        </div>

        <p className="text-muted-foreground mt-10 text-[15px]">
          These are extracts.{' '}
          <Link href="/disclaimer" className="underline underline-offset-4">
            Read the full disclosures
          </Link>{' '}
          for the complete account, including mental health conditions, spiritual perspectives and
          personal responsibility.
        </p>
      </section>
    </div>
  );
}
