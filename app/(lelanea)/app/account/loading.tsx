import { View } from '@/components/app/views/view';

/**
 * Account is the only view under `/app` that waits on anything — it reads the
 * session, which makes the route dynamic — so it is the only one with a loading
 * boundary. The others render from constants and would show this for a frame
 * and then never again.
 *
 * ## What is drawn as known, and what is not
 *
 * The eyebrow and the lede are the same strings the page renders, so they are
 * shown as themselves. The TITLE is not: the page titles itself with the name
 * on the account, falling back to the address, which makes it the most
 * session-dependent string on the view. A first pass here drew "Your account"
 * under a comment claiming the title did not depend on the session — so the
 * heading said one thing and then swapped to a person's name, which is the
 * specific jolt a loading state exists to avoid.
 *
 * The lede is rendered for the same reason in reverse: leaving it out let the
 * skeleton bars sit a line higher than the content that replaced them.
 */
export default function AccountLoading() {
  return (
    <View
      eyebrow="your account"
      title={
        <span
          className="block h-[29px] w-[min(260px,60%)] rounded-full bg-[var(--color-pill)]"
          aria-hidden="true"
        />
      }
      lede="What Lelañea knows about you here, and where to change it."
    >
      <div className="flex flex-col gap-3" role="status" aria-live="polite">
        <span className="sr-only">Loading your account</span>
        <div className="h-[11px] w-[62%] rounded-full bg-[var(--color-pill)]" />
        <div className="h-[11px] w-[84%] rounded-full bg-[var(--color-pill)]" />
        <div className="h-[11px] w-[48%] rounded-full bg-[var(--color-pill)]" />
      </div>
    </View>
  );
}
