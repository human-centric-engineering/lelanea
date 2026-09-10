/**
 * App authenticated-nav override.
 *
 * **Fork-owned scaffold** — Sunrise ships this `null` (= use the platform
 * default) and does NOT change this file after release, so your edits here merge
 * cleanly on upgrade (the stable contract is this file's export, not its value).
 * Treat it like the landing page: a starting point you're expected to modify.
 *
 * This is the seam that stops an app's own product from being unreachable: the
 * header a signed-in user sees. Pair it with `lib/app/auth-landing.ts`, which
 * decides where they land after login, signup, invite acceptance or email
 * verification — a nav link with no matching landing route still leaves the
 * post-login page pointing at the stock dashboard.
 *
 * Forks OWN this list, so the model is *replacement*, not append: set it to a
 * non-null `ProtectedNavItem[]` and it **replaces** the platform default
 * wholesale (remove/rename/reorder freely). Leave it `null` to keep the default.
 * To add a link while keeping the platform ones, spread
 * `DEFAULT_PROTECTED_NAV` — see the note on it about what spreading pins.
 *
 * Auto-wired: `components/layouts/protected-nav.tsx` reads `protectedNavItems`.
 * The `next/link` / active-state / admin-filtering glue stays in that platform
 * component, so `adminOnly: true` keeps working on a fork's own items.
 *
 * Boundary-clean: a type-only import for the item shape plus `lucide-react`
 * icons, which is what `lib/protected-nav/types.ts` itself imports for
 * `DEFAULT_PROTECTED_NAV`. Neither is `next/*`, `react-dom`, Prisma or a Node
 * built-in, so this stays within the `lib/app/**` framework-agnostic boundary.
 *
 * Full guide: CUSTOMIZATION.md §4 · lib/protected-nav/types.ts
 */
import { Sparkles, Settings, Shield, User } from 'lucide-react';

import type { ProtectedNavItem } from '@/lib/protected-nav/types';

/**
 * Authenticated header nav. `null` = platform default; a non-null array replaces it.
 *
 * ## Why this is filled at all, when the shell has its own nav
 *
 * The shell at `/app` renders inside its own route group with its own layout, so
 * this header never appears there. It appears on `/profile` and `/settings`,
 * which keep the platform frame deliberately — and §04's account view links to
 * both of them.
 *
 * Left at `null` the header's first item is `DEFAULT_PROTECTED_NAV`'s
 * `Dashboard → /dashboard`, a page this product has abandoned. So a user who
 * followed the account view's own link to change their password arrived
 * somewhere with a one-click exit out of the product. That is the dead end
 * `lib/app/auth-landing.ts` warns about, reached from the other direction.
 *
 * The list is a REPLACEMENT, not an append: `/dashboard` is dropped rather than
 * hidden, `/profile` and `/settings` carry over unchanged, and `Admin` keeps its
 * `adminOnly` flag so the platform component still filters it by role. The cost
 * of replacing is that a link Sunrise adds later will not appear until this list
 * is revisited — accepted, because tracking the default is exactly what put
 * `/dashboard` here.
 */
export const protectedNavItems: ProtectedNavItem[] | null = [
  // "Lelañea", not "Your journey" — the same ruling as `auth-landing.ts`'s
  // label, and for the same reason: this item points at `/app`, while the
  // shell's own nav gives "Your journey" to `/app/journey`. One phrase, two
  // destinations, a click apart. Owner ruling, 10 September 2026.
  { href: '/app', label: 'Lelañea', icon: Sparkles },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/admin', label: 'Admin', icon: Shield, adminOnly: true },
];
