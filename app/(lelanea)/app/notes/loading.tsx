import { NOTES_LEDE, NOTES_NOTE, NotesSkeleton } from '@/components/app/notes/notes-panel';
import { View } from '@/components/app/views/view';

/**
 * Her notes is the second view under `/app` that waits on anything — it reads
 * the session, which makes the route dynamic — so it is the second with a
 * loading boundary. The others render from constants and would show this for a
 * frame and then never again.
 *
 * ## Everything in the head is drawn as known, unlike the account's
 *
 * `account/loading.tsx` draws a bar where its title goes, because that page
 * titles itself with the name on the account and a heading that says one thing
 * and then swaps to a person's name is the exact jolt a loading state exists to
 * prevent. Nothing here depends on the session: the eyebrow, the title, the
 * lede and the note are the same four constants the page renders, two of them
 * from the same exports, so there is nothing to withhold and nothing that can
 * drift.
 *
 * ## And the body is the panel's own skeleton, not a copy of it
 *
 * A reader crosses two loading states back to back here — this one while the
 * session is read, then the panel's while it fetches. `NotesSkeleton` is
 * rendered by both, so the second is not a different shape arriving where the
 * first was.
 */
export default function NotesLoading() {
  return (
    <View
      column
      eyebrow="lelañea’s notes"
      title="What Lelañea has written down about you"
      lede={NOTES_LEDE}
      note={NOTES_NOTE}
    >
      <NotesSkeleton />
    </View>
  );
}
