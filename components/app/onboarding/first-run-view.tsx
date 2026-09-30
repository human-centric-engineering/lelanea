import {
  AuthoredBlocks,
  AuthoredDocument,
  CATEGORY_LABEL,
} from '@/components/app/content/authored-document';
import { FirstRun, type FirstRunStep } from '@/components/app/onboarding/first-run';
import { requireDocument } from '@/lib/app/content/sections';
import { firstNameFrom } from '@/lib/app/onboarding/first-name';
import {
  isOnboardingRead,
  type FirstRunBeat,
  type OnboardingRead,
} from '@/lib/app/onboarding/first-run';
import { logger } from '@/lib/logging';

/** The Initiation's document id: `surface: first_run_welcome`. */
export const INITIATION_DOCUMENT = 'the_initiation';

function readIdOf(beat: FirstRunBeat): OnboardingRead | null {
  if (beat === 'initiation') return null;
  const id = beat.slice('read:'.length);
  return isOnboardingRead(id) ? id : null;
}

/**
 * The first-run sequence's server half: her words, read from the database and
 * rendered here, handed to the client stepper as finished markup.
 *
 * Rendered on the server so the documents never ship as data and the
 * Initiation paints with the name in it on first load, as the welcome email
 * does. Only the beats still `pending` are loaded.
 *
 * The name goes through `firstNameFrom`, the rule the welcome email uses: a
 * blank name, or the platform's `'User'` stand-in, is no name, and
 * `applyFirstName` closes the sentence over the gap.
 *
 * If a document cannot be read (an unseeded database, a row that fails
 * validation), this logs and renders nothing, leaving the conversation. A
 * welcome that cannot be shown must not become an error page over the shell,
 * and nothing is recorded, so it is shown on a later entry.
 */
export async function FirstRunView({
  userId,
  pending,
  userName,
}: {
  userId: string;
  pending: readonly FirstRunBeat[];
  userName: string | null | undefined;
}) {
  const firstName = firstNameFrom(userName);

  let steps: FirstRunStep[];
  try {
    steps = await Promise.all(
      pending.map(async (beat): Promise<FirstRunStep> => {
        const readId = readIdOf(beat);
        if (readId === null) {
          const initiation = await requireDocument(INITIATION_DOCUMENT);
          return {
            beat: 'initiation',
            body: <AuthoredDocument document={initiation} firstName={firstName} />,
          };
        }
        const doc = await requireDocument(readId);
        return {
          beat: `read:${readId}`,
          eyebrow: CATEGORY_LABEL[doc.category],
          title: doc.title,
          subtitle: doc.subtitle,
          body: (
            <AuthoredBlocks
              blocks={doc.blocks}
              renderStyle={doc.renderStyle}
              firstName={firstName}
              baseLevel={2}
            />
          ),
        };
      })
    );
  } catch (error) {
    logger.error('First-run sequence could not be loaded', error, { pending });
    return null;
  }

  return <FirstRun userId={userId} steps={steps} />;
}
