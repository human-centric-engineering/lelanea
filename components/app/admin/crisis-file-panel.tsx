'use client';

/**
 * The crisis resource as a file, on the helplines page (f-content-seeds t-92).
 *
 * Export in the seed's shape; import with a preview. Everything an import
 * writes arrives as a draft, and a country the file leaves out is kept unless
 * the box is ticked — crisis regions keep no history, so a removed one can only
 * be typed in again.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ImportExportPanel, NoticeLine, type Notice } from '@/components/app/admin/content/parts';
import { CRISIS_FILE_ENDPOINTS } from '@/lib/app/safety/endpoint';

export function CrisisFilePanel() {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);

  return (
    <div className="max-w-3xl space-y-2">
      <NoticeLine notice={notice} />
      <ImportExportPanel
        endpoints={CRISIS_FILE_ENDPOINTS}
        fileName="lelanea_crisis_resources.json"
        what="the helplines"
        removal={{
          note: 'Countries keep no history here: a removed country can only be added back by typing it in again. The audit log keeps its numbers.',
        }}
        onApplied={(message) => {
          setNotice({
            tone: 'ok',
            text: `${message} Everything it changed is a draft until it is signed off here.`,
          });
          router.refresh();
        }}
      />
    </div>
  );
}
