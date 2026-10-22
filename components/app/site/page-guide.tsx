import {
  InlineText,
  applyFirstName,
  headingAnchors,
} from '@/components/app/content/authored-document';
import { LotusMark } from '@/components/app/ui/lotus-mark';
import type { FoundationalDocumentDetail } from '@/lib/app/content/document-view';
import { cn } from '@/lib/utils';
import styles from '@/components/app/site/page-guide.module.css';

export interface PageGuideItem {
  href: string;
  /** Authored text — rendered through `InlineText`, never stripped by hand. */
  label: string;
  /** The document's own section number, where it numbers them. */
  number?: number;
}

/**
 * A document's top-level headings as guide items, linking to the ids
 * `AuthoredDocument` gives them with `anchors` — both from `headingAnchors`,
 * so a repeated heading's link lands on the right one. The label is the
 * heading's authored text, merge field closed as for an anonymous reader, and
 * `PageGuide` renders it through `InlineText` as the heading itself is.
 */
export function guideItems(blocks: FoundationalDocumentDetail['blocks']): PageGuideItem[] {
  const anchors = headingAnchors(blocks);
  return blocks.flatMap((block, index) =>
    block.type === 'heading' && block.level === 2
      ? [
          {
            href: `#${anchors[index]}`,
            label: applyFirstName(block.text, null),
            number: block.number,
          },
        ]
      : []
  );
}

/**
 * "On this page" — the sections of a long public page, held in view beside it
 * on a desktop (t-171). Every label is the section's own title: on `/lelanea`
 * the three documents', on `/disclaimer` and `/terms` the documents' headings,
 * so the list cannot drift from what it points at.
 *
 * Hidden below the desktop width by the page's layout, where the page is one
 * column and a contents list would only push the text down.
 */
export function PageGuide({ items, className }: { items: PageGuideItem[]; className?: string }) {
  return (
    <nav className={cn(styles.guide, className)} aria-label="On this page">
      {/* Decorative: the brand's mark, not a link and not a heading. */}
      <LotusMark size={40} water={false} />
      <p className="brand-eyebrow text-muted-foreground">on this page</p>
      <ol>
        {items.map((item, index) => (
          <li key={item.href}>
            <a href={item.href}>
              <span className={styles.number} aria-hidden="true">
                {String(item.number ?? index + 1).padStart(2, '0')}
              </span>
              <span>
                <InlineText text={item.label} />
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
