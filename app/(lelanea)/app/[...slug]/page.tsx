import { notFound } from 'next/navigation';

import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import { Eyebrow } from '@/components/app/ui/eyebrow';

/**
 * The placeholder every nav destination resolves to until t-11 builds it.
 *
 * ## Why this exists rather than letting them 404
 *
 * `shell-nav.tsx` ships seven destinations and an account link; only `/app`
 * had a page. The other six 404'd — and a 404 leaves the shell entirely, so a
 * click on "Your journey" replaced the whole frame with the platform's
 * not-found page and left the back button as the only way home.
 *
 * That is the same defect `shell-rail.tsx` refuses by shipping its buttons
 * `disabled`: a control that looks live, accepts the click, and does nothing
 * useful. The rail could answer it by being inert, but a nav item cannot —
 * an unclickable nav is not a nav. So the honest option here is `B31`'s
 * middle one: a real destination that says plainly it is not built yet, inside
 * the frame, with every other destination still one click away.
 *
 * ## Why a catch-all, and why it disappears on its own
 *
 * A real route beats a catch-all in App Router, so each page t-11 adds simply
 * takes over its own path with no change here. `[...slug]` rather than
 * `[[...slug]]`: the optional form would also match `/app` and collide with
 * `page.tsx`.
 *
 * It answers ONLY the paths the nav actually offers. Anything else is a genuine
 * 404 — a catch-all that swallowed every URL under `/app` would turn every typo
 * and every stale link into a page that looks deliberate.
 */
export default async function ShellPlaceholderPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const pathname = `/app/${slug.join('/')}`;

  const destination = SHELL_NAV.filter(isNavItem).find((item) => item.href === pathname);
  // The account footer is a destination too, and it is not in `SHELL_NAV`.
  const title = destination?.label ?? (pathname === '/app/account' ? 'Your account' : null);
  const hint = destination?.hint ?? (pathname === '/app/account' ? 'Who you are here' : null);

  if (title === null) notFound();

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <Eyebrow className="mb-3 block">{title}</Eyebrow>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {hint}. This part of Lelañea is still being built.
        </p>
      </div>
    </main>
  );
}
