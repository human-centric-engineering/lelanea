/**
 * Leaf-app admin-nav registration — Lelañea's own sidebar section.
 *
 * A leaf app (a fork of Daybreak) fills `initLeafAdminNav()` with its own
 * `registerNavSection()` calls to add admin sidebar sections — the client-nav
 * counterpart of the `lib/app/leaf-bootstrap.ts` boot hook. Daybreak ships it
 * empty: this is the leaf's nav seam, reserved so a leaf's sections merge
 * cleanly on upgrade.
 *
 * Called (synchronously) by `lib/app/admin-nav.ts`'s `initAppNav()` after the
 * framework section is registered. Keep it SYNC + client-safe — nav
 * registration is read during the sidebar's render, so it cannot be async (see
 * `lib/admin-nav/registry.ts`).
 *
 * ## Why this file is the one that makes the waitlist real
 *
 * §03 t-7 shipped the write — a visitor can join, and the row carries what they
 * said. Nothing read it back, and a row nobody can see is indistinguishable
 * from a row that was never written (`HB9`), including to whoever just wrote
 * it. The section below is the entry point to the surface that closes that:
 * `/admin/app/waitlist`, behind the admin layout's own role check.
 *
 * ## The section title is "Lelañea", and it is load-bearing
 *
 * The registry keys sections by `title` and dedupes on it, so the title must not
 * collide with a core section ("Overview", "Management", "AI Orchestration",
 * "System") or with Daybreak's ("Framework") — a collision yields two siblings
 * sharing a React key rather than one merged section. Ours is the product name
 * for the same reason the nav reads that way everywhere else: an operator
 * looking at this sidebar is reading three tiers at once, and the tier a link
 * belongs to is the first thing worth knowing.
 *
 * Pinned in `tests/unit/lib/app/defaults.test.ts` — both here and on the
 * `lib/app/admin-nav.ts` bridge, which now registers two sections rather than
 * one (`HB2`: pin the new value, never delete the row).
 */

import { ClipboardList } from 'lucide-react';
import { registerNavSection } from '@/lib/admin-nav/registry';
import { WAITLIST_ADMIN_PAGE } from '@/lib/app/waitlist/endpoint';

export function initLeafAdminNav(): void {
  registerNavSection({
    title: 'Lelañea',
    items: [
      {
        href: WAITLIST_ADMIN_PAGE,
        label: 'Waitlist',
        icon: ClipboardList,
        description: 'Who asked to be told when a place opens, and what they said',
      },
    ],
  });
}
