/**
 * What each content collection is called in the admin (f-content-seeds t-91).
 * One place, so the landing cards, the page titles and the nav agree.
 */

import type { ContentCollection } from '@/lib/app/content/admin/endpoint';

export const COLLECTION_COPY: Readonly<
  Record<ContentCollection, { title: string; description: string }>
> = {
  documents: {
    title: 'Documents',
    description:
      'Her seven foundational documents: the welcome, the mission, the Disclaimer, the Terms and the rest, block by block.',
  },
  journey: {
    title: 'Journey text',
    description:
      'The journey’s title, each tier’s label and intent, and each module’s title, subtitle and phases.',
  },
  questions: {
    title: 'Discovery questions',
    description: 'The onboarding questions, their preamble and pacing.',
  },
  resources: {
    title: 'Resources',
    description:
      'The films and readings offered beside the journey, and her words for each module.',
  },
};
