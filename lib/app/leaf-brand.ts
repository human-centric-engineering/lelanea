/**
 * Leaf-app brand identity — Lelañea.
 *
 * **This is the leaf's brand seam, and the file Lelañea fills.** Daybreak ships
 * every value `null` here and sets its own identity in `lib/app/brand.ts`, the
 * bridge one tier up; Sunrise sets its own in `lib/brand.ts`, one tier above
 * that. A non-`null` value here wins over both.
 *
 * **Override, not append — this is the one seam that works that way.** Every
 * other `lib/app/*` bridge composes the tiers (the framework registers, then the
 * leaf registers, and both survive). Brand identity is single-valued: Lelañea
 * does not compose with "Daybreak", it replaces it. `lib/app/brand.ts` reads
 * these with `??` rather than `||`, so an empty string is a deliberate choice and
 * only `null` falls through.
 *
 * **Do not set these in `.env`.** They used to be `NEXT_PUBLIC_APP_NAME` /
 * `NEXT_PUBLIC_LEGAL_NAME` / `NEXT_PUBLIC_APP_DESCRIPTION`; Sunrise 0.11.0
 * removed them (Sunrise #661) because `NEXT_PUBLIC_*` is inlined at **build**
 * time and `.dockerignore` excludes `.env*` — so a container build delivered none
 * of them and shipped someone else's name in both footers regardless of what was
 * configured. Daybreak carried exactly that defect until its v0.11.0 sync. A boot
 * warning names any of the three left set.
 *
 * Read by `lib/app/brand.ts` → `lib/brand.ts`, which every brand-bearing surface
 * already imports: layout metadata, the header `<BrandMark>`, both footers, and
 * every transactional email template.
 *
 * Boundary-clean: no imports, so this stays inside the framework-agnostic
 * `lib/app/**` boundary.
 *
 * Values set here are pinned in the `lib/app/leaf-brand.ts` row of
 * `tests/unit/lib/app/defaults.test.ts` — change that row, never delete it, so
 * the seams still left empty keep their protection.
 *
 * @see lib/app/brand.ts · lib/brand.ts · .context/framework/building-on-daybreak.md
 */

/**
 * Product name — page titles, header/footer brand, emails.
 *
 * The `ñ` is intentional and is the real name. It lives here rather than in the
 * repository or package name, which stay ASCII (`lelanea`) because those end up
 * in URLs, container names, database identifiers and shell paths. This constant
 * is the only place the product is *named* for a human reader, so it is the one
 * place the accent belongs.
 */
export const leafBrandName: string | null = 'Lelañea';

/**
 * Copyright holder, which differs from the product here: the product is
 * "Lelañea", the legal entity behind it is All Too Human Ltd. This is a
 * legal-attribution surface (both footers' copyright line), not a cosmetic one.
 */
export const leafBrandLegalName: string | null = 'All Too Human Ltd';

/**
 * Root `<meta name="description">`, used by any page that sets none of its own —
 * in practice `app/not-found.tsx` and the root error pages, which is precisely
 * where nobody thinks to look. Deliberately short and plain: a wrong sentence is
 * worse than a spare one (Sunrise #519).
 */
export const leafBrandDescription: string | null =
  'Lelañea — an application built on the Daybreak framework.';
