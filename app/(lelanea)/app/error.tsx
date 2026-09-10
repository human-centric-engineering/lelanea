'use client';

/**
 * The shell's error boundary.
 *
 * Without one, an error thrown inside the shell escapes to `app/error.tsx` and
 * replaces the whole product with the platform's own frame — so a failure in a
 * single view looks like the app going down. `(protected)` and `(public)` each
 * carry one for the same reason; this route group needs its own because its
 * frame is different from both.
 *
 * `checkSession` matters more here than on the sibling groups: everything in
 * this group is behind the session, and an expired one surfaces as a render
 * error rather than a redirect once the page is already open.
 *
 * The fallback deliberately points at `/app` itself rather than at the landing
 * constant. They are the same route today, but the landing route is where a
 * fork sends people *after login* — if that ever moves, the way out of a broken
 * view should still be the shell's own root, not wherever login now lands.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error
 */

import { MessageCircle } from 'lucide-react';

import { RouteErrorBoundary } from '@/components/errors/route-error-boundary';

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <RouteErrorBoundary
      error={error}
      reset={reset}
      boundaryName="ShellError"
      tag="lelanea-shell"
      title="Something went wrong"
      description="An error occurred while loading this view. This has been logged."
      checkSession
      fallback={{
        label: 'The conversation',
        href: '/app',
        icon: <MessageCircle className="mr-2 h-4 w-4" />,
      }}
    />
  );
}
