'use client';

import * as React from 'react';

import { Button } from '@/components/app/ui/button';
import { useConsentBannerClearance } from '@/components/app/ui/consent-clearance';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { apiClient } from '@/lib/api/client';
import type { FirstRunBeat, OnboardingRead } from '@/lib/app/onboarding/first-run';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/** The API each beat is recorded through as the person moves past it. */
export const FIRST_RUN_ROUTE = '/api/v1/app/onboarding/first-run';

/**
 * The build's words around her documents: plain, and about the mechanics only.
 * Nothing here is presented as hers. No counts, so a read added or removed
 * never leaves a sentence saying how many there are.
 */
export const FIRST_RUN_COPY = {
  continue: 'Continue',
  offer: 'Skip it if you like. It stays in Resources.',
  read: 'Read it',
  skip: 'Not now',
} as const;

/** The Initiation: her whole welcome, already rendered with the name. */
export interface InitiationStep {
  beat: 'initiation';
  body: React.ReactNode;
}

/** One read, offered: its header, and the document to open under it. */
export interface ReadStep {
  beat: `read:${OnboardingRead}`;
  eyebrow: string;
  title: string;
  subtitle: string | null;
  body: React.ReactNode;
}

export type FirstRunStep = InitiationStep | ReadStep;

/**
 * The beats moved past since this page loaded.
 *
 * `/app`'s server output is the list of steps still pending when it rendered,
 * and the stepper's place in it is client state. So a Back navigation, which
 * restores `/app` from the router's cache, remounted the stepper at the start
 * of a list the person had finished, and so did coming back before the
 * records landed (`/code-review` round 2). Held at module scope, which lives
 * as long as the page, so a remount skips what is behind the person whatever
 * the server last said. A full reload clears it and reads the ledger again.
 */
const passed = new Set<FirstRunBeat>();

/** For tests: forget what this page has moved past. */
export function forgetPassedBeats(): void {
  passed.clear();
}

/** Tell the server the person moved past `beat`. Never waited on, never retried. */
function record(beat: FirstRunBeat): void {
  passed.add(beat);
  apiClient.post(FIRST_RUN_ROUTE, { body: { beat } }).catch((caught: unknown) => {
    // The person has moved on; nothing here should hold them. A beat that did
    // not land is replayed once on their next entry, which is the remedy.
    logger.warn('First-run beat did not land', { beat, error: String(caught) });
  });
}

/**
 * The first-run sequence: the Initiation, then each read offered in turn
 * (t-103, §3.9). Renders over the conversation on `/app` until every beat is
 * behind the person, then renders nothing, which leaves the conversation.
 *
 * `steps` is only what is still to come. The server worked that out from the
 * onboarding node's ledger, so a reload resumes at the first beat not yet
 * moved past, and a finished sequence is never rendered at all.
 *
 * ## Focus follows the step
 *
 * A step replaces the one before it in place, so a keyboard or screen-reader
 * user would otherwise be left on a button that no longer exists. The new
 * step's heading takes focus, which also brings it to the top of the scroll
 * container. Not on the first render: nothing has moved yet.
 */
export function FirstRun({ steps: fromServer }: { steps: readonly FirstRunStep[] }) {
  // Fixed for this mount: filtering on every render would shift the list
  // under `index` as each beat is passed.
  const [steps] = React.useState(() => fromServer.filter((step) => !passed.has(step.beat)));
  const [index, setIndex] = React.useState(0);
  const [opened, setOpened] = React.useState(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  const moved = React.useRef(false);
  // Each step ends on its button, and a first visit is when the cookie banner
  // is most likely still up over the bottom of the page (t-117).
  const clearance = useConsentBannerClearance();

  React.useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start' });
  }, [index]);

  React.useEffect(() => {
    if (opened) body.current?.focus();
  }, [opened]);

  const step = steps[index];
  if (!step) return null;

  const next = (): void => {
    record(step.beat);
    moved.current = true;
    setOpened(false);
    setIndex((i) => i + 1);
  };

  return (
    <div
      className="bg-background min-h-full"
      style={clearance > 0 ? { paddingBottom: clearance } : undefined}
      data-testid="first-run"
    >
      <div
        key={step.beat}
        className={cn(
          'mx-auto flex w-full max-w-[42rem] flex-col gap-8',
          'px-6 pt-[clamp(28px,5vw,56px)] pb-16 max-[480px]:px-4'
        )}
        data-testid={`first-run-${step.beat}`}
      >
        {step.beat === 'initiation' ? (
          <>
            {/* `AuthoredDocument` carries its own eyebrow and `h1`. Nothing
                moves focus here: the Initiation is only ever the first step. */}
            <div>{step.body}</div>
            <Button type="button" size="lg" className="self-start" onClick={next}>
              {FIRST_RUN_COPY.continue}
            </Button>
          </>
        ) : (
          <>
            <header className="flex flex-col gap-2">
              <Eyebrow as="p">{step.eyebrow}</Eyebrow>
              <h1
                ref={heading}
                tabIndex={-1}
                className="brand-display text-3xl text-[var(--color-heading)] outline-none sm:text-4xl"
              >
                {step.title}
              </h1>
              {step.subtitle === null ? null : (
                <p className="text-muted-foreground text-lg">{step.subtitle}</p>
              )}
            </header>

            {opened ? (
              <>
                <div
                  ref={body}
                  tabIndex={-1}
                  className="outline-none"
                  data-testid="first-run-read-body"
                >
                  {step.body}
                </div>
                <Button type="button" size="lg" className="self-start" onClick={next}>
                  {FIRST_RUN_COPY.continue}
                </Button>
              </>
            ) : (
              <>
                <p className="text-foreground max-w-prose">{FIRST_RUN_COPY.offer}</p>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" onClick={() => setOpened(true)}>
                    {FIRST_RUN_COPY.read}
                  </Button>
                  <Button type="button" variant="ghost" onClick={next}>
                    {FIRST_RUN_COPY.skip}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
