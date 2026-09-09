import { Fragment } from 'react';

import { PLACEHOLDER_PATTERN, type FoundationalDocumentDetail } from '@/lib/app/content';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

/**
 * Renders one foundational document exactly as it was authored.
 *
 * The product description is explicit that Lelañea Fulton's writing is never
 * paraphrased, and that "where the source copy uses a single-sentence-per-line
 * cadence, that is deliberate and must not be reflowed into prose" (§1). This
 * component is the single place that turns an authored block list into markup,
 * so no page re-implements block handling and drifts from another page's idea
 * of what a document looks like.
 *
 * WHAT IT IS NOT. It is not a markdown renderer and must not become one. The
 * authored files declare `textFormat: "markdown-inline"` and use exactly one
 * inline construct — `**bold**` — with block structure carried as data. So the
 * inline pass here recognises `**bold**` and nothing else, and every piece of
 * text reaches the DOM as a React child. There is no `dangerouslySetInnerHTML`
 * and no HTML parser anywhere in this path: authored prose is trusted, but
 * "trusted today" is a poor reason to build a hole that a database-backed
 * authoring surface would later widen (see `.context/app/content.md`,
 * "Storage").
 *
 * WHY SUBSTITUTION HAPPENS HERE AND NOT IN THE LOADER. `lib/app/content` parses
 * each file once, memoises it and deep-freezes the result, precisely so that a
 * per-reader edit cannot leak into every other reader. `{{first_name}}` is a
 * per-reader edit. It is applied to a copy, at render time, and the frozen
 * document is only ever read.
 *
 * @see lib/app/content/index.ts — the loader that validates and serves these
 * @see .context/app/content.md — block types, placeholders, decisions A2/A3/D7
 */

/** The four registers of §6.3 are classes, not Tailwind tokens — see app/brand-theme.css. */
const HEADING_TYPE = 'brand-display text-[var(--color-heading)]';

/**
 * Category eyebrow copy. Lowercase because §6.10 allows it and the prototype
 * sets every eyebrow that way; the `.brand-eyebrow` class supplies the tracking
 * and deliberately does not force casing.
 */
const CATEGORY_LABEL: Record<FoundationalDocumentDetail['category'], string> = {
  onboarding: 'welcome',
  about: 'about lelañea',
  legal: 'important disclosures',
};

/**
 * `**bold**`, non-greedy so three spans in one sentence stay three spans.
 *
 * `[^*]` rather than `.` for the body: it cannot run past the closing `**`, so
 * an odd number of markers degrades to literal asterisks rather than swallowing
 * the rest of the paragraph.
 */
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;

/**
 * Unresolved merge fields, from the loader's own definition so the two cannot
 * drift — a placeholder the loader reports but the renderer does not mark would
 * ship to a reader as literal `[Support Email]`.
 *
 * Built as a **separate instance** rather than used directly: a `/g` regex
 * carries `lastIndex` between calls, and sharing one with `findPlaceholders()`
 * would make each function's result depend on who scanned last.
 */
const PLACEHOLDER_SCANNER = new RegExp(PLACEHOLDER_PATTERN.source, 'g');

/** One run of text, with whatever the inline pass decided about it. */
interface InlineToken {
  text: string;
  bold: boolean;
  /** A merge field nobody substituted — `[Month Day, Year]`, `[Support Email]`. */
  placeholder: boolean;
}

/**
 * Applies decision D7: `{{first_name}}` takes the reader's name, or the
 * sentence closes over the gap.
 *
 * D7 is written for the opening line — "falls back to 'Welcome.' with the comma
 * dropped" — but `the_initiation` uses the merge field twice, and the second is
 * a vocative bracketed by *two* commas:
 *
 *     "Welcome, {{first_name}}."               → "Welcome."
 *     "You, {{first_name}}, are far more…"     → "You are far more…"
 *
 * Dropping only the leading comma would leave "You, are far more…". So the rule
 * is: take the comma before the field, the field, and a comma directly after it.
 * That covers both authored sites and any vocative shaped like them.
 *
 * It does **not** cover a field that opens a sentence (`"{{first_name}}, welcome."`
 * would lose its capital). No such line exists, and one would show up in
 * `tests/unit/lib/app/content/placeholders.test.ts`, which pins the merge-field
 * set — introducing a third site means revisiting this function.
 */
export function applyFirstName(text: string, firstName: string | null | undefined): string {
  if (!text.includes('{{first_name}}')) return text;

  // Trimmed, because a profile field that holds only whitespace is a missing
  // name, not a name — and substituting it would render "Welcome,  ."
  const name = firstName?.trim();
  if (name) return text.replaceAll('{{first_name}}', name);

  return text
    .replace(/,?\s*\{\{first_name\}\},?/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Splits one authored string into text, bold and unresolved-placeholder runs.
 *
 * Bold is found first and placeholders within each run second, so a placeholder
 * inside a bold span keeps its emphasis instead of falling out of it.
 */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];

  const pushRun = (run: string, bold: boolean): void => {
    if (run.length === 0) return;

    PLACEHOLDER_SCANNER.lastIndex = 0;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = PLACEHOLDER_SCANNER.exec(run)) !== null) {
      if (match.index > cursor) {
        tokens.push({ text: run.slice(cursor, match.index), bold, placeholder: false });
      }
      tokens.push({ text: match[0], bold, placeholder: true });
      cursor = match.index + match[0].length;
    }

    if (cursor < run.length) {
      tokens.push({ text: run.slice(cursor), bold, placeholder: false });
    }
  };

  BOLD_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = BOLD_PATTERN.exec(text)) !== null) {
    pushRun(text.slice(cursor, match.index), false);
    pushRun(match[1], true);
    cursor = match.index + match[0].length;
  }
  pushRun(text.slice(cursor), false);

  return tokens;
}

/** Consecutive tokens that share an emphasis, so one `<strong>` covers one span. */
function groupByEmphasis(tokens: InlineToken[]): { bold: boolean; tokens: InlineToken[] }[] {
  const groups: { bold: boolean; tokens: InlineToken[] }[] = [];

  for (const token of tokens) {
    const last = groups.at(-1);
    if (last !== undefined && last.bold === token.bold) {
      last.tokens.push(token);
    } else {
      groups.push({ bold: token.bold, tokens: [token] });
    }
  }

  return groups;
}

/**
 * Authored text as React children.
 *
 * An unresolved placeholder is marked outside production and plain inside it.
 * The marking is a build-time aid — `[Month Day, Year]` and `[Support Email]`
 * are launch blockers (`.context/app/content.md`), and a highlight is how they
 * stay visible to whoever is looking at the page. In production the words are
 * the words: a reader is shown the copy, not our editorial state.
 */
function InlineText({ text }: { text: string }): React.ReactNode {
  const marked = env.NODE_ENV !== 'production';

  const renderToken = (token: InlineToken, index: number): React.ReactNode =>
    token.placeholder && marked ? (
      <span
        key={index}
        data-unresolved-placeholder={token.text}
        title="Unresolved placeholder — this must be filled before publication"
        className="rounded-sm bg-amber-200 px-1 text-amber-950 dark:bg-amber-300/80"
      >
        {token.text}
      </span>
    ) : (
      <Fragment key={index}>{token.text}</Fragment>
    );

  // Contiguous bold tokens share one `<strong>`. A placeholder inside a bold
  // span splits the run in two, and wrapping each half separately would emit
  // `<strong>Effective: </strong><strong>[…]</strong>` — identical on screen,
  // but two elements where the author wrote one emphasis.
  const groups = groupByEmphasis(tokenizeInline(text));

  return (
    <>
      {groups.map((group, index) =>
        group.bold ? (
          <strong key={index}>{group.tokens.map(renderToken)}</strong>
        ) : (
          <Fragment key={index}>{group.tokens.map(renderToken)}</Fragment>
        )
      )}
    </>
  );
}

/**
 * One authored block.
 *
 * `cadence` is the document's own `renderStyle`, not a caller's preference: the
 * welcome statement carries `renderStyle: "cadence"` and a `renderNote` saying
 * "render each as its own line or beat; do not merge them into flowing prose".
 * Each paragraph is already its own element, which is most of that promise;
 * `whitespace-pre-line` keeps the rest of it if a beat is ever authored with a
 * line break inside one block.
 */
function AuthoredBlock({
  block,
  cadence,
  firstName,
}: {
  block: FoundationalDocumentDetail['blocks'][number];
  cadence: boolean;
  firstName: string | null | undefined;
}): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      // Clamped to h2 at the top because the document title is the page's only
      // h1, and to h6 at the bottom because there is no h7. Neither bound has
      // an input in the authored files today (every heading is level 2); the
      // clamp is here so a deeper outline degrades instead of emitting invalid
      // markup or a second h1.
      const level = Math.min(6, Math.max(2, block.level));
      const Heading = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

      return (
        <Heading className={cn(HEADING_TYPE, 'mt-10 mb-3 text-2xl first:mt-0')}>
          {block.number === undefined ? null : (
            <span className="text-muted-foreground tabular-nums">{`${block.number}. `}</span>
          )}
          <InlineText text={applyFirstName(block.text, firstName)} />
        </Heading>
      );
    }

    case 'paragraph':
      return (
        <p className={cn('mb-4 leading-relaxed', cadence && 'whitespace-pre-line')}>
          <InlineText text={applyFirstName(block.text, firstName)} />
        </p>
      );

    case 'list':
      return (
        <ul className="mb-4 list-disc space-y-1 pl-6 leading-relaxed">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineText text={applyFirstName(item, firstName)} />
            </li>
          ))}
        </ul>
      );
  }
}

export interface AuthoredDocumentProps {
  /** A document from `getFoundationalDocument()` — blocks in authored order. */
  document: FoundationalDocumentDetail;
  /**
   * The reader's first name for `{{first_name}}`. Omit it, or pass null, and
   * the sentence closes over the gap per decision D7.
   */
  firstName?: string | null;
  className?: string;
}

/**
 * A foundational document, block for block, in the order it was written.
 *
 * A server component: it renders authored text and reads nothing per-request
 * beyond the props, so there is no reason to ship any of it to the browser.
 */
export function AuthoredDocument({
  document: doc,
  firstName = null,
  className,
}: AuthoredDocumentProps): React.ReactNode {
  const cadence = doc.renderStyle === 'cadence';

  return (
    <article className={cn('text-foreground', className)}>
      <header className="mb-8">
        <p className="brand-eyebrow text-muted-foreground mb-2">{CATEGORY_LABEL[doc.category]}</p>
        <h1 className={cn(HEADING_TYPE, 'text-4xl')}>{doc.title}</h1>
        {doc.subtitle === null ? null : (
          <p className="text-muted-foreground mt-2 text-lg">{doc.subtitle}</p>
        )}
      </header>

      {doc.blocks.map((block, index) => (
        <AuthoredBlock key={index} block={block} cadence={cadence} firstName={firstName} />
      ))}
    </article>
  );
}
