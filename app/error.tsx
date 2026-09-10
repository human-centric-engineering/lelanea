'use client';

/**
 * Root Error Boundary
 *
 * Catches all unhandled errors in the application that aren't caught
 * by more specific error boundaries.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error
 */

import { Home } from 'lucide-react';
import { RouteErrorBoundary } from '@/components/errors/route-error-boundary';

export default function Error({
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
      boundaryName="RootError"
      tag="root"
      title="Something went wrong"
      description="An unexpected error occurred. This has been logged and we'll look into it."
      extra={{ componentStack: 'root' }}
      containerClassName="min-h-screen"
      fallback={{
        label: 'Go home',
        href: '/',
        navigate: 'reload',
        icon: <Home className="mr-2 h-4 w-4" />,
      }}
      // LELAÑEA divergence (t-5): the production footer offered "contact
      // support", linking to `/contact`. That page was Sunrise's placeholder
      // and is gone — the design has no contact route, and pre-launch there is
      // no support channel to point at, only the waitlist. D3's ruling for this
      // feature is nothing rather than a dead link, and it applies to an
      // internal 404 exactly as it does to an outbound one. Restore the footer
      // with a real destination when one exists.
    />
  );
}
