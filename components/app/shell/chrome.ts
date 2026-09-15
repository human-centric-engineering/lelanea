/**
 * The shell's own chrome constants — the shapes that have to agree across four
 * files, kept in one so they cannot drift apart again.
 *
 * This exists because they did. Every icon-only control, every nav item and
 * every rail button draws the same thing — a highlight behind a glyph — and
 * each one carried its own radius: `rounded-xl` here, `rounded-[10px]` there,
 * `rounded-[14px]` in the footer. Individually each looked deliberate; together
 * they read as a shell that could not decide, which is what the owner saw.
 */

/**
 * The radius every icon highlight takes — **5px, set by the owner's eye**.
 *
 * Well inside the design's own `12px`, and the gap is the point rather than a
 * rounding error. Carried across a column of glyphs, a 12px corner reads as a
 * row of pills; two passes at this each landed short (12 → 10 → 8) and were
 * each still too soft looking at the real thing. 5px is the value the owner
 * asked for, and it is what a highlight wants when it is a key behind an icon
 * rather than a badge around one.
 *
 * ONE constant, not one per size. The footer's wider keys briefly had a second
 * value a step out, which is how the four radii this replaced got started.
 *
 * It does NOT apply to the two things in this shell that are genuinely round
 * rather than highlighted — the account avatar and the composer's filled send
 * disc. A disc is the thing itself; a highlight is chrome drawn behind
 * something else, and only the second is what this names.
 */
export const ICON_RADIUS = 'rounded-[5px]';
