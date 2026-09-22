import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthoredBlocks, CATEGORY_LABEL } from '@/components/app/content/authored-document';
import { BeginView } from '@/components/app/views/begin-view';
import { MaintenanceWrapperWithAdminNotice } from '@/components/maintenance-wrapper';
import { getGateStatus, toGateStatusJson } from '@/lib/app/gateway/acknowledgements';
import { verificationRedirectFor } from '@/lib/app/gateway/gate';
import { DOCUMENT_FOR_KIND } from '@/lib/app/gateway/acknowledgements';
import type { FoundationalDocumentDetail } from '@/lib/app/content';
import { requireDocument } from '@/lib/app/content/sections';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { getServerSession } from '@/lib/auth/utils';

export const metadata: Metadata = {
  title: 'Begin',
  description: 'Read the disclaimer and the terms, confirm your age, and begin.',
  robots: { index: false },
};

/**
 * One document on the gate page: its own header, then the blocks.
 *
 * Not `AuthoredDocument`, deliberately — that renders an `<h1>`, and a page
 * with two of them plus its own has three. Same eyebrow, same title register,
 * one level down.
 */
function GateDocument({ document: doc }: { document: FoundationalDocumentDetail }) {
  return (
    <article className="text-foreground">
      <header className="mb-8">
        <p className="brand-eyebrow text-muted-foreground mb-2">{CATEGORY_LABEL[doc.category]}</p>
        <h2 className="brand-display text-3xl text-[var(--color-heading)]">{doc.title}</h2>
        {doc.subtitle === null ? null : (
          <p className="text-muted-foreground mt-2 text-lg">{doc.subtitle}</p>
        )}
      </header>
      <AuthoredBlocks blocks={doc.blocks} renderStyle={doc.renderStyle} baseLevel={3} />
    </article>
  );
}

/**
 * `/app/begin` — the gate in front of the shell, and afterwards the record.
 *
 * ## Why this is its own route group, at the shell's URL
 *
 * The shell layout (`app/(lelanea)/app/layout.tsx`) redirects here until every
 * acknowledgement stands. A page under that layout would be redirected to
 * itself, so this lives in `app/(gate)/`, a sibling group: same `/app` prefix,
 * so `proxy.ts` already keeps a signed-out visitor away, and no shell chrome,
 * because there is nothing to navigate to yet. It still wraps itself in the
 * maintenance wrapper for the reason the shell does — a route group that
 * skips it takes itself out of maintenance mode silently.
 *
 * ## What is checked here, and what is not
 *
 * Verification is: an unverified address is sent to verify from here as from
 * the shell, since this page is outside the layout that would otherwise do it.
 * The acknowledgements are NOT a redirect condition here — this is the page
 * they are made on, and afterwards the page a person reads them back on.
 *
 * ## The two documents are rendered here, not in the view
 *
 * `AuthoredBlocks` is a server component and the prose is read from the database;
 * rendering it here and handing the nodes to the client view means the words
 * are never serialised as props and never re-rendered on a click. The view
 * shows one at a time — see `BeginView` for why it is steps and not a page.
 */
export default async function BeginPage() {
  const session = await getServerSession();
  if (!session) {
    clearInvalidSession('/app/begin');
  }

  const verify = verificationRedirectFor(session.user);
  if (verify) redirect(verify);

  const [status, disclaimer, terms] = await Promise.all([
    getGateStatus(session.user.id),
    requireDocument(DOCUMENT_FOR_KIND.disclaimer),
    requireDocument(DOCUMENT_FOR_KIND.terms),
  ]);

  return (
    <MaintenanceWrapperWithAdminNotice>
      {/*
        Plain utilities, and none of `document-page.module.css`. That module is
        the public document pages' editorial system — `.page` is a 1180px
        column and `.measure` a 62ch book measure on every paragraph — and the
        first cut borrowed both. `.measure` left a 411px paragraph on a 1650px
        laptop; swapping it for `max-w-[100ch]` beside `.page` changed nothing,
        because the module is unlayered and a Tailwind utility lives in
        `@layer utilities`, which loses to any unlayered rule whatever the
        order. So the gate sets its own column: 100ch, which is the width that
        read well, with the same gutters the public pages use.
      */}
      <main className="mx-auto max-w-[100ch] px-[clamp(20px,5vw,72px)]">
        <BeginView
          initialStatus={toGateStatusJson(status)}
          documents={{
            disclaimer: <GateDocument document={disclaimer} />,
            terms: <GateDocument document={terms} />,
          }}
        />
      </main>
    </MaintenanceWrapperWithAdminNotice>
  );
}
