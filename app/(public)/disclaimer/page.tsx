import type { Metadata } from 'next';

import { AuthoredDocument } from '@/components/app/content/authored-document';
import { requireDocument } from '@/lib/app/content/sections';
import styles from '@/app/(public)/document-page.module.css';

export const metadata: Metadata = {
  title: 'Disclosures',
  description:
    'What Lelañea is, what it is not, and the disclosures that go with it — in full, as written.',
  alternates: { canonical: '/disclaimer' },
};

/**
 * `/disclaimer` — the disclosure document, whole.
 *
 * `/data` is the designed version of this: three of its sections lifted into
 * the site's own chrome, where a visitor who has not decided to read a legal
 * document still meets them. This is the document itself, top to bottom, for
 * the reader who wants all of it — and it is what `/data` links to.
 *
 * Both surfaces read the same blocks through the same renderer, so there is no
 * second copy to keep in step. That is the entire reason `/data` selects
 * sections rather than restating them.
 *
 * ## Rendered whole, so the header is the page
 *
 * `AuthoredDocument` carries the eyebrow, the `h1` and the subtitle, which is
 * exactly the page furniture this route needs — hence no chrome of its own
 * beyond the measure. The document's `requiresAcknowledgement` flag is not read
 * here: acknowledgement is the gate in front of the shell (f-gateway),
 * and a public reader is not being asked to agree to anything by arriving.
 *
 * @see .context/app/content.md — the pipeline
 */
export default function DisclaimerPage() {
  const disclaimer = requireDocument('disclaimer');

  return (
    <div className={styles.page}>
      <div className={styles.opening}>
        <AuthoredDocument document={disclaimer} className={`${styles.measure} pb-20`} />
      </div>
    </div>
  );
}
