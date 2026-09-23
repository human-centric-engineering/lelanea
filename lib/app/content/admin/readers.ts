/**
 * Who reads each piece of content (f-content-seeds t-91).
 *
 * The admin names these before a removal is confirmed, and refuses one where a
 * surface would break. A surface that selects a document or a section by a
 * name written in code cannot be told it is gone: it throws at render
 * (`requireDocument`, `MissingSectionError`), so what code selects by is
 * guarded here rather than warned about.
 *
 * **Kept honest by tests, not by memory.**
 * `tests/unit/lib/app/content/admin/readers.test.ts` scans `app/` and
 * `components/` for every document id passed to `requireDocument` and fails
 * on one not listed here, and checks every section key the seed writes has an
 * entry. A reader added in code without a line here is a test failure, not a
 * silent loss of the guard.
 *
 * No database, no server imports: the editor's client components read these
 * to say, beside the button, why a delete is not offered.
 */

/** The public content API, which a native client reads as well as the web. */
export const PUBLIC_DOCUMENTS_API = 'the public content API (/api/v1/app/content/documents)';

/**
 * The surfaces that render each foundational document by id. Every one of the
 * seven is here, so none of them can be deleted, only edited.
 */
export const DOCUMENT_READERS: Readonly<Record<string, readonly string[]>> = {
  the_initiation: [
    'the home page (/)',
    'the welcome email',
    'the waitlist confirmation email',
    PUBLIC_DOCUMENTS_API,
  ],
  the_heart_behind_lelanea: [
    'the home page (/)',
    'the Lelañea page (/lelanea)',
    PUBLIC_DOCUMENTS_API,
  ],
  the_mission: ['the mission page (/mission)', PUBLIC_DOCUMENTS_API],
  about_the_creator: ['the Lelañea page (/lelanea)', PUBLIC_DOCUMENTS_API],
  the_lineage_of_lelanea: ['the Lelañea page (/lelanea)', PUBLIC_DOCUMENTS_API],
  disclaimer: [
    'the acknowledgement gate (/app/begin)',
    'the disclaimer page (/disclaimer)',
    'the data page (/data)',
    'the home page (/)',
    PUBLIC_DOCUMENTS_API,
  ],
  terms_of_use: [
    'the acknowledgement gate (/app/begin)',
    'the terms page (/terms)',
    PUBLIC_DOCUMENTS_API,
  ],
};

/** One section key a surface selects by. */
export interface SectionReader {
  document: string;
  section: string;
  readers: readonly string[];
  /** The surface reads the section's heading too, so it must keep one. */
  needsHeading?: boolean;
}

/**
 * Every section key code selects by. Removing or renaming one of these breaks
 * the named surface at render, so the editor refuses both and says which file
 * would have to change with it. A key nothing here names is free to edit.
 */
export const SECTION_READERS: readonly SectionReader[] = [
  { document: 'the_initiation', section: 'welcome', readers: ['the welcome email'] },
  {
    document: 'the_initiation',
    section: 'invitation',
    readers: ['the waitlist confirmation email', 'the home page cards (/)'],
  },
  { document: 'the_initiation', section: 'guide', readers: ['the home page cards (/)'] },
  {
    document: 'the_heart_behind_lelanea',
    section: 'invitation',
    readers: ['the home page opening line (/)'],
  },
  {
    document: 'the_heart_behind_lelanea',
    section: 'purpose',
    readers: ['the home page, and its meta description (/)'],
  },
  {
    document: 'the_heart_behind_lelanea',
    section: 'remembrance',
    readers: ['the home page closing (/)'],
  },
  { document: 'disclaimer', section: 'purpose', readers: ['the data page (/data)'] },
  { document: 'disclaimer', section: 'purpose_limits', readers: ['the data page (/data)'] },
  { document: 'disclaimer', section: 'is_not', readers: ['the data page (/data)'] },
  { document: 'disclaimer', section: 'is_not_context', readers: ['the data page (/data)'] },
  {
    document: 'disclaimer',
    section: 'coaching',
    readers: ['the data page (/data)'],
    needsHeading: true,
  },
  {
    document: 'disclaimer',
    section: 'crisis',
    readers: ['the data page (/data)'],
    needsHeading: true,
  },
  { document: 'disclaimer', section: 'commitment', readers: ['the home page cards (/)'] },
];

/** The sections of one document that code selects by. */
export function sectionReadersOf(documentId: string): readonly SectionReader[] {
  return SECTION_READERS.filter((entry) => entry.document === documentId);
}

/** What reads the journey's text: every tier and module row. */
export const JOURNEY_READERS: readonly string[] = [
  'the journey map drawer and the module pages (/app/modules/…)',
  'the home page journey list (/)',
  'the resource drawer (module titles)',
  'the AI’s module context',
  'the public content API (/api/v1/app/content/journey-structure)',
];

/** What reads the discovery questions. */
export const QUESTION_READERS: readonly string[] = [
  'the public content API (/api/v1/app/content/discovery-questions)',
];

/** What reads the resource library. */
export const RESOURCE_READERS: readonly string[] = [
  'the resource drawer (/api/v1/app/content/resources)',
  'the list of resources the AI is given each turn',
  'the AI’s suggest_resource tool',
  'the chips on past suggestions in conversations',
];
