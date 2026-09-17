'use client';

/**
 * Adding her material and saying what it is for, on one page.
 *
 * Those are one act, and until this component they were two places: t-25 built
 * the designation table here and its empty state had to send her to
 * **AI Orchestration → Knowledge** to put anything in it. That is a tier of the
 * admin she has no other reason to visit — built for someone operating an agent
 * platform rather than someone curating a corpus — and it surfaces choices this
 * app has already made for her.
 *
 * ## The uploader is Sunrise's, IMPORTED — not copied and not adapted
 *
 * `components/admin/orchestration/knowledge/document-upload-zone.tsx` is
 * Sunrise-owned. Importing it means the platform's parsers, its 50 MB / ten-file
 * limits, its PDF preview flow and every future improvement merge through and
 * this leaf carries no divergence row. Copying it would buy a file we maintain
 * forever and re-solve on every sync (`sunrise.divergences`), and editing the
 * platform's copy to fit one leaf is the thing `HB7` exists to stop.
 *
 * The premise this task inherited — that the app surface would have to hide the
 * uploader's scope selector and its built-in-reference panel — did not survive a
 * read of the code. Neither is in the component: the scope segmented control
 * lives in `knowledge-view.tsx` and the *Agentic Design Patterns* panel in
 * `manage-tab.tsx`, both siblings. `DocumentUploadZone`'s entire surface is
 * `onUploadComplete` + `onPdfPreview`, so it arrives with nothing
 * orchestration-specific attached and needs no seam to make it fit.
 *
 * ## The PDF modal is not optional here, and that is the finding
 *
 * `onPdfPreview` is an optional prop, which reads as "omit it and PDFs just
 * upload". They do not. A PDF lands in `pending_review` with its extracted text
 * in `metadata` and is chunked only when something POSTs the confirm route — so
 * a page that renders the zone WITHOUT the modal strands every PDF in a state it
 * offers no way out of, while `onUploadComplete()` still fires and the table
 * still shows a row. That is `HB10`: the guard exists, the remedy has to ship
 * beside it. `PdfPreviewModal` is Sunrise's too, and imported for the same
 * reasons.
 *
 * ## Nothing is passed about scope, because there is nothing to pass
 *
 * `lib/orchestration/knowledge/document-manager.ts` hardcodes `scope: 'app'` at
 * all three of its create sites — text upload, binary upload, and the PDF
 * pending-review row — which is exactly the scope
 * `listDesignatedDocuments` filters on. So a document added here appears in the
 * table below without either surface knowing about the other.
 * `tests/unit/lib/app/voice/upload-scope.test.ts` pins that agreement, because
 * it is an agreement across a tier boundary and nothing else would report it
 * breaking.
 *
 * ## What she can do here that the designation table would not have allowed
 *
 * The zone's tag picker offers the whole managed taxonomy, the six designation
 * tags included, so she can attach `purpose-knowledge` AND `purpose-voice` at
 * upload — a pair `setDesignation`'s partitioned write cannot produce. It is
 * read safely: `readDesignation` resolves a conflict by an explicit precedence
 * in which `voice` wins, so the pair reads as `voice` and the document is not
 * quotable. Narrowing the picker would mean forking the platform component, for
 * a state that already resolves in the safe direction and that the table below
 * shows as a single value she can correct.
 *
 * @see app/admin/app/knowledge/page.tsx — the server page that seeds it
 * @see components/app/admin/designation-table.tsx — the second act
 * @see .context/app/voice.md
 */

import { useCallback, useState, type ReactElement } from 'react';

import {
  DocumentUploadZone,
  type PdfPreviewData,
} from '@/components/admin/orchestration/knowledge/document-upload-zone';
import { PdfPreviewModal } from '@/components/admin/orchestration/knowledge/pdf-preview-modal';
import { DesignationTable } from '@/components/app/admin/designation-table';
import type { DesignatedDocument } from '@/lib/app/voice/designation-admin';
import type { PaginationMeta } from '@/types/api';

interface KnowledgeWorkspaceProps {
  initialDocuments: DesignatedDocument[];
  initialMeta: PaginationMeta;
  /** True when the server page could not load the first page. Forwarded verbatim. */
  initialLoadFailed?: boolean;
}

export function KnowledgeWorkspace({
  initialDocuments,
  initialMeta,
  initialLoadFailed = false,
}: KnowledgeWorkspaceProps): ReactElement {
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewData | null>(null);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  /**
   * Bumped whenever something lands in the corpus, which is what tells the table
   * to go and look again.
   *
   * A counter rather than a `key` remount: remounting would re-seed the table
   * from `initialDocuments`, the list as it stood when the page was rendered on
   * the server, so the document just uploaded would be the one row missing.
   */
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const handlePdfPreview = useCallback((data: PdfPreviewData) => {
    setPdfPreview(data);
    setPdfPreviewOpen(true);
  }, []);

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="add-material-heading"
        className="border-border rounded-lg border p-4"
      >
        <h3 id="add-material-heading" className="text-sm font-semibold">
          Add material
        </h3>
        <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
          Drop a file here, then say what it is for in the table below. Nothing you add reaches the
          agent until it has a purpose.
        </p>
        <DocumentUploadZone onUploadComplete={reload} onPdfPreview={handlePdfPreview} />
      </section>

      {/*
        The remedy for the state the upload route puts a PDF in. Without it a PDF
        sits in `pending_review` with no way to confirm or discard it from this
        page — see the header.
      */}
      <PdfPreviewModal
        data={pdfPreview}
        open={pdfPreviewOpen}
        onOpenChange={setPdfPreviewOpen}
        onConfirmed={reload}
      />

      <DesignationTable
        initialDocuments={initialDocuments}
        initialMeta={initialMeta}
        initialLoadFailed={initialLoadFailed}
        reloadToken={reloadToken}
      />
    </div>
  );
}
