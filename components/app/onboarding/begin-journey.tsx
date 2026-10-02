'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

import { useJourneyMoved } from '@/components/app/shell/use-shell-layout';
import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { apiClient } from '@/lib/api/client';
import { logger } from '@/lib/logging';

/** The route the step posts to. */
export const BEGIN_JOURNEY_ROUTE = '/api/v1/app/onboarding/begin';

/** What the route answers, as far as the step reads it. */
const begunSchema = z.object({ next: z.string().startsWith('/app/') });

/**
 * The step's words. Honest about Values: it is where the journey begins, and
 * its content is not written yet, so the step says so rather than promising
 * what is not there. No counts.
 */
export const BEGIN_JOURNEY_COPY = {
  eyebrow: 'onboarding',
  heading: 'Begin the journey',
  done: 'That is the last of the discovery questions. Thank you for what you wrote.',
  waiting: (module: string) =>
    `Some you skipped are still waiting. You can come back to them, or change any answer, whenever you like in ${module}, on the map.`,
  revisable: (module: string) =>
    `You can come back and change any answer whenever you like in ${module}, on the map.`,
  values:
    'The journey begins with Values. Its pages are not written yet: for now it is a place on the map, and the conversation is where it happens.',
  begin: 'Begin the journey',
  failedLead: 'Not begun.',
  failed: 'The journey could not be begun just now. Try again in a moment.',
} as const;

/**
 * "Begin the journey" (§3.9, f-onboarding t-106): the hand-off at the end of
 * onboarding, offered once every question in the set is answered or skipped.
 *
 * Pressing it completes onboarding and enters Values on the server, then goes
 * to the Values page and tells the shell the journey moved, so the map reads
 * its states again. A press that fails says so and can be pressed again: the
 * route finishes whatever half was left.
 */
export function BeginJourney({
  waiting,
  moduleName,
  beforeBegin,
  onBegun,
}: {
  /** Skipped questions are still unanswered. */
  waiting: boolean;
  /** The module that holds the questions, by name. */
  moduleName: string;
  /** Awaited before the post: whatever the server must have first. */
  beforeBegin?: () => Promise<void>;
  /** Called once the journey has begun, before navigating. */
  onBegun?: () => void;
}) {
  const router = useRouter();
  const journeyMoved = useJourneyMoved();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const begin = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await beforeBegin?.();
      const answer = begunSchema.parse(await apiClient.post<unknown>(BEGIN_JOURNEY_ROUTE));
      onBegun?.();
      journeyMoved();
      router.push(answer.next);
    } catch (caught) {
      logger.warn('Journey did not begin', { error: String(caught) });
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" data-testid="begin-journey">
      <Eyebrow as="p">{BEGIN_JOURNEY_COPY.eyebrow}</Eyebrow>
      <h2 className="brand-display text-2xl leading-[1.3] text-[var(--color-heading)]">
        {BEGIN_JOURNEY_COPY.heading}
      </h2>
      <p className="text-foreground max-w-prose leading-[1.65]">{BEGIN_JOURNEY_COPY.done}</p>
      <p className="text-muted-foreground max-w-prose leading-[1.65]">
        {waiting
          ? BEGIN_JOURNEY_COPY.waiting(moduleName)
          : BEGIN_JOURNEY_COPY.revisable(moduleName)}
      </p>
      <p className="text-muted-foreground max-w-prose leading-[1.65]">
        {BEGIN_JOURNEY_COPY.values}
      </p>
      {failed ? (
        <Banner tone="error" lead={BEGIN_JOURNEY_COPY.failedLead}>
          {BEGIN_JOURNEY_COPY.failed}
        </Banner>
      ) : null}
      <div>
        <Button type="button" size="lg" disabled={busy} onClick={() => void begin()}>
          {BEGIN_JOURNEY_COPY.begin}
        </Button>
      </div>
    </section>
  );
}
