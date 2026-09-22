/**
 * Her seven foundational documents, loaded into the tables every surface reads,
 * once (f-content-seeds t-86).
 *
 * Fills `app_document_collection`, `app_foundational_document` and each
 * document's revision 1 (`origin: seed`) from
 * `content/lelanea_foundational_documents.json`, with the owner's section keys on
 * the blocks. After this has run, the file is reference material. Nothing
 * reads it at request time.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **Operator-owned.** They are written once, while no collection row exists, and
 * never again, because an admin can edit them (t-91) and a re-seed must not
 * undo an edit. The write-once rule lives in the service
 * (`seedFoundationalDocuments` in `lib/app/content/document-store.ts`), not here,
 * so every writer is held to it. This is the shape `011-slot-taxonomy` uses.
 *
 * **In practice this writes nothing.** The data migration
 * `20260927100100_app_foundational_documents_data` inserts the same rows (the
 * JSON in it IS `buildFoundationalSeed()`, pinned by
 * `foundational-seed.test.ts`), because production migrates on every start and
 * seeds only when asked. On `db:reset` migrations run first, so this unit finds
 * the rows and skips. It stays as the write-once contract every writer is held
 * to, and as the path for a database built without that migration.
 *
 * A change to the file therefore does not reach an existing database. Once
 * written, the tables are the documents; an edit goes through the admin editor,
 * and a re-import through its upload (t-91). **Data that an existing environment
 * must pick up ships as an `app_` migration** (`.context/app/database-changes.md`),
 * not as an edit to the file.
 *
 * **Safe on empty.** It only adds rows; there is no removal pass.
 *
 * **Idempotent.** If it runs again it reads one row and writes none. It declares
 * no `hashInputs` over the JSON, on purpose: editing the file must not re-run a
 * unit that would do nothing while implying the edit had landed.
 *
 * **It throws before writing anything if the file and the key map disagree.**
 * `buildFoundationalSeed` checks every section range against the opening words
 * of its first and last block, so a block inserted in the file fails here
 * instead of keying the wrong passage for every client.
 *
 * @see lib/app/content/foundational-seed.ts — the file, and the section keys
 * @see lib/app/content/document-store.ts — the one service that writes these tables
 */

import type { SeedUnit } from '@/prisma/runner';
import { buildFoundationalSeed } from '@/lib/app/content/foundational-seed';
import { seedFoundationalDocuments } from '@/lib/app/content/document-store';

const unit: SeedUnit = {
  name: 'app-lelanea/015-foundational-documents',
  async run({ prisma, logger }) {
    // Built first, even when the tables are already seeded, so a file that no
    // longer matches its key map is reported on every seed, not only on a
    // fresh database.
    const seed = buildFoundationalSeed();
    const result = await seedFoundationalDocuments(seed, prisma);

    if (result.status === 'skipped') {
      logger.info(
        `⏭  Foundational documents already in the database (${result.documents}); left as they are`
      );
      return;
    }

    const keyed = seed.documents.reduce(
      (count, document) =>
        count +
        new Set(document.blocks.flatMap((block) => (block.section === null ? [] : [block.section])))
          .size,
      0
    );
    logger.info(
      `📜 Seeded ${result.documents} foundational documents at version ${seed.collection.version}, ` +
        `each at revision 1, with ${keyed} section keys`
    );
  },
};

export default unit;
