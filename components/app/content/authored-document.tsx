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

/**
 * The heading tags an authored level can become — indexed by `level - 2`.
 *
 * A lookup rather than `` `h${level}` as 'h2' | … ``: the element type then comes
 * from the data instead of from an assertion, and there is nothing to keep in
 * step with the clamp if the range ever moves.
 */
const HEADING_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * Where in the page's outline a document's own headings start.
 *
 * A page rendering ONE document lets its title be the `h1` and leaves this at
 * 2. A page hosting several — `/lelanea` carries the philosophy, the creator
 * and the lineage — gives each document an `h2` of its own and passes 3, so the
 * outline nests instead of emitting three sibling `h2` runs that read as one
 * flat document.
 */
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

/** The four registers of §6.3 are classes, not Tailwind tokens — see app/brand-theme.css. */
const HEADING_TYPE = 'brand-display text-[var(--color-heading)]';

/**
 * Category eyebrow copy. Lowercase because §6.10 allows it and the prototype
 * sets every eyebrow that way; the `.brand-eyebrow` class supplies the tracking
 * and deliberately does not force casing.
 *
 * Exported because the designed pages label their opening section the same way
 * and must not disagree with the document header on what a category is called.
 * The prototype's own eyebrows — "the heart behind lelañea", "the mission" —
 * could not be kept: each document is titled after the section it fills, so the
 * prototype's label and the authored title say the same words twice in two
 * sizes. The category is the one label that adds something.
 */
export const CATEGORY_LABEL: Record<FoundationalDocumentDetail['category'], string> = {
  onboarding: 'welcome',
  about: 'about lelañea',
  legal: 'important disclosures',
};

/**
 * `**bold**`, and only that.
 *
 * `[^*]` rather than `.` for the body is doing two jobs. It keeps three spans in
 * one sentence as three spans — the quantifier is greedy, so a `.` body would
 * run from the first `**` to the last. And it means an odd number of markers
 * degrades to literal asterisks rather than swallowing the rest of the
 * paragraph.
 *
 * `[^*]+` requires a character, so `****` is not a match and renders as four
 * literal asterisks. Nothing authors that today, and the suite's
 * "no markers visible" case would fail on it rather than let it through
 * silently, which is the outcome we want from content that has gone wrong.
 */
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;

/**
 * Unresolved merge fields, from the loader's own definition so the two cannot
 * drift — a placeholder the loader reports but the renderer does not mark would
 * ship to a reader as literal `[Support Email]`.
 *
 * Built as a **separate instance** rather than used directly. Not because
 * sharing would break `findPlaceholders()` — that calls `String.match`, which
 * ignores `lastIndex` and resets it — but because a `/g` regex is mutable
 * state, and two modules driving one with `exec` is a coupling neither can see.
 * The copy costs one object at module load and makes the isolation structural
 * rather than a property of how the other caller currently happens to scan.
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
 * would lose its capital and keep a leading space). No such line exists, and
 * `authored-document.test.tsx` pins the number of merge-field OCCURRENCES at
 * two so a third cannot land unnoticed — `placeholders.test.ts` cannot do that
 * job, because it pins the set of distinct placeholder strings and a third
 * occurrence of an existing one leaves that set unchanged.
 */
export function applyFirstName(text: string, firstName: string | null | undefined): string {
  if (!text.includes('{{first_name}}')) return text;

  // Trimmed, because a profile field that holds only whitespace is a missing
  // name, not a name — and substituting it would render "Welcome,  ."
  const name = firstName?.trim();

  // `split`/`join`, NOT `replaceAll(field, name)`: a string replacement is
  // interpreted, and `$&`, `` $` ``, `$'` and `$$` are meaningful in it. The
  // name is reader-supplied, so a profile reading `A$&B` would re-emit a literal
  // `{{first_name}}` into the sentence — the exact failure this file exists to
  // prevent — and `$'` would duplicate the rest of her clause.
  if (name) return text.split('{{first_name}}').join(name);

  // Scoped to the removed span, with no global whitespace collapse or trim
  // afterwards. An earlier version cleaned the whole string, which meant an
  // anonymous reader and a named one saw different whitespace in the SAME
  // authored block — and both merge fields sit in `the_initiation`, the one
  // document whose `renderStyle: "cadence"` makes whitespace load-bearing.
  // Removing exactly `, {{first_name}}` and `, {{first_name}},` already yields
  // "Welcome." and "You are far more…" without touching anything else.
  //
  // `[^\S\n]` is horizontal whitespace: every space character EXCEPT a line
  // break. Not `\s`, which would cross a newline and reflow the cadence
  // document; not `[ \t]`, which would miss a non-breaking or ideographic space
  // and leave the comma before it stranded. The remaining gap is a field
  // separated from its comma by a LINE BREAK — `"Welcome,\n{{first_name}}."`
  // keeps the comma — because removing the break is the worse error here. No
  // authored block contains a newline at all; the test suite pins what this
  // does rather than leaving it to be discovered.
  //
  // `g`, because a single block could carry the field twice — without it the
  // second occurrence ships to an anonymous reader as raw `{{first_name}}`.
  return text.replace(/,?[^\S\n]*\{\{first_name\}\},?/g, '');
}

/**
 * Splits one authored string into text, bold and unresolved-placeholder runs.
 *
 * Bold is found first and placeholders within each run second, so a placeholder
 * inside a bold span keeps its emphasis instead of falling out of it.
 *
 * That precedence has a consequence worth naming: a placeholder whose brackets
 * STRADDLE a bold boundary (`[Support **Email**]`) is not detected, because
 * neither run contains a complete `[…]`. It would then ship unmarked. Nothing
 * authors that today — both unfilled placeholders sit wholly outside any bold
 * span — and there is no ordering that handles both nestings, since the mirror
 * case (`**a [b** c]**`) breaks whichever pattern runs second. Bold-first is the
 * choice; `authored-document.test.tsx` pins what the other case does.
 */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];

  const pushRun = (run: string, bold: boolean): void => {
    if (run.length === 0) return;

    // Belt-and-braces, not a live fix: both loops below drain to `null`, and
    // `exec` zeroes `lastIndex` when it returns `null`, so neither can currently
    // be entered stale. The reset makes that a local property instead of one
    // that depends on nobody ever adding a `break`.
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
 * Exported for a page that renders authored strings OUTSIDE a block — `/data`
 * sets the seven "Lelañea is **not** a…" lines as list rows with an icon
 * beside each, a shape no block type produces. Reaching for
 * `text.replaceAll('**', '')` there was the first version and it is the bug
 * this export exists to prevent: it strips the emphasis the author put on the
 * word "not", on the page whose entire job is that word, and it leaves an
 * unresolved placeholder unmarked. Anything rendering an authored string comes
 * through here.
 *
 * An unresolved placeholder is marked outside production and plain inside it.
 * The marking is a build-time aid — `[Month Day, Year]` and `[Support Email]`
 * are launch blockers (`.context/app/content.md`), and a highlight is how they
 * stay visible to whoever is looking at the page. In production the words are
 * the words: a reader is shown the copy, not our editorial state.
 */
export function InlineText({ text }: { text: string }): React.ReactNode {
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
  // two adjacent `<strong>` elements where the author wrote one emphasis —
  // identical on screen, wrong in the markup. No authored string does this yet
  // (the Terms of Use writes `**Effective Date:** [Month Day, Year]`, with the
  // placeholder OUTSIDE the emphasis), so the case is covered synthetically.
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
  baseLevel,
}: {
  block: FoundationalDocumentDetail['blocks'][number];
  cadence: boolean;
  firstName: string | null | undefined;
  baseLevel: HeadingLevel;
}): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      // Clamped to `baseLevel` at the top because nothing inside a document may
      // outrank the heading the page gave it, and to h6 at the bottom because
      // there is no h7. Neither bound has an input in the authored files today
      // (every heading is level 2); the clamp is here so a deeper outline
      // degrades instead of emitting invalid markup or jumping the outline.
      //
      // `block.level - 2` is the depth WITHIN the document, since 2 is the
      // shallowest level the authored files use. Adding `baseLevel` re-roots
      // that depth wherever the page has placed the document: at the default
      // of 2 this is the identity, and at 3 a document's own `h2`s become
      // `h3`s beneath the page's `h2`.
      const Heading =
        HEADING_TAGS[Math.min(6, Math.max(baseLevel, baseLevel + block.level - 2)) - 2];

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

/**
 * The block list itself, with no element of its own.
 *
 * A fragment rather than a wrapper, and that is not a detail: `AuthoredDocument`
 * renders these as direct children of its `<article>`, and an intervening
 * `<div>` would change the DOM shape of every page and test that already
 * depends on it. The two public components differ only in what they wrap this
 * in — nothing, and a `<div>` carrying the page's measure.
 */
function BlockList({
  blocks,
  cadence,
  firstName,
  baseLevel,
}: {
  blocks: FoundationalDocumentDetail['blocks'];
  cadence: boolean;
  firstName: string | null | undefined;
  baseLevel: HeadingLevel;
}): React.ReactNode {
  return (
    <>
      {blocks.map((block, index) => (
        <AuthoredBlock
          key={index}
          block={block}
          cadence={cadence}
          firstName={firstName}
          baseLevel={baseLevel}
        />
      ))}
    </>
  );
}

export interface AuthoredBlocksProps {
  /**
   * The blocks to render — a whole document's, or one section of it from
   * `selectSection()`. Blocks rather than a document, because a page section is
   * a slice and there is no such thing as a partial document.
   */
  blocks: FoundationalDocumentDetail['blocks'];
  /**
   * `'cadence'` documents keep their line breaks. Pass the document's own
   * `renderStyle`; it is not a caller's preference (see `AuthoredBlock`).
   */
  renderStyle?: string | null;
  /** The reader's first name for `{{first_name}}` — decision D7. */
  firstName?: string | null;
  /** Where the document's own headings sit in the page outline. Default 2. */
  baseLevel?: HeadingLevel;
  className?: string;
}

/**
 * Authored blocks, with no document header around them.
 *
 * The half of `AuthoredDocument` that a designed page wants. `/data` renders
 * three sections of the disclaimer under the site's own chrome, and `/lelanea`
 * renders three whole documents as sections of one page — neither can use the
 * document header, because it carries an `h1` and a page has one of those.
 *
 * Every consideration in this file still applies: no HTML parser, `**bold**`
 * and nothing else, placeholders marked outside production, and the frozen
 * document only ever read.
 */
export function AuthoredBlocks({
  blocks,
  renderStyle = null,
  firstName = null,
  baseLevel = 2,
  className,
}: AuthoredBlocksProps): React.ReactNode {
  return (
    <div className={className}>
      <BlockList
        blocks={blocks}
        cadence={renderStyle === 'cadence'}
        firstName={firstName}
        baseLevel={baseLevel}
      />
    </div>
  );
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
  return (
    <article className={cn('text-foreground', className)}>
      <header className="mb-8">
        <p className="brand-eyebrow text-muted-foreground mb-2">{CATEGORY_LABEL[doc.category]}</p>
        <h1 className={cn(HEADING_TYPE, 'text-4xl')}>{doc.title}</h1>
        {doc.subtitle === null ? null : (
          <p className="text-muted-foreground mt-2 text-lg">{doc.subtitle}</p>
        )}
      </header>

      <BlockList
        blocks={doc.blocks}
        cadence={doc.renderStyle === 'cadence'}
        firstName={firstName}
        baseLevel={2}
      />
    </article>
  );
}
