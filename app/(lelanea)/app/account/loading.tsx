import { View } from '@/components/app/views/view';

/**
 * Account is the only view under `/app` that waits on anything — it reads the
 * session, which makes the route dynamic — so it is the only one with a loading
 * boundary. The others render from constants and would show this for a frame
 * and then never again.
 *
 * The head is the real one rather than a skeleton bar: the eyebrow and title do
 * not depend on the session, so drawing them as grey rectangles would be
 * pretending not to know something we know. Only the three facts underneath are
 * unknown, and only they are drawn as unknown.
 */
export default function AccountLoading() {
  return (
    <View eyebrow="your account" title="Your account">
      <div className="flex flex-col gap-3" role="status" aria-live="polite">
        <span className="sr-only">Loading your account</span>
        <div className="h-[11px] w-[62%] rounded-full bg-[var(--color-pill)]" />
        <div className="h-[11px] w-[84%] rounded-full bg-[var(--color-pill)]" />
        <div className="h-[11px] w-[48%] rounded-full bg-[var(--color-pill)]" />
      </div>
    </View>
  );
}
