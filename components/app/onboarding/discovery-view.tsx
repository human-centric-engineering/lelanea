import { Discovery, type DiscoveryQuestionProps } from '@/components/app/onboarding/discovery';
import type { DiscoveryState } from '@/lib/app/onboarding/discovery-store';
import { fallbackModuleName } from '@/lib/app/modules/definitions';

/**
 * The discovery questions' server half: the person's state, read on the
 * server, handed to the client surface as plain props (f-onboarding t-104).
 *
 * - `app`: on `/app`, after the reads. The first sitting asks; once the
 *   person has answered, skipped or left, a return offers the next question
 *   instead. Once every question is answered or skipped, the step into the
 *   journey (t-106), and nothing once that is taken. When the
 *   set does not allow partial completion, a return asks again rather than
 *   offering, and there is no way past a question but an answer.
 * - `module`: the area of the module the set names, always, with every
 *   question, and the step into the journey until it is taken. Its path and
 *   name come from the set, not from here.
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
  if (state.set.questions.length === 0) return null;
  if (where === 'app' && state.position.finished && state.handedOff) return null;

  const partial = state.set.pacing.allowPartialCompletion;

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
      variant={where === 'module' ? 'module' : state.started && partial ? 'offer' : 'first'}
      preamble={state.started ? null : state.set.preamble.text}
      questions={questions}
      answers={state.answers}
      versions={state.versions}
      skipped={state.position.skipped}
      partial={partial}
      moduleHref={`/app/modules/${state.set.moduleSlug}`}
      moduleName={fallbackModuleName(state.set.moduleSlug)}
      handedOff={state.handedOff}
    />
  );
}
