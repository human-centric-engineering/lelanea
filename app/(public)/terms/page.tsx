import type { Metadata } from 'next';

import { AuthoredDocument } from '@/components/app/content/authored-document';
import { requireDocument } from '@/lib/app/content/sections';
import styles from '@/app/(public)/document-page.module.css';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The terms that govern your use of Lelañea.',
  alternates: { canonical: '/terms' },
};

/**
 * `/terms` — the Terms of Use, as written.
 *
 * ## This file is Sunrise's, replaced whole (divergence row 9)
 *
 * The starter ships a placeholder terms page here — "This is a placeholder
 * terms of service. Replace this content with your actual terms" — which is
 * correct for a template and cannot ship on lelanea.com. There is no seam for
 * it: the route is a page file, and a page is replaced rather than configured.
 * The ledger row records that, so the next Daybreak sync meets the change with
 * an explanation rather than as an unexplained conflict.
 *
 * ## The two unfilled placeholders are visible outside production, on purpose
 *
 * `terms_of_use` declares `[Month Day, Year]` and `[Support Email]`, and both
 * are launch blockers. `AuthoredDocument` highlights an unresolved placeholder
 * everywhere except production, where the words are just the words — a reader
 * is shown the copy, not our editorial state. That is decision D8's "visibly
 * marked outside production", and it is the renderer's behaviour rather than
 * anything this page does, so it cannot be forgotten here.
 *
 * Three further review notes on this document are NOT closed by this task and
 * are none of its business: clause 12 refers to a Lelañea privacy policy that
 * does not exist yet (see `/privacy`, which says so), clause 17 leaves the
 * governing jurisdiction unnamed, and clause 10 cross-references the lineage
 * document without linking it. All three need her or a lawyer, not a page.
 *
 * @see .context/app/divergences.md — row 9
 * @see .context/app/content.md — the pipeline
 */
export default function TermsOfUsePage() {
  const terms = requireDocument('terms_of_use');

  return (
    <div className={styles.page}>
      <div className={styles.opening}>
        <AuthoredDocument document={terms} className={`${styles.measure} pb-20`} />
      </div>
    </div>
  );
}
