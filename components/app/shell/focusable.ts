/**
 * What Tab can land on, for the two focus traps in this shell.
 *
 * Shared rather than written twice, because the first version was written once
 * and then diverged the moment the second trap needed it — and an incomplete
 * selector fails in the one direction that matters: a control it does not list
 * is never `last`, so `active === last` never matches and Tab escapes the
 * `aria-modal` panel entirely.
 *
 * The panels are stubs today, holding a single close button. §05's map and
 * f-resources will put real controls in them — a `<select>` or a `<textarea>`
 * last in a panel is exactly the case the narrow selector would have missed.
 *
 * The `:not()` clauses matter as much as the list: an element inside an `inert`
 * or `hidden` subtree is not focusable, and treating it as `last` strands the
 * cycle on something the browser will not focus.
 */
export const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
]
  .map((s) => `${s}:not([inert] *):not([hidden]):not([aria-hidden="true"])`)
  .join(', ');
