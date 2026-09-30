import { Discovery, type DiscoveryQuestionProps } from '@/components/app/onboarding/discovery';
import type { DiscoveryState } from '@/lib/app/onboarding/discovery-store';

/**
 * The discovery questions' server half: the person's state, read on the
 * server, handed to the client surface as plain props (f-onboarding t-104).
 *
 * - `app`: on `/app`, after the reads. The first sitting asks; once the
 *   person has answered, skipped or left, a return offers the next question
 *   instead. Nothing once every question is answered or skipped.
 * - `module`: Onboarding's own area, always, with every question.
 *
 * The state comes in already read (`getDiscoveryState`), because both callers
 * need it for something else first: `/app` to know whether anything is left,
 * the module page to know whether this module is the one that asks them.
 */
export function DiscoveryView({
  userId,
  state,
  where,
}: {
  userId: string;
  state: DiscoveryState;
  where: 'app' | 'module';
}) {
  if (where === 'app' && state.position.finished) return null;

  const questions: DiscoveryQuestionProps[] = state.set.questions.map((q) => ({
    id: q.id,
    number: q.number,
    text: q.text,
    ...(q.hint !== undefined && { hint: q.hint }),
    ...(q.conditionalFollowUp !== undefined && { followUp: q.conditionalFollowUp }),
    core: q.core,
  }));

  return (
    <Discovery
      userId={userId}
      variant={where === 'module' ? 'module' : state.started ? 'offer' : 'first'}
      preamble={state.set.preamble.text}
      questions={questions}
      answers={state.answers}
      skipped={state.position.skipped}
    />
  );
}
