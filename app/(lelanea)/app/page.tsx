import type { Metadata } from 'next';

import { DiscoveryView } from '@/components/app/onboarding/discovery-view';
import { FirstRunView } from '@/components/app/onboarding/first-run-view';
import { getDiscoveryState } from '@/lib/app/onboarding/discovery-store';
import { pendingBeats } from '@/lib/app/onboarding/first-run';
import { getFirstRunProgress } from '@/lib/app/onboarding/first-run-store';
import { getServerSession } from '@/lib/auth/utils';

/**
 * "The conversation", matching the nav.
 *
 * A page that renders nothing still names itself: without this the layout's
 * `%s` template has nothing to fill and `/app` falls back to the bare brand,
 * while the other seven destinations each carry their own. That inconsistency
 * arrived by accident when this page stopped rendering — the title never
 * depended on there being markup.
 */
export const metadata: Metadata = { title: 'The conversation' };

/**
 * The shell's clean view — and it renders nothing, on purpose, once the
 * person's first run and discovery questions are behind them.
 *
 * `/app` is the conversation with no module beside it, and the conversation is
 * `ConversationPane`, which the layout renders for every route in this group.
 * So there is no second thing for this page to contribute: anything it returned
 * would appear *underneath* the pane that is already the whole view.
 *
 * The route still has to exist — it is where `auth-landing.ts` sends every
 * signed-in visitor, and it is what `wsOpen` tests against to decide whether the
 * workspace is open. A page returning `null` is the honest way to say "this
 * route's content lives in the frame", rather than duplicating the pane's own
 * copy here and letting the two drift.
 *
 * Every OTHER route in the group renders into the workspace surface, so t-11's
 * views arrive with somewhere to go without changing anything here.
 *
 * ## Until then, the first run (§3.9, t-103)
 *
 * A person who has not yet moved past the Initiation and each read meets them
 * here, first. `/app` is where every signed-in visitor lands, and on `/app`
 * `Panes` lays this page's output over the conversation as its own scroll
 * container: the welcome is the whole view, and when the last beat is behind
 * them it renders nothing and the conversation is what is left.
 *
 * What is still to come is read from the onboarding node's ledger on every
 * render, so a reload resumes where the person left off. A ledger that could
 * not be read renders nothing: see `first-run-store.ts`.
 *
 * ## Then the discovery questions (t-104)
 *
 * After the last read, the first sitting of the discovery questions, which the
 * person can leave at any question. On a later visit the next question is
 * offered rather than asked, and once every one is answered or skipped this
 * renders nothing. The questions are always in Onboarding's own area too
 * (`/app/modules/onboarding`). State that could not be read renders nothing,
 * as the ledger does.
 *
 * The session is read again rather than trusted from the layout, as the
 * account page does, because this renders the person's name.
 */
export default async function ShellHomePage() {
  const session = await getServerSession();
  if (!session) return null;

  const userId = session.user.id;
  const [progress, discovery] = await Promise.all([
    getFirstRunProgress(userId),
    getDiscoveryState(userId),
  ]);
  if (progress === null) return null;

  const questions =
    discovery === null ? null : <DiscoveryView userId={userId} state={discovery} where="app" />;

  const pending = pendingBeats(progress);
  if (pending.length === 0) return questions;

  return (
    <FirstRunView userId={userId} pending={pending} userName={session.user.name}>
      {questions}
    </FirstRunView>
  );
}
