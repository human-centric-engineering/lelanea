import { USAGE_LEDE, USAGE_NOTE, UsageSkeleton } from '@/components/app/usage/usage-panel';
import { View } from '@/components/app/views/view';

/**
 * Usage is the third view under `/app` that waits on anything — it reads the
 * session, which makes the route dynamic — so it is the third with a loading
 * boundary. The views that render from constants would show one for a frame
 * and then never again.
 *
 * ## The head is drawn as known
 *
 * Nothing in it depends on the session or on the figures: the eyebrow, the
 * title, the lede and the note are the same four the page renders, two of them
 * from the same exports. So there is nothing to withhold and nothing that can
 * drift — unlike `account/loading.tsx`, which draws a bar where its title goes
 * because that page titles itself with the name on the account.
 *
 * ## And the body is the panel's own skeleton
 *
 * A reader crosses two loading states back to back: this one while the session
 * is read, then the panel's while it fetches. `UsageSkeleton` is rendered by
 * both, so the second is not a different shape arriving where the first was.
 */
export default function UsageLoading() {
  return (
    <View column eyebrow="usage" title="What this month cost" lede={USAGE_LEDE} note={USAGE_NOTE}>
      <UsageSkeleton />
    </View>
  );
}
