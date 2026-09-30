import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AuthoredBlocks, CATEGORY_LABEL } from '@/components/app/content/authored-document';
import { View } from '@/components/app/views/view';
import { requireDocument } from '@/lib/app/content/sections';
import { isOnboardingRead } from '@/lib/app/onboarding/first-run';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  if (!isOnboardingRead(id)) return {};
  const doc = await requireDocument(id);
  return { title: doc.title };
}

/**
 * One of the reads — the heart behind Lelañea, the mission, the creator, the
 * lineage — in the workspace, beside the conversation (t-103).
 *
 * The first run offers each once; this is where they stay. The resources
 * drawer links here rather than out to the public pages, so reading one never
 * leaves the shell. The public pages still exist, for visitors, and render the
 * same rows.
 *
 * Only the reads: any other id is the shell's 404. The legal documents have
 * their own pages and their own acknowledgement flow, and the Initiation is
 * the first run's alone.
 */
export default async function ReadPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!isOnboardingRead(id)) notFound();

  const doc = await requireDocument(id);

  return (
    <View eyebrow={CATEGORY_LABEL[doc.category]} title={doc.title} lede={doc.subtitle} column>
      <AuthoredBlocks
        blocks={doc.blocks}
        renderStyle={doc.renderStyle}
        baseLevel={2}
        className="text-foreground max-w-[42rem] text-[15.5px] leading-[1.75]"
      />
    </View>
  );
}
