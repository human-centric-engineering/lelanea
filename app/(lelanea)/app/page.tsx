import type { Metadata } from 'next';

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
 * The shell's clean view — and it renders nothing, on purpose.
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
 */
export default function ShellHomePage() {
  return null;
}
