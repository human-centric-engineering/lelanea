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
 * ## And the second item, for the same reason
 *
 * §05 t-25 records what each uploaded document is FOR — quotable knowledge, or
 * voice-only material the agent may imitate but never quote. That designation is
 * written as tags and a note, and it decides what `search_knowledge_base` can
 * reach; an operator with no way to SEE it has no way to tell a document nobody
 * has designated (which reaches nothing) from one designated as knowledge (which
 * reaches everything). `/admin/app/knowledge` is that surface.
 *
 * **"Training material", not "Her material".** The label names what an operator
 * is looking at — the corpus the agent is trained on — rather than whose it is,
 * which the section heading above it already says.
 *
 * ## And the third, because a prose edit has no compiler

 * §05 t-28 runs a fixed set of questions through her assembled prompt AND
 * through a model carrying no fingerprint, so a change to her core can be heard
 * before it ships. Without a surface the two runs are rows in a table nobody
 * opens — `/admin/app/voice` is where they are read side by side.
 *
 * ## And the fourth, because a number that needs a deploy is the wrong shape
 *
 * §08 t-53 stores the agent's two deadlines and the monthly spending ceilings,
 * default and per person, as settings rather than constants — the owner's ruling
 * was that all of them be changeable as real use teaches what they should be.
 * `/admin/app/agent` is where.
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
 * Pinned in `tests/unit/lib/app/defaults.test.ts` — both here (one section, now
 * FOUR items, in this order) and on the `lib/app/admin-nav.ts` bridge, which
 * registers two sections rather than one (`HB2`: pin the new value, never delete
 * the row).
 */

import { AudioLines, ClipboardList, Gauge, LifeBuoy, Library } from 'lucide-react';
import { registerNavSection } from '@/lib/admin-nav/registry';
import { WAITLIST_ADMIN_PAGE } from '@/lib/app/waitlist/endpoint';
import { DESIGNATION_ADMIN_PAGE, VOICE_COMPARISON_PAGE } from '@/lib/app/voice/endpoint';
import { AGENT_SETTINGS_PAGE } from '@/lib/app/agent/endpoint';
import { CRISIS_RESOURCES_PAGE } from '@/lib/app/safety/endpoint';

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
      {
        href: DESIGNATION_ADMIN_PAGE,
        label: 'Training material',
        icon: Library,
        description: 'What each document is for, and whether the agent may quote it',
      },
      {
        href: VOICE_COMPARISON_PAGE,
        label: 'Voice',
        icon: AudioLines,
        description: 'The assembled voice against a bare model, over the same fixed questions',
      },
      {
        href: AGENT_SETTINGS_PAGE,
        label: 'Deadlines & budgets',
        icon: Gauge,
        description: 'How long the AI may take to answer, and what each person may spend a month',
      },
      {
        href: CRISIS_RESOURCES_PAGE,
        label: 'Crisis helplines',
        icon: LifeBuoy,
        description:
          'Who someone in danger is pointed to, by country, and whether it is signed off',
      },
    ],
  });
}
