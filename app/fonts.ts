/**
 * Lelañea's three typefaces (leaf-owned).
 *
 * `next/font/google` self-hosts each family at build time and hands back a
 * `variable` class that declares one CSS custom property. `app/layout.tsx` puts
 * all three classes on `<html>`; `app/brand-theme.css` maps them onto the
 * Tailwind font tokens for the `consumer` surface ONLY, so `/admin` keeps the
 * platform's fonts even though the variables are declared on the same element.
 *
 * WHY THIS LIVES IN `app/` AND NOT `lib/app/`
 * The plan named `lib/app/fonts.ts`, but the platform's own ESLint boundary
 * (eslint.config.mjs, the `lib/app/**` block) bans runtime `next/*` imports
 * there and names the remedy: "Put framework glue in app/ or a
 * lib/app/<name>/server/ module." A font loader is framework glue by
 * definition — the Next compiler rewrites the call site — so `app/` is the
 * sanctioned home, beside the layout and the stylesheet that consume it.
 *
 * The three families and their registers are §6.3 of the product description;
 * the weights and styles match what the prototype loads from Google Fonts
 * (`.context/app/planning/design/lelanea.html`, the stylesheet link).
 *
 * `fallback` stacks mirror the prototype's own `font-family` declarations, so
 * the metric-adjusted fallback Next generates lands on the same substitute the
 * design was checked against.
 */
import { Cormorant_Garamond, Hanken_Grotesk, Instrument_Serif } from 'next/font/google';

/**
 * Display — hero moments, section headers, single-sentence prompts. Loaded with
 * both styles because the italic carries the ceremonial register (§6.3).
 */
export const brandDisplay = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand-display',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

/**
 * Body and UI. 400/500/600 only — §6.3 is explicit that nothing goes bolder
 * than 600.
 */
export const brandSans = Hanken_Grotesk({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand-sans',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
});

/**
 * Quote italic — pull quotes, session prompts, invocations. Italic only: this
 * face is never set upright in the product.
 */
export const brandQuote = Cormorant_Garamond({
  weight: ['400', '500'],
  style: 'italic',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand-quote',
  fallback: ['Georgia', 'serif'],
});

/**
 * The three `variable` classes, space-joined, for `<html className>`.
 *
 * Declaring the variables on `<html>` (rather than a route-group wrapper) is the
 * same reasoning as `data-surface` itself: body-portaled overlays mount outside
 * every route subtree and would otherwise render in the browser's default face.
 * See `.context/ui/surface-theming.md` constraint 1.
 */
export const brandFontVariables = [
  brandDisplay.variable,
  brandSans.variable,
  brandQuote.variable,
].join(' ');
