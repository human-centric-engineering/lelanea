import type { Metadata } from 'next';

import { Eyebrow } from '@/components/app/ui/eyebrow';

/**
 * "The conversation", matching the nav — not "Your journey", which the nav uses
 * for a different destination. Without this the layout's `%s` template had no
 * page supplying a title, so it never fired and every one of the eight
 * destinations shared a single tab label.
 */
export const metadata: Metadata = { title: 'The conversation' };

/**
 * The shell's landing view: what fills the panes area before `t-10` builds it.
 *
 * `t-10` replaces this with the conversation pane and the workspace surface —
 * the pairing that is the core design idea. Until then the frame needs
 * something in the middle that is honest about being empty rather than a
 * mocked-up conversation, so this says so in one plain line (D6).
 */
export default function ShellHomePage() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <Eyebrow className="mb-3 block">The conversation</Eyebrow>
        <p className="text-muted-foreground text-sm leading-relaxed">
          This is where you and Lelañea will talk. The conversation arrives in a later phase.
        </p>
      </div>
    </main>
  );
}
