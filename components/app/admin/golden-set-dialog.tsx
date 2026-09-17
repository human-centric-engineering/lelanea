'use client';

/**
 * What is actually in the voice test set, on the page that runs it.
 *
 * The comparison surface used to describe the set in prose and show its
 * questions only once a run existed — so the first thing an operator saw was a
 * button whose effect was unreadable, and the empty state repeated the
 * description rather than answering it. This renders the authored set itself:
 * every question, what each one is probing, and the control's whole system
 * prompt, before anything has been queued.
 *
 * It takes the set as a prop rather than reading it. `getVoiceGoldenSet()`
 * parses a file off disk, so calling it here would pull `fs` into the client
 * bundle; the server page reads it once and passes the view down.
 *
 * @see app/admin/app/voice/page.tsx — where the set is read
 * @see lib/app/content/index.ts — `getVoiceGoldenSet()`, the authored view
 * @see .context/app/voice.md
 */

import { useState } from 'react';
import { BookOpen } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** The authored file the set is seeded from, named on screen so it can be found. */
const SOURCE_FILE = 'content/lelanea_voice_golden_set.json';

export interface GoldenSetView {
  version: string;
  /** Why these questions and not others — authored, not generated. */
  provenanceNote: string;
  awaitingSignOffFrom: string | null;
  prompts: readonly {
    key: string;
    kind: string;
    prompt: string;
    probe: string;
  }[];
  /** The bare arm's entire system prompt, authored so the control is readable too. */
  controlInstructions: string;
}

export function GoldenSetDialog({ goldenSet }: { goldenSet: GoldenSetView }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BookOpen className="mr-2 h-4 w-4" />
          What is in the test set?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>The voice test set</DialogTitle>
          <DialogDescription>
            {goldenSet.prompts.length} questions, version {goldenSet.version}, authored in{' '}
            <code>{SOURCE_FILE}</code>. The seed writes them into the dataset both arms answer, so
            editing them means editing that file and re-seeding — not editing a row.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>{goldenSet.provenanceNote}</p>
            {goldenSet.awaitingSignOffFrom && (
              <p>Drafted, not final — awaiting sign-off from {goldenSet.awaitingSignOffFrom}.</p>
            )}
          </div>

          <div className="space-y-4">
            {goldenSet.prompts.map((entry) => (
              <div key={entry.key} className="rounded-md border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{entry.kind}</Badge>
                  <span className="text-muted-foreground text-xs">{entry.key}</span>
                </div>
                <p className="mt-2 font-medium">{entry.prompt}</p>
                {/* The probe, not a right answer: the file carries no expected
                    output, so what a reader needs is what the question is for. */}
                <p className="text-muted-foreground mt-1 text-sm">{entry.probe}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-sm font-medium">The control&rsquo;s whole system prompt</p>
            <p className="text-muted-foreground mt-1 text-sm">
              What the second column is told, in full. It is authored in the same file as the
              questions, so the thing the voice is measured against is readable rather than assumed.
            </p>
            <pre className="bg-muted mt-2 max-h-48 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">
              {goldenSet.controlInstructions}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
