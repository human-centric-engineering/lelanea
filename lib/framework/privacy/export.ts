/**
 * Framework subject-data collector (GDPR Art. 15).
 *
 * Runs `FRAMEWORK_SUBJECT_DATA_SOURCES` and returns the framework tier's
 * contribution to a subject export as a FLAT map of section → rows, which is the
 * shape core's `lib/app/data-export.ts` seam is defined in terms of: every key
 * here becomes a key of the bundle's `app`.
 *
 * **This file used to build its own `meta` block, and no longer does.** Daybreak
 * wrote one fork-first while Sunrise #533 was open — a nested
 * `app.framework = { meta, personalData, attributions }`, because core had no way
 * to describe a fork tier's sources and an undescribed section is a bundle whose
 * manifest contradicts its contents. Sunrise 0.10.0 landed that: declarations go
 * to `registerAppSubjectSources()`, and core emits `meta.app` (every declared
 * source with its row count) and folds the tier's exclusions into `meta.excluded`.
 * So the nesting is gone, the sections sit directly under `app`, and the subject
 * gets one manifest describing every tier on the same terms instead of two
 * describing one each.
 *
 * The `export` / `attribution` split survives the flattening — it lives on each
 * declaration, and core reads it back out into `meta.app[].disposition`. What is
 * lost is nothing: it was never a difference in the payload, only in which of two
 * sibling objects a section was filed under.
 *
 * **Nothing here is best-effort.** A source that throws fails the whole export —
 * deliberately the opposite of the erasure path, where hook failures are
 * swallowed so app trouble can never block a deletion. An export that quietly
 * lost a section is indistinguishable, to the person reading it, from one that
 * had nothing to show.
 *
 * **Every declared section must appear in what this returns**, including as an
 * empty array when the subject owns nothing — `exportUserData()` throws
 * `DeclaredAppSourceMissingError` otherwise. That holds here by construction: the
 * map below is built from the same constant the declarations are derived from.
 *
 * @see lib/framework/privacy/export-sources.ts · lib/privacy/export-user.ts
 */

import {
  FRAMEWORK_SUBJECT_DATA_SOURCES,
  type FrameworkSubjectQuery,
} from '@/lib/framework/privacy/export-sources';

/**
 * The framework tier's contribution to a subject export: one key per declared
 * source, holding that source's rows.
 */
export type FrameworkSubjectExport = Record<string, unknown[]>;

/** Collect the framework tier's data about one subject. */
export async function collectFrameworkSubjectData(
  subject: FrameworkSubjectQuery
): Promise<FrameworkSubjectExport> {
  const results = await Promise.all(
    FRAMEWORK_SUBJECT_DATA_SOURCES.map(async (source) => ({
      section: source.section,
      rows: await source.fetch(subject),
    }))
  );

  const sections: FrameworkSubjectExport = {};
  for (const { section, rows } of results) {
    sections[section] = rows;
  }
  return sections;
}
