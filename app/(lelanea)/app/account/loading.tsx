import { ACCOUNT_LEDE } from '@/components/app/views/account-view';
import { View } from '@/components/app/views/view';

/**
 * Account is the only view under `/app` that waits on anything — it reads the
 * session, which makes the route dynamic — so it is the only one with a loading
 * boundary. The others render from constants and would show this for a frame
 * and then never again.
 *
 * ## What is drawn as known, and what is not
 *
 * The eyebrow and the lede are the same strings the page renders — the lede
 * from the same constant, so the two cannot drift apart. The TITLE is not: the
 * page titles itself with the name on the account, falling back to the address,
 * which makes it the most session-dependent string on the view. A first pass
 * drew "Your account" under a comment claiming the title did not depend on the
 * session, so the heading said one thing and then swapped to a person's name —
 * the specific jolt a loading state exists to avoid.
 *
 * ## The bar is sized in `em`, and the heading still has a name
 *
 * `h-[1.08em]` rather than a pixel constant, because the `<h1>` is
 * `text-[29px] leading-[1.08]` and steps down to `text-2xl` below 900px: a
 * fixed 29px bar left the content shifting two pixels down at wide widths and
 * three UP at narrow ones, which is the jolt this is supposed to prevent.
 *
 * The `sr-only` label lives inside the `<h1>` because `View` always renders
 * one: a heading whose only child is an `aria-hidden` bar is an empty heading,
 * which is an axe violation and, more to the point, an unnamed landing place
 * for anyone navigating by heading.
 */
export default function AccountLoading() {
  return (
    <View
      eyebrow="your account"
      title={
        <>
          <span className="sr-only">Loading your account</span>
          <span
            className="block h-[1.08em] w-[min(260px,60%)] rounded-full bg-[var(--color-pill)]"
            aria-hidden="true"
          />
        </>
      }
      lede={ACCOUNT_LEDE}
    >
      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="h-[11px] w-[62%] rounded-full bg-[var(--color-pill)]" />
        <div className="h-[11px] w-[84%] rounded-full bg-[var(--color-pill)]" />
        <div className="h-[11px] w-[48%] rounded-full bg-[var(--color-pill)]" />
      </div>
    </View>
  );
}
