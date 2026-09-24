/**
 * What each content collection is called in the admin (f-content-seeds t-91).
 * One place, so the landing table, the page titles and the nav agree.
 *
 * Resources are videos, audio and articles in every admin string — never
 * the old names for them.
 */

import type { ContentCollection } from '@/lib/app/content/admin/endpoint';

export interface CollectionArea {
  name: string;
  description: string;
}

export const COLLECTION_COPY: Readonly<
  Record<
    ContentCollection,
    { title: string; description: string; areas: readonly CollectionArea[] }
  >
> = {
  documents: {
    title: 'Documents',
    description: 'The foundational documents, block by block.',
    areas: [
      { name: 'The Initiation', description: 'The welcome statement, read at onboarding.' },
      { name: 'The Heart Behind Lelañea', description: 'The intent and mission.' },
      { name: 'The Mission', description: 'In the About section.' },
      { name: 'About the Creator', description: 'In the About section.' },
      { name: 'The Lineage of Lelañea', description: 'In the About section.' },
      { name: 'Disclaimer', description: 'What it is, what it is not, and important disclosures.' },
      { name: 'Terms of Use', description: 'The terms a client accepts.' },
    ],
  },
  journey: {
    title: 'Journey text',
    description: 'The words the journey is shown in.',
    areas: [
      { name: 'Journey', description: 'The journey’s title.' },
      { name: 'Tiers', description: 'Each tier’s label and intent.' },
      { name: 'Modules', description: 'Each module’s title, subtitle and phases.' },
    ],
  },
  questions: {
    title: 'Discovery questions',
    description: 'What a client is asked during onboarding.',
    areas: [
      { name: 'Preamble', description: 'What is said before the first question.' },
      { name: 'Questions', description: 'The onboarding questions, in order.' },
      { name: 'Pacing', description: 'How quickly the questions are asked.' },
    ],
  },
  resources: {
    title: 'Resources',
    description: 'The videos, audio and articles offered beside the journey.',
    areas: [
      { name: 'Library', description: 'The library’s title, version and sign-off.' },
      { name: 'Videos', description: 'Each video, its length and link.' },
      { name: 'Audio', description: 'Each audio piece, its length and link.' },
      {
        name: 'Articles',
        description: 'Each article, its reading time and a document or link.',
      },
      { name: 'Words by key', description: 'The quote and paragraphs shown with the resources.' },
    ],
  },
};
